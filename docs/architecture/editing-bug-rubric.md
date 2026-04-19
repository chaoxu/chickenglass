# Editing Bug Rubric

Coflat editing bugs are violations of the editor's writing contract, not only
crashes. The contract is: a mathematician can write canonical Markdown through
the rich editor without losing content, location, structure, or confidence in
what will be saved.

## Core Invariants

- Canonical Markdown is the source of truth. Rich editor state, previews, and
  chrome must derive from Markdown or round-trip back to equivalent Markdown.
- Caret locality must hold. Typing, deletion, reveal open/close, mode switches,
  clicks, and keyboard navigation must keep the caret at the user's intended
  logical position.
- Selection APIs must tell the truth. DOM selection, Lexical selection, source
  offsets, `__editor.getSelection()`, and `__editor.setSelection()` must agree.
- Reveal behavior must be uniform. Inline math, display math, citations,
  references, links, headings, theorem metadata, captions, and similar surfaces
  should expose the same edit contract: enter, edit, exit, restore rendered
  state, and preserve caret intent.
- Keyboard navigation must reach every editable semantic object. Arrow-key
  movement must not skip or trap inline math, display math, citations,
  references, media metadata, theorem blocks, proof blocks, or links.
- Click mapping must be local. Clicking rendered semantic content should reveal
  the closest editable source position that can affect the clicked content.
- Render/edit parity must hold. Revealing or activating a surface must not
  change semantic boundaries, token interpretation, typography ownership, or
  saved Markdown meaning.
- Nested surfaces must be isolated. Parent source ranges, commands, DOM
  listeners, and hover behavior must not be corrupted by nested editor roots.
- Layout changes must be intentional. Reveal should not create unexpected line
  breaks, duplicate labels, hover-through effects, or uncontrolled overlay
  placement.
- Common editing paths must stay fast on real documents. Typing, deletion,
  reveal open/close, mode switches, and arrow navigation should not introduce
  noticeable blocking work.
- Failures must be local and recoverable. Missing previews, parse failures, and
  unsupported media should degrade visibly without corrupting editing state.
- Bugs must be reproducible. Browser and desktop sessions should capture enough
  document state, mode, selection, and recent interaction history to reproduce a
  day-to-day editing failure.

## Severity

- P0: data loss, corrupted Markdown, save/reopen meaning changes, or an
  unrecoverable editor state.
- P1: caret jumps, typing or deletion happens in the wrong place, an editable
  object is unreachable, reveal cannot close, or mode switching loses selection.
- P2: render/edit mismatch, misleading layout, wrong or missing preview,
  duplicate labels, incorrect style ownership, or degraded but recoverable
  editing behavior.
- P3: diagnostic gaps, bug-reporting friction, missing coverage, flaky
  reproduction paths, or non-blocking UX defects.

## Architectural Smells

- A guard that blocks one symptom without expressing the invariant usually means
  ownership is wrong.
- A semantic object with its own one-off reveal, selection, or keyboard path is
  suspect unless the semantics genuinely differ.
- Separate inactive and active renderers for the same field are suspect unless
  they share the same formatting model and source ownership.
- DOM coordination is suspect when a Lexical command, node transform, or shared
  semantic registry would express the boundary more directly.
- Manual offset correction is suspect when source ranges, editor roots, or
  selection mapping are not represented structurally.

## Search Checklist

- Delete prose, formatted text, inline math, display math, citations, references,
  headings, theorem bodies, and proof bodies; verify content and caret location.
- Enter and leave every rich surface using left/right arrows, mouse clicks, and
  mode switches.
- Click inside rendered math and citations at multiple visual positions; verify
  the revealed source position is local.
- Switch source to rich and rich to source from prose, blank lines, formatted
  text, inline decorators, raw blocks, and nested block content.
- Save, reopen, and round-trip documents containing nested theorem/proof blocks,
  references, figures, display math, and inline formatting combinations.
- Run the same reproduction on a real document fixture before treating a bug as
  fixed.
