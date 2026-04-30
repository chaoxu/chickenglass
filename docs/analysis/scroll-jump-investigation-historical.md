# Scroll Jump Investigation (Historical)

This note records the `scroll-jump-debug` investigation before the stable rich
rendering architecture landed. It is historical evidence, not current product
guidance.

Current policy: keep CM6's normal viewport virtualization, use `view.visibleRanges`
to bound renderer work, and fix jumps by making editor-owned geometry stable. Do
not patch or globally expand CM6's mounted viewport margin as a product fix. See
`docs/architecture/architecture-decisions.md`.

## Baseline signature

Primary probe:

```bash
rtk proxy node scripts/scroll-jump-lab.mjs --fixture rankdecrease/main.md --url http://localhost:5173
```

Current observed failure on `fixtures/rankdecrease/main.md`:

- Near the bottom, a nominal `+90px` downward scroll step can settle as `-135px`.
- On that same step, `scrollHeight` drops by about `2493px`.
- The logical top line jumps forward from `990` to `1076`.
- The viewport window jumps from `942-1043` to `1046-1140`.
- Mounted display math collapses from `10` widgets to `1`.

Interpretation:

- The problem is not just browser wheel noise.
- CM6's height map and the live DOM geometry are disagreeing while scrolling.
- The failure appears during viewport turnover near dense display-math regions.

## Hypothesis log

### H1. Browser scroll anchoring is the primary cause

Status: rejected.

Test:

- Re-ran the baseline probe after forcing `overflow-anchor: none` on the editor
  scroller, content DOM, `documentElement`, and `body`.

Result:

- The same bad step remained: `scrollTop 25270 -> 24872` while top line
  advanced `1011 -> 1122`.

Conclusion:

- Browser scroll anchoring is not the primary mechanism.
- Any future fix that only changes `overflow-anchor` will be insufficient.

### H2. Dense display math is the dominant trigger

Status: partially confirmed.

Evidence so far:

- The bad region is display-math-heavy.
- During the failing trace, mounted display math count changes as the viewport
  turns over.
- The final public synthetic repro also shows the same turnover signature: the
  mounted display-math set changes exactly when the bad step appears.

Temporary controls that did not reproduce a jump:

- inline-only
- prose-only
- prose-fenced
- display-stack
- display-fenced
- display-numbered

Meaning:

- Display math is necessary-looking, but not sufficient by itself.
- A coarse "many display equations" document is too simple to trigger the bug.
- The instability depends on a more specific turnover pattern than raw widget count.

Positive result:

- A structure-preserving synthetic variant of the hotspot does reproduce.
- The kept public file is `demo/showcase/scroll-jump.md`.
- With `rtk proxy node scripts/scroll-jump-lab.mjs --regression showcase/scroll-jump.md --url http://localhost:5173 --step-px 180 --step-count 16`,
  the bad step is:
  - expected `+180px`
  - observed `-348px`
  - `scrollHeightDelta=-74`
  - top line still advances `581 -> 592`

Next tests:

- Done.
- The remaining question is not whether display math participates; it does.
- The remaining question is which part of the display-math geometry contract
  makes CM6's height map unstable.

### H3. Fenced divs / theorem shells are required

Status: rejected as a standalone explanation.

Test results:

- Temporary fenced-only and paper-cluster controls were clean or caused only moderate
  `scrollHeight` corrections, not a true jump.

Conclusion:

- Fenced div shells alone are not enough.
- Even "paper-like" theorem/proof structure is not enough when the line
  geometry is too simple.
- The successful synthetic repro had to preserve the hotspot's more exact line
  shape, not only its abstract block types.

### H4. Inline math or references are required

Status: updated. Inline replacement widgets are required for the remaining
`rankdecrease` bug, but not in isolation.

Controlled runtime matrix on the anchored `rankdecrease` trace starting near line
`990`:

- baseline:
  - bad reverse remap at step `12`
  - `delta=-1196`
  - `dHeight=+6`
- no references:
  - still bad
  - `delta=-1148`
  - `dHeight=+6`
- no inline math:
  - still bad, worse later
  - `delta=-2361`
  - `dHeight=-3277`
- no inline math and no references:
  - stable for the whole 20-step probe
  - worst drift `0`

Conclusion:

- The remaining bug is not tied to one specific inline feature.
- It survives with only inline-math widgets.
- It also survives with only reference widgets.
- It disappears only when wrapped prose has no inline replacement widgets at all.
- That strongly points at a generic CM6 wrapped-gap problem with inline
  replacement widgets whose rendered width differs from raw source width.

