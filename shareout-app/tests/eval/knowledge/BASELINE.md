# Knowledge retrieval baseline

What `main` ships today, measured with `npm run eval:knowledge`: **keyword only**, no
embeddings. Since #222 that is the Spanish-aware keyword search: a stemmed shadow index
(Snowball-style Spanish/English stems) next to the plain FTS5 one, Spanish and English
stopwords dropped, the 12 rarest query terms kept, chunks holding every term first and
any term after, prefix match for partial words. Knowledge PRs report their deltas against
it — `baseline.json` next to this file is what the "Δ vs baseline" table reads. How the
eval works and how to read each column: [README.md](README.md).

<!-- eval:table -->
_keyword · commit 5b8e7ecf · 2026-10-26 · 89 docs (10 private to another member) · 588 chunks · 416 questions · top 20_

| Slice | n | R@5 | R@10 | R@20 | nDCG@10 | MRR | doc R@10 | zero | starved | perm loss | p50 ms | p95 ms |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| **all** | 416 | 0.718 | 0.789 | 0.843 | 0.650 | 0.626 | 0.871 | 0.0% | 0.2% | 0.2% | 5.0 | 8.0 |
| lang: es | 217 | 0.864 | 0.937 | 0.954 | 0.796 | 0.769 | 0.961 | 0.0% | 0.0% | 0.0% | 5.0 | 9.0 |
| lang: en | 60 | 0.917 | 0.958 | 0.958 | 0.881 | 0.870 | 0.992 | 0.0% | 0.0% | 0.0% | 4.0 | 7.0 |
| lang: es→en | 60 | 0.458 | 0.492 | 0.650 | 0.376 | 0.375 | 0.767 | 0.0% | 0.0% | 1.7% | 4.0 | 9.0 |
| lang: en→es | 79 | 0.361 | 0.481 | 0.595 | 0.281 | 0.239 | 0.614 | 0.0% | 1.3% | 0.0% | 5.0 | 7.0 |
| type: lookup | 49 | 0.612 | 0.694 | 0.796 | 0.550 | 0.511 | 0.816 | 0.0% | 0.0% | 0.0% | 4.0 | 9.0 |
| type: keyword | 49 | 0.857 | 0.857 | 0.878 | 0.758 | 0.727 | 0.898 | 0.0% | 0.0% | 0.0% | 4.0 | 7.0 |
| type: paraphrase | 50 | 0.340 | 0.480 | 0.560 | 0.272 | 0.214 | 0.700 | 0.0% | 0.0% | 0.0% | 4.0 | 8.0 |
| type: numeric | 50 | 0.720 | 0.800 | 0.860 | 0.670 | 0.634 | 0.880 | 0.0% | 2.0% | 0.0% | 5.0 | 8.0 |
| type: long | 50 | 0.740 | 0.780 | 0.780 | 0.635 | 0.589 | 0.840 | 0.0% | 0.0% | 0.0% | 6.0 | 9.0 |
| type: typo | 50 | 0.900 | 0.900 | 0.940 | 0.757 | 0.712 | 0.940 | 0.0% | 0.0% | 2.0% | 4.0 | 10 |
| type: inflection | 50 | 0.860 | 1.000 | 1.000 | 0.819 | 0.763 | 1.000 | 0.0% | 0.0% | 0.0% | 4.0 | 7.0 |
| type: multihop | 68 | 0.713 | 0.799 | 0.904 | 0.714 | 0.796 | 0.890 | 0.0% | 0.0% | 0.0% | 5.0 | 21 |
| source: page | 177 | 0.732 | 0.796 | 0.856 | 0.666 | 0.660 | 0.887 | 0.0% | 0.0% | 0.6% | 5.0 | 9.0 |
| source: site | 11 | 0.636 | 0.636 | 0.727 | 0.604 | 0.672 | 0.682 | 0.0% | 0.0% | 0.0% | 5.0 | 8.0 |
| source: md | 229 | 0.707 | 0.792 | 0.841 | 0.649 | 0.621 | 0.876 | 0.0% | 0.4% | 0.0% | 4.0 | 9.0 |
| source: txt | 24 | 0.750 | 0.875 | 0.917 | 0.740 | 0.719 | 0.875 | 0.0% | 0.0% | 0.0% | 5.0 | 7.0 |
| source: json | 6 | 0.750 | 0.750 | 0.833 | 0.449 | 0.408 | 0.750 | 0.0% | 0.0% | 0.0% | 4.0 | 4.0 |
| genre: report | 29 | 0.759 | 0.891 | 0.931 | 0.717 | 0.685 | 0.948 | 0.0% | 0.0% | 0.0% | 4.0 | 6.0 |
| genre: campaign-results | 40 | 0.800 | 0.838 | 0.900 | 0.724 | 0.752 | 0.875 | 0.0% | 0.0% | 0.0% | 5.0 | 8.0 |
| genre: procedure | 60 | 0.725 | 0.750 | 0.817 | 0.659 | 0.666 | 0.850 | 0.0% | 0.0% | 0.0% | 5.0 | 7.0 |
| genre: onboarding | 12 | 0.667 | 0.708 | 0.833 | 0.582 | 0.563 | 0.833 | 0.0% | 0.0% | 0.0% | 4.0 | 10 |
| genre: glossary | 11 | 0.636 | 0.773 | 0.864 | 0.706 | 0.748 | 0.773 | 0.0% | 0.0% | 0.0% | 3.0 | 5.0 |
| genre: meeting-notes | 40 | 0.738 | 0.850 | 0.875 | 0.722 | 0.703 | 0.900 | 0.0% | 2.5% | 0.0% | 5.0 | 10 |
| genre: pricing | 28 | 0.768 | 0.821 | 0.839 | 0.669 | 0.643 | 0.929 | 0.0% | 0.0% | 0.0% | 5.0 | 9.0 |
| genre: policy | 129 | 0.667 | 0.760 | 0.806 | 0.612 | 0.584 | 0.849 | 0.0% | 0.0% | 0.0% | 4.0 | 8.0 |
| genre: catalog | 9 | 0.833 | 0.833 | 0.889 | 0.591 | 0.550 | 0.833 | 0.0% | 0.0% | 0.0% | 4.0 | 6.0 |
| genre: slides | 23 | 0.696 | 0.717 | 0.870 | 0.613 | 0.605 | 0.935 | 0.0% | 0.0% | 0.0% | 4.0 | 7.0 |
| genre: table | 13 | 0.731 | 0.769 | 0.846 | 0.602 | 0.584 | 0.885 | 0.0% | 0.0% | 0.0% | 5.0 | 23 |
| genre: brief | 37 | 0.797 | 0.901 | 0.959 | 0.706 | 0.678 | 0.946 | 0.0% | 0.0% | 2.7% | 5.0 | 17 |
| genre: reference | 28 | 0.607 | 0.679 | 0.714 | 0.621 | 0.655 | 0.714 | 0.0% | 0.0% | 0.0% | 5.0 | 8.0 |
| tag: perm | 66 | 0.697 | 0.808 | 0.871 | 0.614 | 0.578 | 0.864 | 0.0% | 0.0% | 0.0% | 5.0 | 8.0 |
| stress: most matches private | 416 | 0.721 | 0.793 | 0.793 | 0.654 | 0.627 | 0.871 | 0.0% | 99.0% | 0.0% | 5.0 | 8.0 |
<!-- /eval:table -->

