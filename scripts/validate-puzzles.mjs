import { readFileSync } from "node:fs";
import { cosineInt8, MIN_FINISH_SIMILARITY, MIN_JUMP_SIMILARITY } from "../dist/scoring.mjs";

const metadata = JSON.parse(readFileSync(new URL("../dist/data/vocabulary.json", import.meta.url), "utf8"));
const puzzleData = JSON.parse(readFileSync(new URL("../dist/data/puzzles.json", import.meta.url), "utf8"));
const vectorBuffer = readFileSync(new URL("../dist/data/vectors.bin", import.meta.url));
const vectors = new Int8Array(vectorBuffer.buffer, vectorBuffer.byteOffset, vectorBuffer.byteLength);
const indexByWord = new Map(metadata.words.map((word, index) => [word, index]));
const similarity = (left, right) => cosineInt8(vectors, metadata.dimensions, left, right);

function insertCandidate(list, candidate, limit) {
  const position = list.findIndex(({ score }) => candidate.score > score);
  if (position < 0) {
    if (list.length < limit) list.push(candidate);
  } else {
    list.splice(position, 0, candidate);
    if (list.length > limit) list.pop();
  }
}

function findRoute(startWord, endWord) {
  const start = indexByWord.get(startWord);
  const end = indexByWord.get(endWord);
  const toGoal = new Float32Array(metadata.size);
  for (let index = 0; index < metadata.size; index += 1) toGoal[index] = similarity(index, end);
  let beam = [{ path: [start], score: toGoal[start] }];

  for (let depth = 1; depth <= 6; depth += 1) {
    const nextBeam = [];
    const seenEnds = new Set();
    for (const candidatePath of beam) {
      const current = candidatePath.path.at(-1);
      const localBest = [];
      for (let candidate = 0; candidate < metadata.size; candidate += 1) {
        if (candidate === end || candidatePath.path.includes(candidate)) continue;
        const jump = similarity(current, candidate);
        if (jump < MIN_JUMP_SIMILARITY) continue;
        const score = toGoal[candidate] * 1.7 + jump * 0.7;
        insertCandidate(localBest, { candidate, score }, 14);
      }
      for (const { candidate, score } of localBest) {
        if (seenEnds.has(candidate)) continue;
        seenEnds.add(candidate);
        insertCandidate(nextBeam, { path: [...candidatePath.path, candidate], score }, 18);
      }
    }
    beam = nextBeam;
    if (depth >= 3) {
      const finish = beam.find(({ path }) => toGoal[path.at(-1)] >= MIN_FINISH_SIMILARITY);
      if (finish) return [...finish.path.map((index) => metadata.words[index]), endWord];
    }
  }
  return null;
}

function validateStrongRoute({ start, end, strongRoute }) {
  if (!Array.isArray(strongRoute)) return ["missing strongRoute"];
  const issues = [];
  if (strongRoute[0] !== start || strongRoute.at(-1) !== end) issues.push("endpoints do not match");
  if (strongRoute.length - 2 < 3 || strongRoute.length - 2 > 6) issues.push("must use 3–6 bridge words");
  if (new Set(strongRoute).size !== strongRoute.length) issues.push("contains a repeated word");
  const unknown = strongRoute.filter((word) => !indexByWord.has(word));
  if (unknown.length) issues.push(`unknown words: ${unknown.join(", ")}`);
  if (unknown.length) return issues;
  const steps = strongRoute.slice(0, -1).map((word, index) => similarity(indexByWord.get(word), indexByWord.get(strongRoute[index + 1])));
  steps.forEach((value, index) => {
    if (value < MIN_JUMP_SIMILARITY) issues.push(`${strongRoute[index]} → ${strongRoute[index + 1]} is ${value.toFixed(3)}`);
  });
  if (steps.at(-1) < MIN_FINISH_SIMILARITY) issues.push(`final crossing is ${steps.at(-1).toFixed(3)}`);
  return issues;
}

let failures = 0;
for (const puzzle of puzzleData.puzzles) {
  const { start, end, strongRoute } = puzzle;
  const issues = validateStrongRoute(puzzle);
  const route = issues.length ? findRoute(start, end) : strongRoute;
  if (issues.length || !route) {
    failures += 1;
    console.error(`${start} → ${end}: ${issues.join("; ") || "no route found"}`);
  } else {
    console.log(route.join(" → "));
  }
}
if (failures) process.exitCode = 1;
else console.log(`Validated ${puzzleData.puzzles.length} shuffled puzzles and strong routes`);