### H5. Missing offscreen height estimates for display-math widgets are the root cause

Status: strongly implicated, but not solved.

Why this matters:

- Tables implement `estimatedHeight`.
- Display-math widgets currently do not.
- A viewport-turnover jump is exactly the sort of failure expected when a block
  replacement's real height is discovered too late.

Direct experiments:

- Experimental line-based estimate:
  - changed only `MathWidget.estimatedHeight`
  - produced much worse jumps on both `rankdecrease` and the structured
    synthetic repro
  - example on `rankdecrease`: expected `+180px`, observed `-1388px`,
    `scrollHeightDelta=-1273`
- Experimental constant estimate:
  - also changed only `MathWidget.estimatedHeight`
  - again produced a radically different failure signature
  - example on `rankdecrease`: expected `+180px`, observed `+1722px`,
    `scrollHeightDelta=-872`

Conclusion:

- Display-math offscreen height modeling is definitely part of the mechanism.
- The bug is not random content jank; it is sensitive to how CM6 predicts block
  widget heights before mount.
- Naive estimated heights are not a real fix and can make the instability much
  worse.

### H6. The remaining `rankdecrease` bug needs a mixed turnover band, not just display math

Status: confirmed, with an important refinement.

What changed:

- After moving display math to true block replacements, the older synthetic repro
  class became stable.
- `rankdecrease` still failed, but the failing band was narrower and more specific.

Observed structure in the remaining hotspot:

- several long wrapped prose lines containing many inline-math widgets and
  cross-references
- compact runs of display equations
- all of it packed inside adjacent proposition/proof/lemma blocks

Key runtime evidence:

- Before the bad step, the `999-1043` band is densely populated by mixed line
  blocks:
  - very tall wrapped prose lines (`1007`, `1009`, `1011`, `1035`)
  - display-math block line blocks (`1000-1005`, `1020-1024`, `1026-1030`,
    `1036-1038`, `1040-1043`)
- On the failing step, that whole band rolls offscreen at once.
- `scrollHeight` shrinks by `2493px` while mounted display math drops from `10`
  to `1`.

Interpretation:

- The remaining bug is likely not "display math only".
- The more precise trigger is a dense turnover band where block display math and
  long inline-rich prose lines are interleaved.
- That is consistent with CM6 having to reconcile both block-widget height
  estimates and wrapped prose heights whose inline widget widths differ from raw
  source widths.

Refinement from controlled flags:

- Disabling display-math widgets also makes the anchored `rankdecrease` trace
  stable, even when inline-math widgets and/or cross-reference widgets remain.
- So the remaining bug needs both:
  - display-math block turnover
  - wrapped prose whose inline replacements do not match raw source width

### H7. The visible jump is partly an end-of-document clamp effect

Status: confirmed, but it is not the whole bug.

Direct before/after measurement on the late failing `+90px` step:

- before:
  - `scrollTop=24544`
  - `scrollHeight=27786`
  - `maxScrollTop=26910`
- after:
  - `scrollTop=24409`
  - `scrollHeight=25293`
  - `maxScrollTop=24417`

Interpretation:

- `scrollHeight` and `maxScrollTop` collapse by the same `2493px`.
- Near the end of the document, that shrink clamps `scrollTop` backward.
- This explains the final visible backward snap near the bottom.

But it is not the full explanation, because an earlier anchored trace shows a
large reverse jump even when total document height barely changes.

### H8. There is also a local reverse remap before the final end clamp

Status: confirmed.

Anchored rich-mode trace from the line-`990` band:

- step `11 -> 12`
  - `scrollTop 25453 -> 24257`
  - `delta=-1196`
  - `scrollHeight 27780 -> 27786`
  - `dHeight=+6`
  - top line `1039 -> 975`
  - viewport `982-1098 -> 951-1055`

Controls:

- forcing `overflow-anchor: none` does not change this result
- forcing `white-space: pre` makes the same anchored trace monotonic

Interpretation:

- This earlier reverse jump is not caused by browser scroll anchoring.
- It is also not caused by end-of-document clamping, because total height is
  almost unchanged on this step.
- What changes is the height distribution inside CM6's height map. A fixed
  scroll range suddenly maps back to much earlier lines.
- That behavior matches CM6's `HeightMapGap` model, which estimates wrapped
  offscreen gaps as if they were plain text.

### H9. CM6's wrapped-gap estimator is the underlying broken assumption

Status: strongest current explanation.

Relevant CM6 code:

- `HeightMapGap.updateHeight(...)` explicitly says gaps "only contain plain text"
- `HeightOracle.heightForGap(from, to)` estimates wrapped height from raw
  character count and `lineLength`
