# App Pages (Admin, Settings, Management)

Rules for the working surfaces of Studio: Admin, settings, and any menu where someone manages people, content, money or configuration. The reference implementation is **Studio → Admin** (`shareout-app/src/pages/home/render-workspace/admin-nav.ts`, `client-script/home-views/admin*.ts`, styles in `styles-lenses.ts` under `.wsx-adm`).

[page-composition.md](page-composition.md) covers marketing pages, where the job is to persuade. This doc covers pages where the job is to **find, understand and act**, so every rule here reduces scrolling, guessing and hunting.

> The test: a new admin opens the page cold and, in five seconds, knows where they are, what this page is for, and whether anything needs them.

---

## Navigation

Navigation has to look like navigation. Filter chips are not tabs.

- **More than ~5 destinations → a sidebar**, grouped under short uppercase headings (People, Content, AI & billing, Security, Workspace). Up to 5 → real tabs (underlined, not pill chips).
- **Group by what the user is doing, not by how the code is split.** Ask "where would I look for this?" Billing is its own entry even though it paints two panels.
- **One entry = one page.** Never stack unrelated panels under one tab. If a page needs a scroll-to-subtitle to find something, it is two pages.
- **Active state is unmistakable:** tinted background, accent text and a 3px accent bar on the leading edge (`.wsx-adm__it.is-on`), plus `aria-current="page"`.
- Every entry has an icon (the rail's line icons, 18px, stroke 1.8). No emoji.
- **Narrow screens:** the sidebar becomes a horizontal scroll strip, the group headings hide, and the active entry gets an underline.
- **Old links keep working.** When you rename or merge destinations, map the old keys (`AD_ALIAS`) so deep links, ⌘K and emails still land somewhere sensible. Test it (`admin-nav.test.ts`).
- **No dashboard page "just because".** A summary page that repeats numbers from the other pages is a second place to look. Put each number on the page it describes. Surface what needs attention as badges instead (below).

---

## Page anatomy

Every page has the same order, top to bottom:

1. **Header:** title (`--text-h3`, display font) plus **one line** saying what the page is for, written from the user's side ("Who can open and edit this workspace, and how much they use it."). The page's single primary action sits on the right of the title row (e.g. *Invite people*), not inside a card further down.
2. **Alerts:** only when something needs action (see *Color & attention*).
3. **KPI row:** 2–4 tiles with the page's key numbers. Big value (1.6rem display), small uppercase label, one muted sub-line. Color a value only when it needs attention (amber pending, red failing).
4. **Cards:** one card per topic (`.wsx-admin__settings-section` inside `.wsx-adm__main`): title, one-line intro, then content. Put action items (requests, failures) before configuration, and configuration before reference lists.
5. **Folded detail:** reference tables and long read-only lists go in a `<details>` card whose summary is the title plus a one-line description (`.wsx-adm__fold`).

A card inside a card loses its border and becomes a divided sub-section. Never nest boxes visually.

---

## Color & attention

Color is information, not decoration. Neutral by default; color means *look here*.

| Meaning | Treatment |
|---|---|
| Needs a decision soon (pending invite, request, approval, budget near, unpaid invoice) | **Amber:** `--color-warning` on `--color-warning-light` |
| Broken or blocked (failing job, budget reached) | **Red:** `--color-error` on `--color-error-light` |
| Healthy / on | Green chip (`.wsx-admin__rolebadge.is-on`), used sparingly |
| Off / paused / inactive | Muted grey chip, never red |
| Selected / where you are | Accent (`--color-primary`) only |

- **Badges on the nav entry** carry the *count of things* that need you, not the count of alert lines: 2 invites → "2". Red wins over amber when both exist.
- **A banner at the top of that page** repeats each item in a sentence plus a *Review* button that scrolls to the exact row.
- Quiet facts ("3 inactive members", "1 public page") go in a KPI sub-line, not in an alert. If everything is an alert, nothing is.

---

## Long content: show the top, expand the rest

Nothing should push the page's purpose below the fold.

- **Tables and lists over 10 rows show 8** and a *Show all (N)* link under them (`adFold`). The open or closed choice survives re-sorts and repaints. Don't fold 9–10 rows to hide just one or two.
- **Reference data** (daily breakdowns, per-member caps, feature catalogs) starts folded behind a one-line summary that already answers the common question ("12 of 20 on").
- Wide tables scroll inside their card, never the page. Keep the identifying column first and actions last. Above ~7 columns, move secondary columns behind a toggle and row actions into a ⋯ menu.
- Two related, short cards can sit side by side (`.wsx-adm__two`, auto-fit ≥ 300px), e.g. *spend by category* beside *AI by kind*.

---

## Never lose a feature

Simplify by hiding and regrouping, never by deleting.

- Every panel that existed before a redesign must still be reachable from the nav. A feature reachable only via ⌘K is nearly lost.
- If something truly is dead (e.g. a plan tile that always reads "Free" because the build has no billing), say so in the PR when removing it.
- Every page keeps an empty state ("No invoices yet.") instead of disappearing. A section that hides when empty looks like a missing feature.

---

## Money & cost (customer-facing)

- Customers see **what they pay**, never what it costs us: no markup multipliers, "service fee %", "at list price" or provider-cost wording in customer copy. Operator-only detail is gated behind the operator's role.
- Billing gets its own page: this month (spend, pace, last month), the budget, where it went, then invoices.

---

## Copy

- Page descriptions and card intros: one sentence, plain words, user's point of view, no jargon ("crew", "ledger", "BYO").
- Alerts are sentences with the number first: "2 pending invites", "1 automation failing".
- Every string ships in English and Spanish. Short sidebar labels live in the boot copy (`home-i18n/copy/admin.ts`). Page descriptions, alerts and other long strings live in the lazy chunk's copy (`admin-page-copy.ts`) so the boot bundle stays inside its budget.

---

## Implementation notes

- **Sidebar markup** is server-rendered (`adminNavHtml()`); the **page → panels map** is client-side (`AD_SECTIONS`). A test keeps the two in sync, and every page needs a title plus a description in both languages.
- One painter may serve several pages (Security → Access, Publishing, Tokens, Audit); it paints only the blocks for the current page and guards every handler with `if (el)`.
- Attention data is fetched once per workspace (`adNeeds`, cached in `adDataCache._needs`) and refreshed on `adReload()`.
- Files have a 1000-line cap; split by concern (`admin-attention.ts`), never raise the cap.
- Before shipping, walk the real page in the shared browser with realistic data (`mc browser run`). Tests don't show hierarchy.

---

## Pre-ship checklist

- [ ] Navigation looks like navigation (sidebar or underlined tabs), active entry unmistakable
- [ ] One entry = one page; no stacked unrelated panels; no summary page that duplicates others
- [ ] Every page: title + one-line purpose; primary action in the title row
- [ ] What needs action shows first: nav badge with the real count + banner with a jump to the row
- [ ] Amber = needs a decision, red = broken, grey = off; color nowhere else
- [ ] KPI row ≤ 4 tiles; numbers live on the page they describe
- [ ] Lists > 10 rows fold to 8 with *Show all (N)*; reference data folded with a useful summary
- [ ] Wide tables scroll inside their card; ≤ ~7 visible columns
- [ ] Every old panel still reachable; old deep links still land; empty states instead of vanishing sections
- [ ] No cost basis or markup in customer copy
- [ ] EN + ES copy; long strings in the lazy chunk
- [ ] Walked in the shared browser with realistic data; before/after screenshots on the PR

---

*See also: [layout.md](layout.md) · [components.md](components.md) · [../principles/design_principles.md](../principles/design_principles.md) · [../brand/voice.md](../brand/voice.md)*
