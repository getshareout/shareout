# Knowledge retrieval eval

How well workspace Knowledge finds the passage that answers a question — Spanish first,
measured on a synthetic corpus through the real ingest and search code. It is the
baseline every knowledge change is judged against: **knowledge PRs must report eval
deltas** (chunking, text extraction, the FTS tokenizer or query, embeddings, fusion, the
permission filter). It is an on-demand gate: not part of `npm test`, `test:affected` or
the pre-push hook.

Current numbers: [BASELINE.md](BASELINE.md).

## Run it

From `shareout-app/`:

```bash
npm run eval:knowledge                     # keyword (FTS5) only, as this branch ships it — ~15 s, no credentials
npm run eval:knowledge -- --check          # validate the corpus + golden set only
npm run eval:knowledge -- --baseline       # also rewrite BASELINE.md's table + baseline.json
```

Dense (hybrid) retrieval embeds through the [Workers AI REST API](https://developers.cloudflare.com/workers-ai/get-started/rest-api/),
so it needs an account id and an API token with Workers AI permissions:

```bash
export CLOUDFLARE_ACCOUNT_ID=<account id> CLOUDFLARE_API_TOKEN=<token with Workers AI Read + Edit>
npm run eval:knowledge -- --dense                                   # the model the code asks for
npm run eval:knowledge -- --model @cf/baai/bge-m3                   # substitute another model
npm run eval:knowledge -- --model @cf/qwen/qwen3-embedding-0.6b
npm run eval:knowledge -- --model local-hash                        # offline plumbing check, toy vectors
```

Without the two variables `--dense` / `--model` stop before running (except `local-hash`).

Every run prints the report and writes `.eval/knowledge/results/<time>-<mode>[-<model>].{json,md}`
plus `.eval/knowledge/latest.{json,md}` (gitignored). The JSON keeps every question's ranks
and its top 10 hits (`doc § section`), for digging into a regression. When `baseline.json` exists the
report ends with **Δ vs baseline** per slice and the questions whose first gold passage
entered or left the top 10 — that table is what goes in a knowledge PR.

### Dense mode

| `--model` | Dims | Input the eval sends |
|---|--:|---|
| _(none)_ | — | exactly what the code sends, to the model the code names (today `@cf/baai/bge-base-en-v1.5` in `src/knowledge/corpus/{ingest,search}.ts`) |
| `@cf/baai/bge-base-en-v1.5` | 768 | `{ text }` — English-only, 512 tokens |
| `@cf/baai/bge-m3` | 1024 | `{ text }` — multilingual |
| `@cf/qwen/qwen3-embedding-0.6b` | 1024 | `{ documents }` for passages, `{ queries }` for questions (the model adds its retrieval instruction); ≤ 32 per call |
| `local-hash` | 256 | no API: hashed bag of words — proves the dense path runs, says nothing about quality |

Without `--model` a branch that switches the embedding model is measured as it ships;
`--model` compares candidates before touching the code. Vectors live in an in-memory
cosine index (production: Vectorize, cosine). Embeddings are cached per model in
`.eval/knowledge/cache/<model>.jsonl`, keyed by input field + text, so a repeat run only
pays for passages and questions it hasn't seen (a first run embeds ~600 passages and ~420
questions, roughly 70k tokens — under a cent at list prices). The graph extractor's LLM
call is not wired in the eval — search doesn't read the graph.

## How it works

1. `golden.mjs` loads and validates the fixtures (`tests/fixtures/knowledge-eval`).
2. `vitest.eval.config.ts` starts the Workers pool (Miniflare, the real D1 migrations, a
   real `KnowledgeStore` Durable Object) with one extra service binding back into Node
   (`scripts/lib/knowledge-eval-host.mjs`) for embeddings and the report.
3. `retrieval.eval.ts` publishes every doc the way the product stores it — pages as
   artifact + version + production deployment + HTML assets in R2, files as Assets in the
   workspace bucket (deliverable + blob in R2) — into three workspaces:
   - **main**: everything, including docs private to another member;
   - **control**: only what the eval member can see — the ideal list for starvation;
   - **stress**: what the member can see plus another member's private copies of all of
     it (2 per doc), so most passages matching any question are ones the member can't read.
4. It learns them with `forceIngest()` (the reindex path: the same extract → chunk →
   `KnowledgeStore` FTS5 → embed steps as publish-time ingest), then drains each store's
   alarms so background indexing — the stemmed-index backfill — is finished before any
   question. Every source must end `ready`, and every gold evidence must sit in some learned
   passage of its doc, or the run fails.
5. Every question goes through `searchCorpus(env, ws, member, q, { limit: 20, full: true })`
   in all three workspaces. Retrieval is a black box: nothing in `src/` is re-implemented, so
   the eval measures whatever chunker, tokenizer, query and model the branch has. The only
   stand-ins, in dense mode, are the `AI` binding (embeddings only) and `KNOWLEDGE_VECTORS`.
6. A hit counts for a gold passage when it comes from the gold doc (or one of its `alt`s)
   **and** its passage text contains the gold evidence (NFC, lowercase, whitespace
   collapsed). That ties relevance to the answer, not to chunk boundaries, so the golden
   set survives chunker changes.

## Metrics

