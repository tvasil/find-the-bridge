import assert from "node:assert/strict";
import {
  canAcceptWord,
  classifyDirection,
  scoreRoute,
  scoreTaniaRoute,
  semanticArcRatio,
  stepLabel,
  taniaStepLabel,
} from "../dist/scoring.mjs";

assert.equal(stepLabel(0.7), "Close");
assert.equal(stepLabel(0.5), "Solid");
assert.equal(stepLabel(0.28), "Leap");
assert.equal(stepLabel(0.1), "Too far");
assert.ok(scoreRoute([0.64, 0.58, 0.61, 0.55], 3) > 55);
assert.ok(scoreRoute([0.82, 0.08, 0.77, 0.7], 3) < 25, "a terrible step must dominate the route");
assert.ok(scoreRoute([0.55, 0.54, 0.52, 0.51], 3) > scoreRoute([0.55, 0.54, 0.52, 0.51, 0.5, 0.49], 5));
assert.equal(canAcceptWord({ nextSimilarity: 0.45, nextToEndSimilarity: 0.4, previousToEndSimilarity: 0.2 }).accepted, true);
assert.equal(canAcceptWord({ nextSimilarity: 0.1, nextToEndSimilarity: 0.4, previousToEndSimilarity: 0.2 }).accepted, false);
assert.equal(canAcceptWord({ nextSimilarity: 0.45, nextToEndSimilarity: 0.1, previousToEndSimilarity: 0.2 }).accepted, true);
assert.equal(classifyDirection(0.4, 0.2), "closer");
assert.equal(classifyDirection(0.215, 0.2), "sideways");
assert.equal(classifyDirection(0.1, 0.2), "detour");
assert.ok(scoreRoute([0.6, 0.55, 0.5, 0.48], 3, 1) > scoreRoute([0.6, 0.55, 0.5, 0.48], 3, 0));
assert.equal(canAcceptWord({ nextSimilarity: 0.71, mode: "tania" }).accepted, false);
assert.equal(canAcceptWord({ nextSimilarity: 0.7, mode: "tania" }).accepted, true);
assert.equal(canAcceptWord({ nextSimilarity: 0.3, mode: "tania" }).accepted, true);
assert.equal(taniaStepLabel(0.71), "Too obvious");
assert.equal(taniaStepLabel(0.55), "Familiar");
assert.equal(taniaStepLabel(0.38), "Clever");
assert.equal(taniaStepLabel(0.25), "Wild");
assert.ok(semanticArcRatio([0.3, 0.3, 0.3, 0.3], 0.1) > semanticArcRatio([0.6, 0.6, 0.6, 0.6], 0.1));
assert.ok(scoreTaniaRoute([0.3, 0.3, 0.3, 0.3, 0.34], 0.1) > scoreTaniaRoute([0.6, 0.6, 0.6, 0.6, 0.6], 0.1));
console.log("Scoring checks passed");
