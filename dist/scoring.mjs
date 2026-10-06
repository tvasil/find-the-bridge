export const MIN_JUMP_SIMILARITY = 0.2;
export const MIN_FINISH_SIMILARITY = 0.34;
export const MIN_BRIDGES = 3;
export const MAX_BRIDGES = 6;

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

export function canAcceptWord({ nextSimilarity, nextToEndSimilarity, previousToEndSimilarity }) {
  if (nextSimilarity < MIN_JUMP_SIMILARITY) return { accepted: false, reason: "That jump is too far apart." };
  if (nextToEndSimilarity <= previousToEndSimilarity + 0.004) return { accepted: false, reason: "That word moves away from the destination." };
  return { accepted: true };
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
  const progression = 0.94 + 0.06 * Math.max(0, Math.min(1, progressionFraction));
  const efficiency = Math.max(0.86, 1 - 0.035 * Math.max(0, bridgeCount - MIN_BRIDGES));
  return Math.round(100 * continuity * progression * efficiency);
}
