import {
  MAX_BRIDGES,
  MIN_BRIDGES,
  MIN_FINISH_SIMILARITY,
  canAcceptWord,
  cosineInt8,
  scoreRoute,
  stepLabel,
} from "./scoring.mjs";

const puzzles = [
  { id: "volcano-bank", start: "volcano", end: "bank" },
  { id: "bee-democracy", start: "bee", end: "democracy" },
  { id: "telescope-soup", start: "telescope", end: "soup" },
  { id: "violin-desert", start: "violin", end: "desert" },
];

const elements = {
  game: document.querySelector("#game"),
  puzzleNumber: document.querySelector("#puzzle-number"),
  startWord: document.querySelector("#start-word"),
  endWord: document.querySelector("#end-word"),
  instruction: document.querySelector("#instruction"),
  routeTrack: document.querySelector("#route-track"),
  form: document.querySelector("#guess-form"),
  input: document.querySelector("#guess-input"),
  placeWord: document.querySelector("#place-word"),
  wordList: document.querySelector("#word-list"),
  feedback: document.querySelector("#feedback"),
  movesLeft: document.querySelector("#moves-left"),
  undo: document.querySelector("#undo-word"),
  finish: document.querySelector("#finish-route"),
  nextPuzzle: document.querySelector("#next-puzzle"),
  sessionCount: document.querySelector("#session-count"),
  sessionEmpty: document.querySelector("#session-empty"),
  sessionHistory: document.querySelector("#session-history"),
  results: document.querySelector("#results"),
  scoreValue: document.querySelector("#score-value"),
  scoreNote: document.querySelector("#score-note"),
  stepList: document.querySelector("#step-list"),
  canvas: document.querySelector("#semantic-map"),
  mapStatus: document.querySelector("#map-status"),
  playAgain: document.querySelector("#play-again"),
};

let embeddingData;
let vectors;
let projection;
let indexByWord;
let mapAnimation;
let mapHitTargets = [];
let state = { puzzleIndex: 0, bridges: [], finished: false };

function currentPuzzle() { return puzzles[state.puzzleIndex]; }
function indexOf(word) { return indexByWord.get(word); }
function similarity(left, right) {
  return cosineInt8(vectors, embeddingData.dimensions, indexOf(left), indexOf(right));
}
function cleanWord(value) { return value.trim().toLowerCase().replace(/[^a-z]/g, ""); }
function currentWord() { return state.bridges.at(-1) ?? currentPuzzle().start; }
function finishSimilarity() { return similarity(currentWord(), currentPuzzle().end); }
function canFinish() {
  return state.bridges.length >= MIN_BRIDGES && finishSimilarity() >= MIN_FINISH_SIMILARITY;
}

function setFeedback(message, tone = "") {
  elements.feedback.textContent = message;
  elements.feedback.className = `feedback ${tone}`.trim();
}

function renderRoute() {
  const puzzle = currentPuzzle();
  const nodes = [
    { label: "Start", word: puzzle.start, className: "endpoint" },
    ...Array.from({ length: MAX_BRIDGES }, (_, index) => ({
      label: `Bridge ${index + 1}`,
      word: state.bridges[index] ?? "—",
      className: state.bridges[index] ? "filled" : index === state.bridges.length && !state.finished ? "current" : "",
    })),
    { label: "Goal", word: puzzle.end, className: "endpoint" },
  ];
  elements.routeTrack.replaceChildren(...nodes.map(({ label, word, className }) => {
    const node = document.createElement("div");
    node.className = `route-node ${className}`.trim();
    node.title = word === "—" ? `${label} is empty` : word;
    const small = document.createElement("small");
    small.textContent = label;
    const strong = document.createElement("strong");
    strong.textContent = word;
    node.append(small, strong);
    return node;
  }));
}

