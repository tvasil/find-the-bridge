import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { resolve } from "node:path";

const input = resolve(process.argv[2] ?? "/private/tmp/find-the-bridge-glove-50.gz");
const outputDir = resolve(process.argv[3] ?? "dist/data");
const targetSize = 10000;
const required = new Set([
  "volcano", "mountain", "land", "property", "mortgage", "bank", "money", "loan",
  "bee", "hive", "colony", "community", "society", "citizen", "vote", "democracy",
  "telescope", "lens", "glass", "bowl", "broth", "soup", "spoon", "kitchen",
  "violin", "bow", "string", "wood", "tree", "forest", "sand", "dune", "desert",
  "glacier", "coffee", "pirate", "library", "thunder", "chocolate", "robot", "moon",
  "hospital", "candle", "ocean", "camera", "bread", "feather", "justice", "bicycle",
  "orchestra", "garden", "computer", "whale", "classroom", "diamond", "rain", "train",
  "dream", "football", "medicine", "spider", "government", "pillow", "space", "river",
  "telephone", "castle", "music", "rocket", "courtroom", "mushroom", "city",
]);
const stopWords = new Set(`a an and are as at be been being but by can could did do does for from had has have he her hers him his how i if in into is it its itself may me might mine my no nor not of on or our ours ourselves she should so than that the their theirs them themselves then there these they this those through to too under until up us very was we were what when where which while who whom why will with would you your yours yourself yourselves`.split(" "));

const selected = [];
const selectedWords = new Set();
const pendingRequired = new Map();
const reader = createInterface({ input: createReadStream(input).pipe(createGunzip()), crlfDelay: Infinity });

let firstLine = true;
for await (const line of reader) {
  if (firstLine) { firstLine = false; continue; }
  const parts = line.trim().split(" ");
  const word = parts.shift()?.toLowerCase();
  if (!word || parts.length !== 50 || !/^[a-z]+$/.test(word) || stopWords.has(word)) continue;
  const vector = parts.map(Number);
  if (vector.some((value) => !Number.isFinite(value))) continue;
  if (required.has(word)) pendingRequired.set(word, vector);
  if (selected.length < targetSize && !selectedWords.has(word)) {
    selected.push({ word, vector });
    selectedWords.add(word);
  }
  if (selected.length >= targetSize && [...required].every((wordValue) => pendingRequired.has(wordValue))) break;
}

for (const word of required) {
  if (selectedWords.has(word)) continue;
  const vector = pendingRequired.get(word);
  if (!vector) throw new Error(`Required word missing from model: ${word}`);
  selected.push({ word, vector });
  selectedWords.add(word);
}

const normalized = selected.map(({ vector }) => {
  const magnitude = Math.hypot(...vector) || 1;
  return vector.map((value) => value / magnitude);
});

function pca2(matrix) {
  const rows = matrix.length;
  const cols = matrix[0].length;
  const mean = Array(cols).fill(0);
  matrix.forEach((row) => row.forEach((value, index) => { mean[index] += value / rows; }));
  const centered = matrix.map((row) => row.map((value, index) => value - mean[index]));
  const covariance = Array.from({ length: cols }, () => Array(cols).fill(0));
  centered.forEach((row) => {
    for (let i = 0; i < cols; i += 1) {
      for (let j = i; j < cols; j += 1) covariance[i][j] += row[i] * row[j] / (rows - 1);
    }
  });
  for (let i = 0; i < cols; i += 1) for (let j = i + 1; j < cols; j += 1) covariance[j][i] = covariance[i][j];
  const multiply = (vector) => covariance.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));
  const unit = (vector) => {
    const magnitude = Math.hypot(...vector) || 1;
    return vector.map((value) => value / magnitude);
  };
  const findComponent = (seed, basis = []) => {
    let vector = unit(Array.from({ length: cols }, (_, index) => Math.sin((index + 1) * seed)));
    for (let iteration = 0; iteration < 160; iteration += 1) {
      let next = multiply(vector);
      for (const previous of basis) {
        const projection = next.reduce((sum, value, index) => sum + value * previous[index], 0);
        next = next.map((value, index) => value - projection * previous[index]);
      }
      vector = unit(next);
    }
    return vector;
  };
  const first = findComponent(1.37);
  const second = findComponent(2.71, [first]);
  const points = centered.map((row) => [first, second].map((axis) => row.reduce((sum, value, index) => sum + value * axis[index], 0)));
  const bounds = [0, 1].map((axis) => {
    const values = points.map((point) => point[axis]);
    return [Math.min(...values), Math.max(...values)];
  });
  return points.map(([x, y]) => [
    (x - bounds[0][0]) / (bounds[0][1] - bounds[0][0]),
    (y - bounds[1][0]) / (bounds[1][1] - bounds[1][0]),
  ]);
}

const quantized = new Int8Array(selected.length * 50);
normalized.forEach((vector, row) => vector.forEach((value, column) => {
  quantized[row * 50 + column] = Math.max(-127, Math.min(127, Math.round(value * 127)));
}));
const projection = new Float32Array(selected.length * 2);
pca2(normalized).forEach((point, row) => {
  projection[row * 2] = point[0];
  projection[row * 2 + 1] = point[1];
});

mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, "vectors.bin"), Buffer.from(quantized.buffer));
writeFileSync(resolve(outputDir, "projection.bin"), Buffer.from(projection.buffer));
writeFileSync(resolve(outputDir, "vocabulary.json"), `${JSON.stringify({
  model: "glove-wiki-gigaword-50",
  dimensions: 50,
  quantization: "int8-l2-normalized",
  projection: "global-pca-2d",
  size: selected.length,
  words: selected.map(({ word }) => word),
})}\n`);
console.log(`Built ${selected.length} browser vectors from ${input}`);
