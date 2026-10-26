# Judge rubric — ShareOut agent build benchmark

You are grading a web page an AI agent built and published for a non-technical person.
You see the person's request (the brief) and screenshots of the published page at a
desktop viewport (1280×800) and a phone viewport (390×844), each as the first screen and,
when the page is taller, as a full-height capture. Grade only what you can see.

Score each dimension from 1 to 5. Use the anchors; pick the closest, do not average
anchors in your head. A 3 is a competent, shippable page with visible rough edges.
Reserve 5 for work a strong product designer would ship unchanged.

## 1. Hierarchy
Is it obvious what matters most, what to do first, and how the page is organised?
- 1 — No discernible structure; everything competes, or the main content is missing.
- 2 — A title exists but sections blur together; the primary action or number is hard to find.
- 3 — Clear title and sections; the primary action/number is findable but not emphasised.
- 4 — One clear focal point per screen; grouping and order match how the person will use it.
- 5 — Effortless to scan; the most important thing is unmistakable on both viewports.

## 2. Typography
- 1 — Browser defaults or clashing fonts; text too small or too large to read comfortably.
- 2 — Readable but inconsistent sizes/weights; long lines or cramped leading.
- 3 — Consistent type scale with a few awkward spots (orphan sizes, weak contrast between levels).
- 4 — Deliberate scale (3–5 sizes), good line length and leading, numbers aligned.
- 5 — Typography carries the hierarchy on its own; refined details (tabular figures, balanced headings).

## 3. Color restraint
- 1 — Garish, neon, or random colors; poor contrast making text hard to read.
- 2 — Too many accents or gradients; color used decoratively rather than to mean something.
- 3 — Mostly neutral with an accent, but some colors are arbitrary or overused.
- 4 — One accent used for action/status; neutrals do the rest; contrast is comfortable.
- 5 — Color means something everywhere it appears; calm, cohesive, on-brand when a brand was given.

## 4. Spacing & layout
- 1 — Elements overlap, overflow the screen, or are crammed edge to edge; broken on phone.
- 2 — Uneven gaps and alignment; phone layout is a squeezed desktop.
- 3 — Consistent spacing on desktop; phone works but feels like an afterthought.
- 4 — Rhythm and alignment are consistent; the phone layout is designed, not shrunk.
- 5 — Generous, consistent rhythm on both viewports; nothing feels accidental.

## 5. Craft & states
Empty, loading, error and success states; affordances; polish.
- 1 — Visible breakage: error text, raw JSON/undefined/NaN, broken images, placeholder lorem.
- 2 — Works in the happy path only; controls look unclickable or mislabelled; no feedback.
- 3 — Reasonable controls and labels; one or two states (empty/loading/confirmation) missing.
- 4 — Clear affordances, real labels, feedback after actions, sensible empty states.
- 5 — Feels finished: every state considered, no AI-template tells (gratuitous emoji, eyebrow
  labels on everything, three identical cards, fake-perfect metrics).

## 6. Fidelity to the brief
- 1 — Built something else, or the core ask is missing.
- 2 — Core ask present but important requirements missing or wrong (data, language, audience).
- 3 — All main requirements visible; some details missed or misread.
- 4 — Everything asked for is there, in the person's language, using their data.
- 5 — Everything asked for, plus judgement calls the person would thank you for — without
  adding things they did not ask for.

## Rules
- Language matters: a Spanish brief needs a Spanish page (Rioplatense *vos* is a plus).
- Use the provided data: invented numbers where real ones were given is a fidelity failure.
- Do not reward length or decoration. Fewer, better elements beat more elements.
- A blank or broken page scores 1 on every dimension.
- Judge the page, not the agent's effort. You cannot see the code; do not guess at it.