function renderPuzzle() {
  const puzzle = currentPuzzle();
  elements.puzzleNumber.textContent = `Puzzle ${String(state.puzzleIndex + 1).padStart(2, "0")} / ${String(puzzles.length).padStart(2, "0")}`;
  elements.startWord.textContent = puzzle.start;
  elements.endWord.textContent = puzzle.end;
  elements.input.placeholder = `A word near “${currentWord()}”`;
  elements.input.value = "";
  elements.input.disabled = state.finished || state.bridges.length >= MAX_BRIDGES;
  elements.placeWord.disabled = elements.input.disabled;
  elements.undo.disabled = state.finished || state.bridges.length === 0;
  elements.finish.disabled = state.finished || !canFinish();
  elements.finish.textContent = canFinish() ? `Connect to ${puzzle.end}` : "Get closer to finish";
  elements.movesLeft.textContent = `${MAX_BRIDGES - state.bridges.length} bridge${MAX_BRIDGES - state.bridges.length === 1 ? "" : "s"} left`;

  if (state.finished) {
    elements.instruction.textContent = `Route complete in ${state.bridges.length} bridge words.`;
  } else if (state.bridges.length >= MAX_BRIDGES) {
    elements.instruction.textContent = `No bridges left. Undo a word and try a different direction.`;
  } else if (state.bridges.length < MIN_BRIDGES) {
    const remaining = MIN_BRIDGES - state.bridges.length;
    elements.instruction.textContent = `Move from ${currentWord()} toward ${puzzle.end}. Place ${remaining} more before the final crossing.`;
  } else if (canFinish()) {
    elements.instruction.textContent = `You’re close enough to ${puzzle.end}. Cross now, or add another bridge.`;
  } else {
    elements.instruction.textContent = `Keep moving closer to ${puzzle.end}. Your next word must still connect to ${currentWord()}.`;
  }
  renderRoute();
}

function suggestionsFor(word) {
  const startsWith = embeddingData.words.filter((candidate) => candidate.startsWith(word) && candidate !== word).slice(0, 3);
  return startsWith.length ? ` Try ${startsWith.join(", ")}.` : "";
}

function attemptWord(rawWord) {
  if (state.finished) return { accepted: false, reason: "This route is already complete." };
  if (state.bridges.length >= MAX_BRIDGES) return { accepted: false, reason: "You have used all six bridges." };
  const word = cleanWord(rawWord);
  const puzzle = currentPuzzle();
  if (!word || !indexByWord.has(word)) {
    const reason = word ? `“${word}” isn’t in this round’s vocabulary.${suggestionsFor(word)}` : "Type a single word first.";
    setFeedback(reason, "bad");
    return { accepted: false, reason };
  }
  if (word === puzzle.end) {
    const reason = "Save the destination for the final crossing.";
    setFeedback(reason, "bad");
    return { accepted: false, reason };
  }
  if (word === puzzle.start || state.bridges.includes(word)) {
    const reason = "Each bridge word can appear only once.";
    setFeedback(reason, "bad");
    return { accepted: false, reason };
  }

  const previous = currentWord();
  const jump = similarity(previous, word);
  const previousToEnd = similarity(previous, puzzle.end);
  const wordToEnd = similarity(word, puzzle.end);
  const verdict = canAcceptWord({ nextSimilarity: jump, nextToEndSimilarity: wordToEnd, previousToEndSimilarity: previousToEnd });
  if (!verdict.accepted) {
    const detail = verdict.reason.includes("away")
      ? `${verdict.reason} “${word}” is ${(wordToEnd * 100).toFixed(0)}% aligned with ${puzzle.end}; beat ${(previousToEnd * 100).toFixed(0)}%.`
      : `${verdict.reason} The ${previous} → ${word} similarity is ${jump.toFixed(2)}.`;
    setFeedback(detail, "bad");
    return { accepted: false, reason: detail, similarity: jump };
  }

  state.bridges.push(word);
  setFeedback(`${stepLabel(jump)} move · ${previous} → ${word} scored ${jump.toFixed(2)}.`, "good");
  renderPuzzle();
  elements.input.focus();
  return {
    accepted: true,
    word,
    route: [puzzle.start, ...state.bridges],
    jumpSimilarity: Number(jump.toFixed(3)),
    destinationSimilarity: Number(wordToEnd.toFixed(3)),
    canFinish: canFinish(),
  };
}

function getSessionHistory() {
  try { return JSON.parse(sessionStorage.getItem("find-the-bridge-history") ?? "[]"); }
  catch { return []; }
}

function saveSessionEntry(entry) {
  const history = [entry, ...getSessionHistory()].slice(0, 8);
  sessionStorage.setItem("find-the-bridge-history", JSON.stringify(history));
  renderHistory();
}

function renderHistory() {
  const history = getSessionHistory();
  elements.sessionCount.textContent = String(history.length);
  elements.sessionEmpty.hidden = history.length > 0;
  elements.sessionHistory.replaceChildren(...history.map((entry) => {
    const item = document.createElement("li");
    item.className = "history-item";
    const route = document.createElement("strong");
    route.textContent = `${entry.start} → ${entry.end}`;
    const score = document.createElement("b");
    score.textContent = entry.score;
    const detail = document.createElement("span");
    detail.textContent = `${entry.bridges} bridge${entry.bridges === 1 ? "" : "s"}`;
    item.append(route, score, detail);
    return item;
  }));
}