- `HeightMapGap.heightMetrics(...)` then distributes that estimated height across
  lines using `perLine` and `perChar`

Why that matters here:

- Our wrapped proof/proposition lines are not plain text in rich mode.
- They contain inline replacement widgets:
  - inline math
  - cross references
- Those widgets are often much narrower than their raw markdown source.
- So offscreen wrapped-height guesses based on source characters are wrong.
- When a display-math turnover band enters or leaves the viewport, CM6 is forced
  to split and refresh nearby height-map regions, and that wrong wrapped-gap
  model gets exposed.

This explains both observed failure modes:

- local reverse remap:
  - height distribution changes inside the height map
  - `scrollTop` suddenly corresponds to earlier lines even without a large
    `scrollHeight` change
- late backward jump:
  - a later correction also shrinks total `scrollHeight`
  - near the end of the document, the browser clamps `scrollTop` backward

### H10. Making display math and figures follow the table-style height contract fixes the remaining bug

Status: rejected as a complete fix.

What changed:

- added shared measured-height caching for block widgets
- display math now reports cached measured heights via `estimatedHeight`
- image / figure previews also use the same measured-height path

Verification runs after the change:

- `rtk proxy node scripts/scroll-jump-lab.mjs --fixture rankdecrease/main.md --url http://localhost:5173 --step-px 90 --step-count 24`
- `rtk proxy node scripts/scroll-jump-lab.mjs --fixture rankdecrease/main.md --url http://localhost:5173 --step-px 180 --step-count 16`
- `rtk proxy node scripts/scroll-jump-lab.mjs --regression showcase/scroll-jump.md --url http://localhost:5173 --step-px 90 --step-count 24`
- figure-heavy synthetic probe: `/tmp/coflat-figure-probe.mjs`

Results:

- `rankdecrease` is unchanged at the main failure band:
  - `+90px` probe still fails as `-135px`
  - `+180px` probe still fails as `-45px`
  - both still collapse `scrollHeight` by `2493px`
- `demo/showcase/scroll-jump.md` remains monotonic
- the figure-heavy synthetic document is also monotonic

Conclusion:

- the table-style block contract is still the right best practice for block
  widgets
- it helps explain why tables and figures are relatively well behaved
- but it does not fix the remaining `rankdecrease` jump
- the remaining failure is still dominated by CM6's wrong offscreen wrapped-gap
  model for inline replacement widgets near a block-turnover band

## Public repro goal

The end state for this investigation is a smaller public document under `demo/`
that:

- uses only synthetic text
- reproduces a large measured jump
- is explained by the hypothesis log above

At that point the repro file can become the normal demo/showcase target for
future scroll-jump work.

Current public repro status:

- `demo/showcase/scroll-jump.md` is still the working synthetic investigation
  file, but it is currently being compacted again.
- The earlier larger version reproduced the mixed-band failure well.
- The current smaller version no longer captures the full `rankdecrease`
  signature reliably.

Updated repro target after the controlled tests:

- It must include both ingredients:
  - a turnover band of display-math blocks
  - surrounding wrapped prose with inline replacement widgets
- A document with only one of those ingredients is not enough.

### H11. Tables can also trigger the same jump once they actually own the hotspot

Status: confirmed.

Why this test mattered:

- Earlier table controls were inconclusive because the large synthetic table
  files were not actually mounting `TableWidget`s in the worktree.
- The immediate blocker turned out to be `tableDiscoveryField` on long,
  partially parsed documents: the live syntax tree already contained table
  nodes, but the discovery field stayed empty until the parser was forced to
  finish.
- After wiring a parse-completion plugin into the table discovery owner, the
  same synthetic corridor mounted real `.cf-table-widget` DOM in rich mode.

Direct control on the private hotspot:

- Built a transformed `rankdecrease` project copy in memory.
- Replaced every display-math block in the failing band `968-1058` with a real
  markdown table block.
- Re-ran the same near-bottom `+90px` probe against that transformed project.

Observed transformed result:

- the viewport entered the hotspot with:
  - `displays=0`
  - `tables=5`
- the bad step was still huge:
  - expected `+90px`
  - observed `+1435px`
  - `scrollHeightDelta=+2359`
  - top line `1045 -> 1101`
  - viewport `963-1058 -> 1068-1149`

This reproduced consistently across repeated runs of the same transformed
project.

Interpretation:

- The remaining bug is not uniquely about display-math implementation details.
- A block-turnover corridor built out of real table widgets can also produce a
  large unsolicited remap once it sits inside the same inline-rich wrapped-prose
  environment near the end of the document.
