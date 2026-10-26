# Knowledge retrieval baseline

What `main` ships today, measured with `npm run eval:knowledge`: **keyword only** (FTS5
`unicode61 remove_diacritics 2`, no stemming or stopwords, the first 12 words of the
question ORed, bm25 with titles ×2; no embeddings). Knowledge PRs report their deltas
against it — `baseline.json` next to this file is what the "Δ vs baseline" table reads.
How the eval works and how to read each column: [README.md](README.md).

<!-- eval:table -->
_keyword · commit f6d2aa6c · 2026-10-26 · 89 docs (10 private to another member) · 588 chunks · 416 questions · top 20_

| Slice | n | R@5 | R@10 | R@20 | nDCG@10 | MRR | doc R@10 | zero | starved | perm loss | p50 ms | p95 ms |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| **all** | 416 | 0.507 | 0.571 | 0.644 | 0.447 | 0.433 | 0.698 | 0.0% | 0.0% | 0.7% | 4.0 | 6.0 |
| lang: es | 217 | 0.624 | 0.700 | 0.783 | 0.558 | 0.547 | 0.854 | 0.0% | 0.0% | 0.9% | 4.0 | 6.0 |
| lang: en | 60 | 0.775 | 0.842 | 0.883 | 0.684 | 0.650 | 0.925 | 0.0% | 0.0% | 0.0% | 3.0 | 4.0 |
| lang: es→en | 60 | 0.283 | 0.333 | 0.400 | 0.256 | 0.248 | 0.475 | 0.0% | 0.0% | 1.7% | 4.0 | 5.0 |
| lang: en→es | 79 | 0.152 | 0.190 | 0.266 | 0.110 | 0.095 | 0.266 | 0.0% | 0.0% | 0.0% | 3.0 | 6.0 |
| type: lookup | 49 | 0.469 | 0.490 | 0.592 | 0.387 | 0.360 | 0.592 | 0.0% | 0.0% | 0.0% | 4.0 | 5.0 |
| type: keyword | 49 | 0.837 | 0.837 | 0.857 | 0.743 | 0.714 | 0.878 | 0.0% | 0.0% | 0.0% | 3.0 | 5.0 |
| type: paraphrase | 50 | 0.280 | 0.320 | 0.440 | 0.199 | 0.168 | 0.540 | 0.0% | 0.0% | 0.0% | 4.0 | 6.0 |
| type: numeric | 50 | 0.600 | 0.700 | 0.700 | 0.552 | 0.507 | 0.720 | 0.0% | 0.0% | 0.0% | 4.0 | 6.0 |
| type: long | 50 | 0.160 | 0.240 | 0.360 | 0.139 | 0.115 | 0.420 | 0.0% | 0.0% | 0.0% | 4.0 | 8.0 |
| type: typo | 50 | 0.800 | 0.860 | 0.880 | 0.725 | 0.685 | 0.900 | 0.0% | 0.0% | 2.0% | 4.0 | 6.0 |
| type: inflection | 50 | 0.300 | 0.420 | 0.560 | 0.217 | 0.164 | 0.720 | 0.0% | 0.0% | 4.0% | 4.0 | 5.0 |
| type: multihop | 68 | 0.586 | 0.667 | 0.733 | 0.574 | 0.668 | 0.784 | 0.0% | 0.0% | 0.0% | 4.0 | 7.0 |
| source: page | 177 | 0.519 | 0.606 | 0.697 | 0.461 | 0.457 | 0.745 | 0.0% | 0.0% | 1.7% | 4.0 | 7.0 |
| source: site | 11 | 0.318 | 0.318 | 0.318 | 0.321 | 0.394 | 0.545 | 0.0% | 0.0% | 0.0% | 4.0 | 8.0 |
| source: md | 229 | 0.517 | 0.563 | 0.628 | 0.458 | 0.447 | 0.689 | 0.0% | 0.0% | 0.0% | 4.0 | 6.0 |
| source: txt | 24 | 0.563 | 0.646 | 0.688 | 0.543 | 0.539 | 0.646 | 0.0% | 0.0% | 0.0% | 4.0 | 5.0 |
| source: json | 6 | 0.583 | 0.750 | 0.750 | 0.480 | 0.454 | 0.750 | 0.0% | 0.0% | 0.0% | 3.0 | 5.0 |
| genre: report | 29 | 0.511 | 0.598 | 0.787 | 0.490 | 0.512 | 0.787 | 0.0% | 0.0% | 0.0% | 4.0 | 9.0 |
| genre: campaign-results | 40 | 0.475 | 0.700 | 0.762 | 0.483 | 0.470 | 0.787 | 0.0% | 0.0% | 0.0% | 4.0 | 5.0 |
| genre: procedure | 60 | 0.458 | 0.517 | 0.567 | 0.398 | 0.388 | 0.633 | 0.0% | 0.0% | 0.0% | 4.0 | 8.0 |
| genre: onboarding | 12 | 0.375 | 0.458 | 0.583 | 0.318 | 0.286 | 0.583 | 0.0% | 0.0% | 0.0% | 4.0 | 6.0 |
| genre: glossary | 11 | 0.545 | 0.682 | 0.773 | 0.560 | 0.584 | 0.773 | 0.0% | 0.0% | 0.0% | 4.0 | 6.0 |
| genre: meeting-notes | 40 | 0.575 | 0.625 | 0.688 | 0.550 | 0.558 | 0.675 | 0.0% | 0.0% | 0.0% | 4.0 | 5.0 |
| genre: pricing | 28 | 0.500 | 0.518 | 0.625 | 0.446 | 0.481 | 0.714 | 0.0% | 0.0% | 0.0% | 4.0 | 4.0 |
| genre: policy | 129 | 0.500 | 0.535 | 0.585 | 0.421 | 0.402 | 0.671 | 0.0% | 0.0% | 0.8% | 4.0 | 6.0 |
| genre: catalog | 9 | 0.722 | 0.833 | 0.833 | 0.653 | 0.636 | 0.833 | 0.0% | 0.0% | 0.0% | 3.0 | 5.0 |
| genre: slides | 23 | 0.609 | 0.652 | 0.717 | 0.499 | 0.502 | 0.848 | 0.0% | 0.0% | 0.0% | 4.0 | 5.0 |
| genre: table | 13 | 0.462 | 0.500 | 0.577 | 0.414 | 0.443 | 0.731 | 0.0% | 0.0% | 0.0% | 4.0 | 5.0 |
| genre: brief | 37 | 0.590 | 0.631 | 0.752 | 0.526 | 0.551 | 0.752 | 0.0% | 0.0% | 5.4% | 4.0 | 7.0 |
| genre: reference | 28 | 0.518 | 0.607 | 0.643 | 0.485 | 0.472 | 0.661 | 0.0% | 0.0% | 0.0% | 4.0 | 7.0 |
| tag: perm | 66 | 0.475 | 0.543 | 0.657 | 0.422 | 0.428 | 0.694 | 0.0% | 0.0% | 1.5% | 4.0 | 6.0 |
<!-- /eval:table -->