function completeRoute() {
  if (!canFinish() || state.finished) return { completed: false, reason: "The route is not close enough to finish yet." };
  const puzzle = currentPuzzle();
  const route = [puzzle.start, ...state.bridges, puzzle.end];
  const steps = route.slice(0, -1).map((word, index) => similarity(word, route[index + 1]));
  const score = scoreRoute(steps, state.bridges.length, 1);
  state.finished = true;
  renderPuzzle();
  renderResults(route, steps, score);
  saveSessionEntry({ start: puzzle.start, end: puzzle.end, score, bridges: state.bridges.length, route });
  return { completed: true, score, route, stepSimilarities: steps.map((value) => Number(value.toFixed(3))) };
}

function renderResults(route, steps, score) {
  elements.results.hidden = false;
  elements.scoreValue.textContent = score;
  const weakest = Math.min(...steps);
  const weakestIndex = steps.indexOf(weakest);
  const label = score >= 78 ? "Elegant and steady." : score >= 58 ? "A convincing route." : "A daring route with a wide jump.";
  elements.scoreNote.textContent = `${label} Your weakest link was ${route[weakestIndex]} → ${route[weakestIndex + 1]} at ${weakest.toFixed(2)} similarity.`;
  elements.stepList.replaceChildren(...steps.map((value, index) => {
    const row = document.createElement("li");
    row.className = `step-row${index === weakestIndex ? " weakest" : ""}`;
    const pair = document.createElement("div");
    pair.className = "step-pair";
    pair.append(document.createTextNode(route[index]), Object.assign(document.createElement("span"), { textContent: " → " }), document.createTextNode(route[index + 1]));
    const number = document.createElement("span");
    number.className = "step-score";
    number.textContent = value.toFixed(2);
    const badge = document.createElement("span");
    badge.className = "step-label";
    badge.textContent = stepLabel(value);
    row.append(pair, number, badge);
    return row;
  }));
  drawSemanticMap(route);
  elements.results.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

function resetPuzzle(index = state.puzzleIndex) {
  state = { puzzleIndex: (index + puzzles.length) % puzzles.length, bridges: [], finished: false };
  elements.results.hidden = true;
  setFeedback("Enter a word and press Enter. Wide leaps are allowed, but only if they move toward the goal.");
  renderPuzzle();
  elements.input.focus();
}

function drawSemanticMap(route) {
  cancelAnimationFrame(mapAnimation);
  const canvas = elements.canvas;
  const context = canvas.getContext("2d");
  const ratio = Math.min(devicePixelRatio || 1, 2);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.scale(ratio, ratio);
  const margin = 28;
  const pointFor = (word) => {
    const index = indexOf(word);
    return {
      word,
      x: margin + projection[index * 2] * (width - margin * 2),
      y: margin + (1 - projection[index * 2 + 1]) * (height - margin * 2),
    };
  };
  const routePoints = route.map(pointFor);
  const started = performance.now();
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function frame(now) {
    const progress = reduced ? 1 : Math.min(1, (now - started) / 1150);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#12181d";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "rgba(255,255,255,.13)";
    for (let index = 0; index < embeddingData.size; index += 1) {
      const x = margin + projection[index * 2] * (width - margin * 2);
      const y = margin + (1 - projection[index * 2 + 1]) * (height - margin * 2);
      context.fillRect(x, y, 1.2, 1.2);
    }

    const segmentProgress = progress * (routePoints.length - 1);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 4;
    context.strokeStyle = "#efff68";
    context.beginPath();
    context.moveTo(routePoints[0].x, routePoints[0].y);
    for (let index = 1; index < routePoints.length; index += 1) {
      const amount = Math.max(0, Math.min(1, segmentProgress - (index - 1)));
      if (!amount) break;
      const previous = routePoints[index - 1];
      const next = routePoints[index];
      context.lineTo(previous.x + (next.x - previous.x) * amount, previous.y + (next.y - previous.y) * amount);
    }
    context.stroke();

    mapHitTargets = [];
    routePoints.forEach((point, index) => {
      if (index > segmentProgress + 0.12) return;
      const color = index === 0 ? "#ff7358" : index === routePoints.length - 1 ? "#4de0c1" : "#ffffff";
      context.beginPath();
      context.arc(point.x, point.y, index === 0 || index === routePoints.length - 1 ? 7 : 5.5, 0, Math.PI * 2);
      context.fillStyle = color;
      context.fill();
      context.strokeStyle = "#12181d";
      context.lineWidth = 2;
      context.stroke();
      context.font = "700 12px Inter, sans-serif";
      const textWidth = context.measureText(point.word).width;
      const labelX = Math.max(4, Math.min(width - textWidth - 12, point.x + 8));
      const labelY = Math.max(17, Math.min(height - 5, point.y - 8));
      context.fillStyle = "rgba(18,24,29,.88)";
      context.fillRect(labelX - 4, labelY - 13, textWidth + 8, 18);
      context.fillStyle = color;
      context.fillText(point.word, labelX, labelY);
      mapHitTargets.push({ ...point, radius: 16 });
    });
    if (progress < 1) mapAnimation = requestAnimationFrame(frame);
  }
  mapAnimation = requestAnimationFrame(frame);
}

function registerWebMcp() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();
  const register = (tool) => Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {});
  register({
    name: "start_bridge_puzzle",
    title: "Start bridge puzzle",
    description: "Start one of the visible Find the Bridge puzzles and reset its route.",
    inputSchema: { type: "object", properties: { puzzleId: { type: "string", enum: puzzles.map(({ id }) => id) } }, required: ["puzzleId"], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      const index = puzzles.findIndex(({ id }) => id === input?.puzzleId);
      if (index < 0) throw new Error("Unknown puzzleId");
      resetPuzzle(index);
      return { puzzle: puzzles[index], route: [puzzles[index].start] };
    },
  });
  register({
    name: "submit_bridge_word",
    title: "Submit bridge word",
    description: "Try one word in the current puzzle. The visible route updates only if the semantic move is accepted.",
    inputSchema: { type: "object", properties: { word: { type: "string", minLength: 1 } }, required: ["word"], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute(input) {
      if (typeof input?.word !== "string") throw new Error("word must be a string");
      return attemptWord(input.word);
    },
  });
  register({
    name: "complete_bridge_route",
    title: "Complete bridge route",
    description: "Make the final crossing when the current route has at least three bridge words and is close enough to the destination.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute() { return completeRoute(); },
  });
  addEventListener("beforeunload", () => lifecycle.abort(), { once: true });
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const word = elements.input.value;
  const result = attemptWord(word);
  if (result.accepted) elements.input.value = "";
  else elements.input.select();
});
elements.undo.addEventListener("click", () => {
  const removed = state.bridges.pop();
  setFeedback(`Removed “${removed}”. Try another direction.`);
  renderPuzzle();
  elements.input.focus();
});
elements.finish.addEventListener("click", completeRoute);
elements.nextPuzzle.addEventListener("click", () => resetPuzzle(state.puzzleIndex + 1));
elements.playAgain.addEventListener("click", () => resetPuzzle(state.puzzleIndex + 1));
elements.canvas.addEventListener("pointermove", (event) => {
  const bounds = elements.canvas.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  const match = mapHitTargets.find((target) => Math.hypot(target.x - x, target.y - y) <= target.radius);
  elements.canvas.style.cursor = match ? "crosshair" : "default";
  elements.mapStatus.textContent = match ? match.word : "Hover a route word";
});
new ResizeObserver(() => {
  if (!elements.results.hidden) {
    const puzzle = currentPuzzle();
    drawSemanticMap([puzzle.start, ...state.bridges, puzzle.end]);
  }
}).observe(elements.canvas);