| Metric | Meaning |
|---|---|
| R@5 / R@10 / R@20 | Share of a question's gold passages in the top k, averaged over questions (one-passage questions: hit@k). |
| nDCG@10 | Binary gains, ideal = every gold passage at the top. |
| MRR | 1 / rank of the first gold passage in the top 20, else 0. |
| doc R@10 | Like R@10, but any passage of the gold doc counts — "right doc, wrong passage" shows as doc R@10 ≫ R@10. |
| zero | Questions with no results at all. |
| starved | The member got fewer results than in control (`< min(20, control)`): private passages filled the candidate pool before the permission post-filter. |
| perm loss | The first gold passage is in control's top 10 but not in main's: what other members' private docs cost this member. |
| stress row | The same questions in the stress workspace; its starved and perm loss compare with control too. Starvation sits near 100% while the permission filter runs after a fixed candidate pool — the number a fix should move. |
| p50 / p95 ms | `searchCorpus` wall time in local Miniflare, query-embedding time excluded. Compare runs on one machine; it is not production latency. |

## Slices

- **lang** — question language → answer language: `es`, `en`, `es→en` (Spanish question,
  English doc), `en→es`.
- **type** — `lookup` (shares the doc's terms) · `keyword` (2–5 word search-box query) ·
  `paraphrase` (same meaning, other words) · `numeric` (answer is a number, amount, date) ·
  `long` (chat-style, ≥ 20 words, key terms late — today's FTS query keeps only the first 12 words) ·
  `typo` (missing accents, swapped letters, "q"/"xq") · `inflection` (another form of the
  doc's words: plural, verb ↔ noun, tense) · `multihop` (needs 2+ passages; recall counts each).
- **source** — format of the gold doc: `page` (one HTML page), `site` (multi-page HTML),
  `md`, `txt`, `json` files.
- **genre** — report, campaign-results, procedure, onboarding, glossary, meeting-notes,
  pricing, policy, catalog, slides, table, brief, reference.
- **tag: perm** — a private near-duplicate owned by another member competes with the gold
  doc (a 2027 draft rate card, an unreviewed draft report, a confidential returns policy).
- **stress: most matches private** — every question again, in the stress workspace.

## The corpus and the golden set

Everything is synthetic and written for this eval; there is no customer data. The
workspace is a fictional Latin American digital agency, **Acme Digital** (Buenos Aires,
remote team across Montevideo, Santiago, Mexico City and Bogotá), and its clients, all
placeholder names: Globex (consumer goods), Initech (B2B SaaS), Northwind Market and
Contoso Retail (e-commerce), Fabrikam (furniture), Hooli Pay (fintech), Umbrella Salud
(clinics), Vandelay (a prospect) and Tailspin (travel). Third parties use the same kind of
names (Woodgrove, Litware, Proseware, Wide World…); real platforms appear only as channels
(Google Ads, Meta Ads, WhatsApp…).

Layout: `corpus/<cluster>/_manifest.json` lists a cluster's docs (title, kind, language,
genre, visibility, owner) next to their files; `golden/<cluster>.json` holds its questions.

How it was made:

1. A fixed world spec (people, account leads, clients, allowed third-party names, dates)
   and a document plan per cluster — internal ops and HR, commercial terms and procedures,
   two client accounts, e-commerce, five more clients — with explicit scopes so each fact
   lives in one place.
2. Documents and questions were drafted per cluster with an LLM against that spec: mostly
   Spanish (Rioplatense voseo for the agency's internal docs; Chilean, Mexican, Colombian
   and Uruguayan business Spanish for clients), about a fifth English, and mixed docs
   (English slide titles over Spanish bodies). Formats: HTML pages and one multi-page site,
   markdown, plain-text minutes, a JSON catalog export, spreadsheet-like tables.
3. Distractors on purpose: three monthly reports with identical structure, 2025 and 2026
   rate cards, two stores with similar returns policies, three sets of leadership minutes,
   and private near-duplicates owned by another member (a 2027 draft rate card, an
   unreviewed draft report, a draft returns policy, confidential salary bands…).
4. `npm run eval:knowledge -- --check` enforces the rules below; the eval itself re-checks
   every evidence against the passages the real chunker produced. Cross-cluster multi-hop
   questions were added by hand. Every question whose gold wasn't ranked first was then
   reviewed (LLM, then by hand) against the passages ranked above it, looking for a second
   right answer or an underspecified question; that review added the section-scoped alts
   below.

Question rules:

- Exactly one right place to find the answer (or the places listed, for multihop / `alt`).
  When near-duplicates exist, the question names which one (month, year, client, "vigente").
- `evidence` is a verbatim span of the gold section containing the answer, within one
  sentence or table cell, once in its doc and in no other visible doc (else it's an `alt`).
  When the same answer is also a bare table cell elsewhere in the doc (a number in a
  summary sentence and again in a table), list that section as an `alt` with
  `"scope": "section"`: only passages located in that section count, so its evidence can
  be the bare value (`"58"`).
- Never gold on a doc private to another member; `perm` marks questions where one competes.
- Every visible doc has at least one question.

### Changing it

- Fixture changes go in their own commit with the reason; never tune questions to make a
  retrieval change look better.
- Add docs to a cluster's `_manifest.json`, questions to its golden file (next free id),
  then `npm run eval:knowledge -- --check` and a run.
- After a change that moves the numbers on purpose lands, re-baseline in that PR with
  `npm run eval:knowledge -- --baseline` (keyword-only: the path every install has) and
  commit `BASELINE.md` + `baseline.json`; update its notes by hand.
