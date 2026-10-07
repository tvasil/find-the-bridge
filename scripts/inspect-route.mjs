import { readFileSync } from "node:fs";
import {
  MIN_FINISH_SIMILARITY,
  MIN_JUMP_SIMILARITY,
  classifyDirection,
  cosineInt8,
  scoreRoute,
} from "../dist/scoring.mjs";

const metadata = JSON.parse(readFileSync(new URL("../dist/data/vocabulary.json", import.meta.url), "utf8"));
const vectorBuffer = readFileSync(new URL("../dist/data/vectors.bin", import.meta.url));
const vectors = new Int8Array(vectorBuffer.buffer, vectorBuffer.byteOffset, vectorBuffer.byteLength);
const indexByWord = new Map(metadata.words.map((word, index) => [word, index]));
const words = process.argv.slice(2).map((word) => word.toLowerCase());

if (words.length < 2) {
  console.error("Usage: node scripts/inspect-route.mjs start bridge... destination");
  process.exit(1);
}

const unknown = words.filter((word) => !indexByWord.has(word));
if (unknown.length) {
  console.error(`Unknown: ${unknown.join(", ")}`);
  process.exit(1);
}

const similarity = (left, right) => cosineInt8(
  vectors,
  metadata.dimensions,
  indexByWord.get(left),
  indexByWord.get(right),
);
const destination = words.at(-1);
const steps = words.slice(0, -1).map((word, index) => similarity(word, words[index + 1]));
const directions = words.slice(1, -1).map((word, index) => classifyDirection(
  similarity(word, destination),
  similarity(words[index], destination),
));
const directionValue = { closer: 1, sideways: 0.55, detour: 0.15 };
const progression = directions.length
  ? directions.reduce((sum, direction) => sum + directionValue[direction], 0) / directions.length
  : 1;
const score = scoreRoute(steps, words.length - 2, progression);

console.log(words.join(" → "));
steps.forEach((value, index) => {
  const accepted = value >= MIN_JUMP_SIMILARITY ? "✓" : "✗";
  console.log(`${accepted} ${words[index]} → ${words[index + 1]}: ${value.toFixed(3)}`);
});
console.log(`Finish: ${steps.at(-1) >= MIN_FINISH_SIMILARITY ? "✓" : "✗"} · Score: ${score}/100`);