## What it says

_Written by hand from the run above; update it when you re-baseline._

- **When the question uses the passage's words, keyword search works.** Same-language
  lookup and numeric questions: R@10 1.000; keyword queries 0.968; typos 0.950
  (`remove_diacritics` absorbs missing accents, which are most typos).
- **Morphology and wording are the Spanish gap.** Inflection R@10 0.420 (Spanish alone:
  0.333) — no stemming, so "encuestas" misses "encuesta", "kickoffs" misses "kickoff" and
  "¿se renueva?" misses "renovación"; paraphrase 0.615 within a language.
- **Long chat-style questions fail on the query, not the corpus:** same-language R@10 0.355,
  though doc R@10 is 0.645. They average 32 words and the query keeps only the first 12,
  mostly context ("Necesito armar un resumen para el directorio de Umbrella Salud y me
  falta el dato de…").
- **Cross-language is out of reach for keywords:** R@10 0.252 over es→en and en→es (en→es
  0.190); what it finds comes from shared names and numbers. This is the multilingual-embeddings
  target — keyword-only can't move it.
- **Right doc, wrong passage:** doc R@10 0.698 against R@10 0.571 overall.
- **Permissions:** no starvation at top 20 — with 10 of 89 docs private to another member,
  the 30-candidate pool always kept enough visible passages (every member query returned
  as many results as control). Perm loss 0.7% (1.5% on the `perm` slice): three answers
  slip from rank 9–10 to 11–12, because private docs the member can't see still shift the
  term statistics bm25 ranks with.
- **Latency:** p50 4 ms / p95 6 ms for `searchCorpus` in local Miniflare — a reference for
  relative changes (a heavier tokenizer, query expansion), not production latency.

Dense (hybrid) retrieval isn't in this baseline — it needs Workers AI credentials. Compare
candidate models with `npm run eval:knowledge -- --model <id>` (README.md); a dense run's
"Δ vs baseline" table is the gain over keyword-only.
