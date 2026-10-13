export const MIN_JUMP_SIMILARITY = 0.2;
export const TANIA_MAX_JUMP_SIMILARITY = 0.7;
export const MIN_FINISH_SIMILARITY = 0.34;
export const MIN_BRIDGES = 3;
export const MAX_BRIDGES = 6;
export const DIRECTION_EPSILON = 0.03;

export function cosineInt8(vectors, dimensions, leftIndex, rightIndex) {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  const leftOffset = leftIndex * dimensions;
  const rightOffset = rightIndex * dimensions;
  for (let index = 0; index < dimensions; index += 1) {
    const left = vectors[leftOffset + index];
    const right = vectors[rightOffset + index];
    dot += left * right;
    leftMagnitude += left * left;
    rightMagnitude += right * right;
  }
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude) || 1);
}

export function qualityFromSimilarity(similarity) {
  return Math.max(0, Math.min(1, (similarity - 0.12) / 0.58));
}

export function stepLabel(similarity) {
  if (similarity >= 0.6) return "Close";
  if (similarity >= 0.42) return "Solid";
  if (similarity >= MIN_JUMP_SIMILARITY) return "Leap";
  return "Too far";
}

export function classifyDirection(nextToEndSimilarity, previousToEndSimilarity) {
  const change = nextToEndSimilarity - previousToEndSimilarity;
  if (change >= DIRECTION_EPSILON) return "closer";
  if (change <= -DIRECTION_EPSILON) return "detour";
  return "sideways";
}

export function canAcceptWord({ nextSimilarity, mode = "classic" }) {
  if (nextSimilarity < MIN_JUMP_SIMILARITY) return { accepted: false, reason: "That jump is too far apart." };
  if (mode === "tania" && nextSimilarity > TANIA_MAX_JUMP_SIMILARITY) {
    return { accepted: false, reason: "That connection is too obvious for Tania mode." };
  }
  return { accepted: true };
}

export function taniaStepLabel(similarity) {
  if (similarity > TANIA_MAX_JUMP_SIMILARITY) return "Too obvious";
  if (similarity >= 0.5) return "Familiar";
  if (similarity >= 0.32) return "Clever";
  if (similarity >= MIN_JUMP_SIMILARITY) return "Wild";
  return "Too far";
}

export function semanticArcRatio(stepSimilarities, directSimilarity) {
  if (!stepSimilarities.length) return 0;
  const routeDistance = stepSimilarities.reduce((sum, similarity) => sum + (1 - similarity), 0);
  const directDistance = Math.max(0.05, 1 - directSimilarity);
  return routeDistance / directDistance;
}

export function scoreTaniaRoute(stepSimilarities, directSimilarity) {
  if (!stepSimilarities.length) return 0;
  const arcRatio = semanticArcRatio(stepSimilarities, directSimilarity);
  const arcQuality = Math.max(0, Math.min(1, (arcRatio - 1) / 3.25));
  const bridgeSteps = stepSimilarities.slice(0, -1);
  const scoredSteps = bridgeSteps.length ? bridgeSteps : stepSimilarities;
  const defensibility = scoredSteps.reduce((sum, similarity) => {
    const connection = Math.max(0, Math.min(1, (similarity - MIN_JUMP_SIMILARITY) / 0.12));
    const wildness = Math.max(0, Math.min(1, (TANIA_MAX_JUMP_SIMILARITY - similarity) / 0.3));
    return sum + 0.45 * connection + 0.55 * wildness;
  }, 0) / scoredSteps.length;
  return Math.round(100 * (0.68 * arcQuality + 0.32 * defensibility));
}

export function scoreRoute(stepSimilarities, bridgeCount, progressionFraction = 1) {
  if (!stepSimilarities.length) return 0;
  const qualities = stepSimilarities.map(qualityFromSimilarity);
  const safe = qualities.map((quality) => Math.max(quality, 0.001));
  const geometricMean = Math.exp(safe.reduce((sum, value) => sum + Math.log(value), 0) / safe.length);
  const weakest = Math.min(...qualities);
  const mean = qualities.reduce((sum, value) => sum + value, 0) / qualities.length;
  const variance = qualities.reduce((sum, value) => sum + (value - mean) ** 2, 0) / qualities.length;
  const consistency = mean * Math.max(0, 1 - Math.sqrt(variance) / 0.42);
  const continuity = 0.5 * geometricMean + 0.35 * weakest + 0.15 * consistency;
  const progression = 0.86 + 0.14 * Math.max(0, Math.min(1, progressionFraction));
  const efficiency = Math.max(0.86, 1 - 0.035 * Math.max(0, bridgeCount - MIN_BRIDGES));
  return Math.round(100 * continuity * progression * efficiency);
}