async function initialize() {
  try {
    const [metadataResponse, vectorResponse, projectionResponse] = await Promise.all([
      fetch("./data/vocabulary.json"),
      fetch("./data/vectors.bin"),
      fetch("./data/projection.bin"),
    ]);
    if (!metadataResponse.ok || !vectorResponse.ok || !projectionResponse.ok) throw new Error("Embedding data did not load");
    embeddingData = await metadataResponse.json();
    vectors = new Int8Array(await vectorResponse.arrayBuffer());
    projection = new Float32Array(await projectionResponse.arrayBuffer());
    indexByWord = new Map(embeddingData.words.map((word, index) => [word, index]));
    const fragment = document.createDocumentFragment();
    embeddingData.words.forEach((word) => fragment.append(Object.assign(document.createElement("option"), { value: word })));
    elements.wordList.append(fragment);
    elements.game.setAttribute("aria-busy", "false");
    elements.input.disabled = false;
    elements.placeWord.disabled = false;
    setFeedback("Enter a word and press Enter. Wide leaps are allowed, but only if they move toward the goal.");
    renderHistory();
    renderPuzzle();
    registerWebMcp();
  } catch (error) {
    console.error(error);
    elements.game.setAttribute("aria-busy", "false");
    setFeedback("The word map could not load. Refresh the page to try again.", "bad");
  }
}

initialize();
