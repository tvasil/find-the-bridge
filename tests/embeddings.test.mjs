import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MIN_FINISH_SIMILARITY,
  canAcceptWord,
  classifyDirection,
  cosineInt8,
} from "../dist/scoring.mjs";

const metadata = JSON.parse(readFileSync(new URL("../dist/data/vocabulary.json", import.meta.url), "utf8"));
const puzzleData = JSON.parse(readFileSync(new URL("../dist/data/puzzles.json", import.meta.url), "utf8"));
const vectorsBuffer = readFileSync(new URL("../dist/data/vectors.bin", import.meta.url));
const projectionBuffer = readFileSync(new URL("../dist/data/projection.bin", import.meta.url));
const vectors = new Int8Array(vectorsBuffer.buffer, vectorsBuffer.byteOffset, vectorsBuffer.byteLength);
const indexByWord = new Map(metadata.words.map((word, index) => [word, index]));
const similarity = (left, right) => cosineInt8(vectors, metadata.dimensions, indexByWord.get(left), indexByWord.get(right));

assert.ok(metadata.size >= 10000);
assert.equal(vectors.length, metadata.size * metadata.dimensions);
assert.equal(projectionBuffer.byteLength, metadata.size * 2 * Float32Array.BYTES_PER_ELEMENT);

const knownRoutes = [
  ["volcano", "capital", "banking", "banks", "bank"],
  ["bee", "culture", "independence", "freedom", "democracy"],
  ["telescope", "medium", "eat", "meat", "soup"],
  ["violin", "range", "mountains", "mountain", "desert"],
];

for (const route of knownRoutes) {
  const destination = route.at(-1);
  route.forEach((word) => assert.ok(indexByWord.has(word), `${word} should be in the vocabulary`));
  for (let index = 0; index < route.length - 2; index += 1) {
    const verdict = canAcceptWord({
      nextSimilarity: similarity(route[index], route[index + 1]),
      previousToEndSimilarity: similarity(route[index], destination),
      nextToEndSimilarity: similarity(route[index + 1], destination),
    });
    assert.equal(verdict.accepted, true, `${route[index]} → ${route[index + 1]} should be playable`);
  }
  assert.ok(similarity(route.at(-2), destination) >= MIN_FINISH_SIMILARITY, `${route.at(-2)} should reach ${destination}`);
}

assert.equal(canAcceptWord({ nextSimilarity: similarity("country", "parliament") }).accepted, true);
assert.equal(
  classifyDirection(similarity("parliament", "democracy"), similarity("country", "democracy")),
  "detour",
  "country → parliament should be an accepted detour",
);

assert.ok(puzzleData.puzzles.length >= 20, "the shuffled deck should contain at least 20 puzzles");
assert.equal(new Set(puzzleData.puzzles.map(({ id }) => id)).size, puzzleData.puzzles.length, "puzzle IDs should be unique");
for (const { start, end } of puzzleData.puzzles) {
  assert.ok(indexByWord.has(start), `${start} puzzle endpoint should be in the vocabulary`);
  assert.ok(indexByWord.has(end), `${end} puzzle endpoint should be in the vocabulary`);
  assert.ok(similarity(start, end) < 0.5, `${start} → ${end} should begin as a meaningfully distant puzzle`);
}

console.log("Embedding and puzzle-route checks passed");