## What it says

_Written by hand from the run above; update it when you re-baseline._

- **Within one language, keyword search now finds almost everything that shares a stem
  with the passage:** lookup, keyword, numeric and inflection questions all reach R@10
  1.000 (same-language), long chat-style questions 0.968, typos 0.950, multihop 0.904.
- **Paraphrase is the remaining same-language gap** (R@10 0.692, MRR 0.308): other words for
  the same thing ("¿cuánto me devuelven si…" for "reintegro") don't share a stem.
- **Cross-language improved but stays the main gap:** R@10 0.486 over es→en and en→es
  (en→es 0.481, es→en 0.492) — carried by the names, numbers and cognates a question shares
  with the passage, now that function words no longer swamp the query. This is what
  multilingual embeddings are for.
- **Right doc, wrong passage:** doc R@10 0.871 against R@10 0.789.
- **Permissions:** with 10 of 89 docs private to another member, starvation is 0.2% (one
  question) and perm loss 0.2%. The stress workspace shows the failure mode: when most
  matching passages are private to someone else, 99% of questions return fewer results
  than control (10 instead of 20 on average), because the permission filter runs after a
  fixed pool of 30 candidates. R@10 holds (0.793) but everything past the 10th visible
  result is lost (R@20 0.793 against 0.843).
- **Latency:** p50 5 ms / p95 8 ms for `searchCorpus` in local Miniflare — up from 4 / 6
  ms before #222 (two MATCH passes plus vocabulary lookups). Relative, not production.
- Three questions left the top 10 with #222 (ag-039, ag-080, gi-050); 91 entered it.

Dense (hybrid) retrieval isn't in this baseline — it needs Workers AI credentials. Compare
candidate models with `npm run eval:knowledge -- --model <id>` (README.md); a dense run's
"Δ vs baseline" table is the gain over keyword-only.

## History

Each baseline's overall row. "Measured on" is the `main` commit the eval ran against (the
branch commit in the table header above disappears when a PR is squash-merged). The
stress row starts with the #222 baseline.

| Date | Measured on | Keyword search | R@5 | R@10 | R@20 | nDCG@10 | MRR | doc R@10 | starved | perm loss | p50 ms |
|---|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 2026-10-26 | `main` 5cf45578 | Spanish-aware: stems, stopwords, rarest terms, all-then-any, prefix (#222) | 0.718 | 0.789 | 0.843 | 0.650 | 0.626 | 0.871 | 0.2% | 0.2% | 5.0 |
| 2026-10-26 | `main` 390eb0d6 | `unicode61` FTS5, first 12 words ORed, no stemming or stopwords | 0.507 | 0.571 | 0.644 | 0.447 | 0.433 | 0.698 | 0.0% | 0.7% | 4.0 |

What #222 moved, R@10 per slice (390eb0d6 → 5cf45578):

| Slice | n | before | after | Δ |
|---|--:|--:|--:|--:|
| lang: es | 217 | 0.700 | 0.937 | +0.237 |
| lang: en | 60 | 0.842 | 0.958 | +0.117 |
| lang: es→en | 60 | 0.333 | 0.492 | +0.158 |
| lang: en→es | 79 | 0.190 | 0.481 | +0.291 |
| type: inflection | 50 | 0.420 | 1.000 | +0.580 |
| type: long | 50 | 0.240 | 0.780 | +0.540 |
| type: typo | 50 | 0.860 | 0.900 | +0.040 |
| type: paraphrase | 50 | 0.320 | 0.480 | +0.160 |
| type: lookup | 49 | 0.490 | 0.694 | +0.204 |
| type: numeric | 50 | 0.700 | 0.800 | +0.100 |
| type: multihop | 68 | 0.667 | 0.799 | +0.132 |
| tag: perm | 66 | 0.543 | 0.808 | +0.265 |