- So the broader owner problem is: CM6's top-level wrapped-gap model does not
  stay stable when a mixed corridor of block widgets turns over next to wrapped
  prose whose inline replacements differ from raw source width.

Implication:

- Display math may still need better local behavior, but "make it work like
  tables" is no longer enough as a full explanation.
- Tables themselves can participate in the same failure once the surrounding
  conditions are strong enough.

### H12. Larger CM6 overscan can suppress the jump by keeping the risky tail mounted

Status: confirmed as a diagnostic mitigation; rejected as product architecture.

What changed:

- patched `@codemirror/view` viewport margin from `1000` to `8000`
- verified the actual served Vite bundle uses `8e3` in `getViewport(...)`

Runtime verification on the same `rankdecrease` wheel probe:

```bash
rtk proxy node scripts/scroll-jump-lab.mjs --fixture rankdecrease/main.md --url http://localhost:5173 --simulate-wheel --step-px 90 --step-count 24
rtk proxy node scripts/scroll-jump-lab.mjs --fixture rankdecrease/main.md --url http://localhost:5173 --simulate-wheel --step-px 180 --step-count 16
```

Observed results with real overscan active:

- viewport stays wide and stable through the hotspot:
  - `viewport=799-1149`
  - `mountedDisplays=29`
  - `mountedLines=232`
- `+90px` wheel probe:
  - monotonic for all 24 steps
  - worst drift `0`
  - `scrollGuardCount=0`
- `+180px` wheel probe:
  - monotonic through the hotspot
  - final short step into the actual end is `+70px`
  - `scrollGuardCount=0`

Conclusion:

- The remaining bad behavior is strongly tied to viewport turnover.
- If the risky tail stays mounted, the original reverse jump disappears.
- Bigger overscan is an effective mitigation even without the runtime guard.
- This is intentionally not the current fix. It increases mounted DOM and hides
  unstable geometry instead of making the rendered block geometry match CM6's
  height-map rules.

### H13. A runway-preserving guard can neutralize the end clamp when turnover still happens

Status: confirmed as a mitigation, not the root fix.

What changed:

- added runtime logging via `window.__cfDebug.scrollGuards()`
- changed the reverse-remap guard to preserve lost bottom runway temporarily
  instead of only nudging `scrollTop`

Measured intermediate state before the `8e3` overscan bundle was live:

- `+180px` wheel probe:
  - old guard: worst step `-1166px`
  - runway-preserving guard: worst step `-290px`
  - `scrollGuardCount=1`
  - recorded event:
    - `wheelDeltaY=180`
    - `previousTop=25534`
    - `observedTop=21833`
    - `correctedTop=25714`
    - `paddingBottom=2464`
    - `preservedMaxScrollTop=26832`
- `+90px` wheel probe:
  - old guard: worst step `-1256px`
  - runway-preserving guard: worst step `-380px`
  - `scrollGuardCount=1`

Conclusion:

- The guard can substantially reduce the visible backward clamp.
- It is useful as a fallback for cases where turnover still happens.
- But the cleaner mitigation is still to prevent the risky tail from leaving the
  mounted viewport in the first place.

### H14. The `8e3` overscan mitigation has a real DOM-size cost, but only a modest measured time cost on `rankdecrease`

Status: historical benchmark for the rejected overscan mitigation.

Benchmark setup:

- used the real private fixture `fixtures/rankdecrease/main.md`
- four managed-browser runs on `http://localhost:5173`
- dropped the first run as warmup
- measured:
  - rich open wall time through health settle
  - stepped rich scrolling cost (`30` lines per step across the document)
  - mounted `.cm-line` and `.cf-math-display` counts near the risky tail band

Results:

- baseline `1e3` viewport margin:
  - `openMs ≈ 1771.2`
  - `meanStepMs ≈ 7.86`
  - `maxStepMs ≈ 16.7`
  - `mountedLinesNearBottom ≈ 52`
  - `mountedDisplaysNearBottom ≈ 9`
- mitigated `8e3` viewport margin:
  - `openMs ≈ 1764.7`
  - `meanStepMs ≈ 8.33`
  - `maxStepMs ≈ 54.3`
  - `mountedLinesNearBottom ≈ 185.7`
  - `mountedDisplaysNearBottom ≈ 20`

Interpretation:

- the main cost is much larger mounted DOM around the risky tail band
- open time was effectively flat in this run
- stepped scroll mean increased only modestly (`~0.47ms`, about `6%`)
- the mitigation is therefore trading memory / mounted DOM size for stability,
  much more than it is trading open time
