---
title: "Short Scroll Jump Showcase"
---

# Short Scroll Jump Showcase

This file is synthetic. It keeps only the ingredients that currently matter for
the rich-mode jump investigation: short runs of display math inside proof blocks,
surrounded by wrapped prose that contains many inline-math and cross-reference
widgets.

::: {#sjp-a .proposition} First corridor anchor
The quantity $a_1+b_1$ is compared with $\sum_{i=1}^{9} i$, $\prod_{j=1}^{4}(1+x_j)$, and [@sjp-b] while this sentence stays intentionally long enough to wrap several times in the editor so that the visible inline widgets are much narrower than the raw markdown source that CM6 uses for offscreen wrapped-line estimates.
:::

::: {.proof}
The same corridor continues with $c_1+d_1$, $\alpha_1+\beta_1$, and [@sjp-c], and then it passes into a short display-math run.
$$
\Theta_1=\sum_{i=1}^{5}(u_i+v_i)
$$
$$
\Lambda_1=\frac{1+x_1^2}{1+y_1^2}+\sum_{i=1}^{3} z_i
$$
After the display block, the proof resumes with $e_1+f_1$, $\frac{1+p_1^2}{1+q_1^2}$, and [@sjp-d] in another wrapped sentence whose only job is to keep inline replacements and block turnover adjacent.
:::

::: {#sjp-b .lemma} Second corridor anchor
The next wrapped paragraph compares $a_2+b_2$, $\alpha_2+\beta_2$, $\sum_{i=1}^{11} i$, and [@sjp-a] with enough extra prose to create line wrapping even on a wide editor surface, because the current bug only appears when the offscreen gap model has to estimate wrapped rich inline content rather than plain text.
:::

::: {.proof}
We continue with $c_2+d_2$, $r_2+s_2$, $\prod_{j=1}^{5}(1+t_j)$, and [@sjp-c].
$$
\Theta_2=\sum_{i=1}^{6}(u_i+2v_i)
$$
$$
\Lambda_2=\frac{1+x_2^2}{1+y_2^2}+\sum_{i=1}^{4} z_i
$$
The corridor exits through another wrapped sentence containing $e_2+f_2$, $\alpha_2+\alpha_2+\alpha_2+\alpha_2$, and [@sjp-e].
:::

::: {#sjp-c .proposition} Third corridor anchor
This paragraph keeps $a_3+b_3$, $\frac{1+m_3^2}{1+n_3^2}$, $\sum_{i=1}^{12} i$, [@sjp-a], and [@sjp-b] together in one long wrapped band so that inline-math widgets and cross-reference widgets coexist on the same visual lines right before another display-math turnover.
:::

::: {.proof}
Here the prose uses $c_3+d_3$, $\prod_{j=1}^{6}(1+w_j)$, and [@sjp-d] before two compact display equations.
$$
\Theta_3=\sum_{i=1}^{7}(2u_i+v_i)
$$
$$
\Lambda_3=\frac{1+x_3^2}{1+y_3^2}+\sum_{i=1}^{5} z_i
$$
Then the proof returns to wrapped prose with $e_3+f_3$, $g_3+h_3$, and [@sjp-f] in a deliberately long line.
:::

::: {#sjp-d .corollary} Fourth corridor anchor
The quantity $a_4+b_4$ is compared against $\alpha_4+\beta_4$, $\sum_{i=1}^{13} i$, $\prod_{j=1}^{4}(1+\rho_j)$, and [@sjp-c], while the paragraph keeps enough filler words to wrap so that the visible geometry is no longer close to the raw source width that the gap estimator sees.
:::

::: {.proof}
The corridor begins with $c_4+d_4$, $\frac{1+x_4^2}{1+y_4^2}$, and [@sjp-e].
$$
\Theta_4=\sum_{i=1}^{8}(u_i+3v_i)
$$
$$
\Lambda_4=\frac{1+x_4^2}{1+y_4^2}+\sum_{i=1}^{4} z_i
$$
It ends with $e_4+f_4$, $\alpha_4+\alpha_4+\alpha_4+\alpha_4+\alpha_4$, and [@sjp-b] in another wrapped exit sentence.
:::

::: {#sjp-e .theorem} Fifth corridor anchor
Now $a_5+b_5$, $\sum_{i=1}^{14} i$, $\prod_{j=1}^{5}(1+\sigma_j)$, [@sjp-b], and [@sjp-d] are forced into one wrapped paragraph that again places inline widgets immediately next to the upcoming display-math block band.
:::

::: {.proof}
The proof carries $c_5+d_5$, $\frac{1+x_5^2}{1+y_5^2}$, and [@sjp-f] into the display section.
$$
\Theta_5=\sum_{i=1}^{9}(u_i+4v_i)
$$
$$
\Lambda_5=\frac{1+x_5^2}{1+y_5^2}+\sum_{i=1}^{5} z_i
$$
Afterward, another wrapped line packs $e_5+f_5$, $g_5+h_5$, $\alpha_5+\beta_5$, and [@sjp-a].
:::

::: {#sjp-f .proposition} Sixth corridor anchor
The last dense corridor repeats the same shape with $a_6+b_6$, $\alpha_6+\beta_6$, $\sum_{i=1}^{15} i$, $\prod_{j=1}^{6}(1+\tau_j)$, [@sjp-c], and [@sjp-e], again making the paragraph wrap several times in rich mode.
:::

::: {.proof}
The proof begins with $c_6+d_6$, $\frac{1+x_6^2}{1+y_6^2}$, and [@sjp-d].
$$
\Theta_6=\sum_{i=1}^{10}(u_i+5v_i)
$$
$$
\Lambda_6=\frac{1+x_6^2}{1+y_6^2}+\sum_{i=1}^{6} z_i
$$
The corridor closes with one more wrapped sentence containing $e_6+f_6$, $g_6+h_6$, $\alpha_6+\alpha_6+\alpha_6+\alpha_6+\alpha_6$, and [@sjp-b].
:::

## Tail

This tail keeps the bad corridor near the end of the document while remaining
short. It still uses wrapped inline math like $t_1+t_2$, $\frac{1+r_1^2}{1+s_1^2}$,
and cross-references like [@sjp-a], [@sjp-c], and [@sjp-f], but it no longer
adds new display-math blocks.

The first tail paragraph repeats $u_1+v_1$, $\sum_{i=1}^{8} i$, and [@sjp-d]
often enough to wrap, so that the scroll probe still has little runway below the
dense display-math corridor.

The second tail paragraph repeats $u_2+v_2$, $\prod_{j=1}^{5}(1+\omega_j)$, and
[@sjp-e] in the same way.

The third tail paragraph repeats $u_3+v_3$, $\frac{1+r_3^2}{1+s_3^2}$, and
[@sjp-f].

The fourth tail paragraph repeats $u_4+v_4$, $\sum_{i=1}^{9} i$, and [@sjp-b].

The fifth tail paragraph repeats $u_5+v_5$, $\prod_{j=1}^{4}(1+\kappa_j)$, and
[@sjp-c].

## Second Pass

::: {#sjp-g .lemma} Seventh corridor anchor
This second pass restarts the same geometry with $a_7+b_7$, $\alpha_7+\beta_7$, $\sum_{i=1}^{16} i$, $\prod_{j=1}^{5}(1+\eta_j)$, [@sjp-d], and [@sjp-f], again written as one long wrapped paragraph so that rich inline replacements dominate the visible line geometry while the source remains much longer.
:::

::: {.proof}
The proof introduces $c_7+d_7$, $\frac{1+x_7^2}{1+y_7^2}$, and [@sjp-h] before a compact display-math run.
$$
\Theta_7=\sum_{i=1}^{11}(u_i+6v_i)
$$
$$
\Lambda_7=\frac{1+x_7^2}{1+y_7^2}+\sum_{i=1}^{6} z_i
$$
Afterward, another wrapped sentence collects $e_7+f_7$, $g_7+h_7$, and [@sjp-i].
:::

::: {#sjp-h .proposition} Eighth corridor anchor
The next wrapped paragraph compares $a_8+b_8$, $\sum_{i=1}^{17} i$, $\prod_{j=1}^{6}(1+\mu_j)$, [@sjp-e], and [@sjp-g] while preserving the same long-line shape that has been needed throughout this investigation.
:::

::: {.proof}
The proof uses $c_8+d_8$, $\alpha_8+\beta_8$, and [@sjp-i].
$$
\Theta_8=\sum_{i=1}^{12}(u_i+7v_i)
$$
$$
\Lambda_8=\frac{1+x_8^2}{1+y_8^2}+\sum_{i=1}^{7} z_i
$$
It returns to wrapped prose with $e_8+f_8$, $\frac{1+r_8^2}{1+s_8^2}$, and [@sjp-j].
:::

::: {#sjp-i .corollary} Ninth corridor anchor
Now $a_9+b_9$, $\alpha_9+\beta_9$, $\sum_{i=1}^{18} i$, [@sjp-g], and [@sjp-h] sit on another deliberately wrapped paragraph directly before the next display-math turnover.
:::

::: {.proof}
The proof continues with $c_9+d_9$, $\prod_{j=1}^{5}(1+\nu_j)$, and [@sjp-j].
$$
\Theta_9=\sum_{i=1}^{13}(u_i+8v_i)
$$
$$
\Lambda_9=\frac{1+x_9^2}{1+y_9^2}+\sum_{i=1}^{7} z_i
$$
Then one more wrapped sentence packs $e_9+f_9$, $g_9+h_9$, and [@sjp-k].
:::

::: {#sjp-j .theorem} Tenth corridor anchor
This paragraph compares $a_{10}+b_{10}$, $\sum_{i=1}^{19} i$, $\prod_{j=1}^{6}(1+\xi_j)$, [@sjp-h], and [@sjp-i] in the same wrapped band, because the goal is still to keep inline replacement widgets dense right next to the block widgets that will roll out of the viewport.
:::

::: {.proof}
The proof uses $c_{10}+d_{10}$, $\frac{1+x_{10}^2}{1+y_{10}^2}$, and [@sjp-k].
$$
\Theta_{10}=\sum_{i=1}^{14}(u_i+9v_i)
$$
$$
\Lambda_{10}=\frac{1+x_{10}^2}{1+y_{10}^2}+\sum_{i=1}^{8} z_i
$$
Another wrapped exit sentence keeps $e_{10}+f_{10}$, $\alpha_{10}+\beta_{10}$, and [@sjp-l] together.
:::

::: {#sjp-k .proposition} Eleventh corridor anchor
The penultimate dense paragraph uses $a_{11}+b_{11}$, $\sum_{i=1}^{20} i$, $\prod_{j=1}^{5}(1+\psi_j)$, [@sjp-i], and [@sjp-j], again with enough prose to wrap several times.
:::

::: {.proof}
The proof carries $c_{11}+d_{11}$, $\frac{1+x_{11}^2}{1+y_{11}^2}$, and [@sjp-l] into the block band.
$$
\Theta_{11}=\sum_{i=1}^{15}(u_i+10v_i)
$$
$$
\Lambda_{11}=\frac{1+x_{11}^2}{1+y_{11}^2}+\sum_{i=1}^{8} z_i
$$
The corridor exits with $e_{11}+f_{11}$, $g_{11}+h_{11}$, and [@sjp-g].
:::

::: {#sjp-l .corollary} Twelfth corridor anchor
The final dense wrapped paragraph combines $a_{12}+b_{12}$, $\alpha_{12}+\beta_{12}$, $\sum_{i=1}^{21} i$, [@sjp-j], and [@sjp-k] so that the last display-math turnover still happens close to the end of the document.
:::

::: {.proof}
The proof enters with $c_{12}+d_{12}$, $\prod_{j=1}^{6}(1+\zeta_j)$, and [@sjp-h].
$$
\Theta_{12}=\sum_{i=1}^{16}(u_i+11v_i)
$$
$$
\Lambda_{12}=\frac{1+x_{12}^2}{1+y_{12}^2}+\sum_{i=1}^{9} z_i
$$
Finally, the proof exits through a last wrapped sentence containing $e_{12}+f_{12}$, $\frac{1+r_{12}^2}{1+s_{12}^2}$, and [@sjp-a].
:::

## Final Tail

This final tail is short on purpose. It keeps only wrapped inline math such as
$v_1+w_1$, $\frac{1+t_1^2}{1+u_1^2}$, and references like [@sjp-g] and [@sjp-l]
so that the last dense display corridor still sits close to the end of the file.

Another wrapped tail paragraph repeats $v_2+w_2$, $\sum_{i=1}^{10} i$, and
[@sjp-h].

The last wrapped tail paragraph repeats $v_3+w_3$, $\prod_{j=1}^{5}(1+\phi_j)$,
and [@sjp-k].

## Third Pass

::: {#sjp-m .lemma} Thirteenth corridor anchor
This corridor again combines $a_{13}+b_{13}$, $\alpha_{13}+\beta_{13}$, $\sum_{i=1}^{22} i$, [@sjp-j], and [@sjp-l] inside one intentionally wrapped paragraph so the inline replacement widgets stay dense immediately before the next display block turnover.
:::

::: {.proof}
The proof begins with $c_{13}+d_{13}$, $\frac{1+x_{13}^2}{1+y_{13}^2}$, and [@sjp-n].
$$
\Theta_{13}=\sum_{i=1}^{17}(u_i+12v_i)
$$
$$
\Lambda_{13}=\frac{1+x_{13}^2}{1+y_{13}^2}+\sum_{i=1}^{9} z_i
$$
It exits through one more wrapped sentence with $e_{13}+f_{13}$, $g_{13}+h_{13}$, and [@sjp-o].
:::

::: {#sjp-n .proposition} Fourteenth corridor anchor
The next wrapped paragraph compares $a_{14}+b_{14}$, $\sum_{i=1}^{23} i$, $\prod_{j=1}^{6}(1+\upsilon_j)$, [@sjp-k], and [@sjp-m] while holding the same line shape that has been useful for this repro.
:::

::: {.proof}
The proof uses $c_{14}+d_{14}$, $\alpha_{14}+\beta_{14}$, and [@sjp-o].
$$
\Theta_{14}=\sum_{i=1}^{18}(u_i+13v_i)
$$
$$
\Lambda_{14}=\frac{1+x_{14}^2}{1+y_{14}^2}+\sum_{i=1}^{10} z_i
$$
Then another wrapped exit sentence keeps $e_{14}+f_{14}$, $\frac{1+r_{14}^2}{1+s_{14}^2}$, and [@sjp-p].
:::

::: {#sjp-o .corollary} Fifteenth corridor anchor
Now $a_{15}+b_{15}$, $\alpha_{15}+\beta_{15}$, $\sum_{i=1}^{24} i$, [@sjp-m], and [@sjp-n] sit together on another wrapped paragraph directly before the next display turnover.
:::

::: {.proof}
The proof continues with $c_{15}+d_{15}$, $\prod_{j=1}^{5}(1+\varpi_j)$, and [@sjp-p].
$$
\Theta_{15}=\sum_{i=1}^{19}(u_i+14v_i)
$$
$$
\Lambda_{15}=\frac{1+x_{15}^2}{1+y_{15}^2}+\sum_{i=1}^{10} z_i
$$
Then one more wrapped sentence packs $e_{15}+f_{15}$, $g_{15}+h_{15}$, and [@sjp-j].
:::

::: {#sjp-p .theorem} Sixteenth corridor anchor
The last added corridor uses $a_{16}+b_{16}$, $\sum_{i=1}^{25} i$, $\prod_{j=1}^{6}(1+\omega_j)$, [@sjp-n], and [@sjp-o] in the same long wrapped band, placing inline replacement widgets right next to the final compact display-math pair.
:::

::: {.proof}
The proof uses $c_{16}+d_{16}$, $\frac{1+x_{16}^2}{1+y_{16}^2}$, and [@sjp-a].
$$
\Theta_{16}=\sum_{i=1}^{20}(u_i+15v_i)
$$
$$
\Lambda_{16}=\frac{1+x_{16}^2}{1+y_{16}^2}+\sum_{i=1}^{11} z_i
$$
Finally, another wrapped sentence keeps $e_{16}+f_{16}$, $\alpha_{16}+\beta_{16}$, and [@sjp-m] together before the end.
:::

## Very Short Tail

This last tail paragraph keeps only wrapped inline math like $w_4+z_4$,
$\frac{1+t_4^2}{1+u_4^2}$, and references like [@sjp-p] so the final dense
corridor still sits close to the bottom of the document.

## Fourth Pass

::: {#sjp-q .proposition} Seventeenth corridor anchor
This extra corridor keeps $a_{17}+b_{17}$, $\alpha_{17}+\beta_{17}$, $\sum_{i=1}^{26} i$, [@sjp-o], and [@sjp-p] on one wrapped paragraph so the same mixed block-and-inline turnover still occurs close to the end of the file.
:::

::: {.proof}
The proof begins with $c_{17}+d_{17}$, $\frac{1+x_{17}^2}{1+y_{17}^2}$, and [@sjp-r].
$$
\Theta_{17}=\sum_{i=1}^{21}(u_i+16v_i)
$$
$$
\Lambda_{17}=\frac{1+x_{17}^2}{1+y_{17}^2}+\sum_{i=1}^{11} z_i
$$
It exits with another wrapped sentence containing $e_{17}+f_{17}$, $g_{17}+h_{17}$, and [@sjp-a].
:::

::: {#sjp-r .theorem} Eighteenth corridor anchor
The final dense wrapped paragraph combines $a_{18}+b_{18}$, $\sum_{i=1}^{27} i$, $\prod_{j=1}^{6}(1+\Omega_j)$, [@sjp-q], and [@sjp-m], placing one last display-math pair right before the actual end of the document.
:::

::: {.proof}
The proof uses $c_{18}+d_{18}$, $\alpha_{18}+\beta_{18}$, and [@sjp-b].
$$
\Theta_{18}=\sum_{i=1}^{22}(u_i+17v_i)
$$
$$
\Lambda_{18}=\frac{1+x_{18}^2}{1+y_{18}^2}+\sum_{i=1}^{12} z_i
$$
Finally, the file ends with one wrapped sentence containing $e_{18}+f_{18}$,
$\frac{1+r_{18}^2}{1+s_{18}^2}$, and [@sjp-q].
:::
