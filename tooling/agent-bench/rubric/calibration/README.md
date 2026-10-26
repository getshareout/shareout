# Judge calibration notes

The judge is a model reading screenshots against `../judge.md`. Before trusting a change in
judge scores, check the judge itself:

1. **Anchor set.** Keep a handful of results with agreed human scores (one clearly 1–2, one
   ~3, one ~4–5) as `calibration/<brief>-<n>/` with the screenshots and a `human.json`
   (`{ "hierarchy": 4, … }`). Re-judge them after any rubric or judge-model change:
   `node tooling/agent-bench/src/cli.mjs judge --dir tooling/agent-bench/rubric/calibration/<case>`.
   Mean absolute error above ~0.7 per dimension means the rubric or prompt needs work.
2. **Repeat noise.** Judge the same screenshots 3× and look at the spread; a dimension that
   moves by more than 1 point on identical input is not measuring anything yet.
3. **Prefer pairwise for decisions.** Absolute 1–5 scores drift between judge models and
   prompt versions. To decide whether a skill change helped, run both versions and compare
   blind: `cli.mjs judge --pairwise results/<a> results/<b>` (A/B order is randomised per brief).
4. **Known biases to watch.** Judges over-reward dense, decorated pages and dark themes;
   the rubric's restraint anchors push back, but check a few judgements by eye.

No human-scored anchor set is committed yet (first baseline run); add cases as they are
reviewed.
