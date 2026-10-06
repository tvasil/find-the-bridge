import {
  MAX_BRIDGES,
  MIN_BRIDGES,
  MIN_FINISH_SIMILARITY,
  canAcceptWord,
  classifyDirection,
  cosineInt8,
  scoreRoute,
  stepLabel,
} from "./scoring.mjs?v=4";

const MAX_UNDOS = 3;
const PULL_DISPLAY_MIN = -0.05;
const PULL_DISPLAY_MAX = 0.75;
const WALKTHROUGH_KEY = "find-the-bridge-walkthrough-v1";

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
  goalPull: document.querySelector("#goal-pull"),
  goalPullFill: document.querySelector("#goal-pull-fill"),
  goalPullMarker: document.querySelector("#goal-pull-marker"),
  goalPullThreshold: document.querySelector("#goal-pull-threshold"),
  goalPullLabel: document.querySelector("#goal-pull-label"),
  routeTrack: document.querySelector("#route-track"),
  playCard: document.querySelector(".play-card"),
  crossingReady: document.querySelector("#crossing-ready"),
  crossingCurrent: document.querySelector("#crossing-current"),
  crossingEnd: document.querySelector("#crossing-end"),
  crossingScore: document.querySelector("#crossing-score"),
  form: document.querySelector("#guess-form"),
  guessLabel: document.querySelector("#guess-label"),
  input: document.querySelector("#guess-input"),
  placeWord: document.querySelector("#place-word"),
  wordList: document.querySelector("#word-list"),
  feedback: document.querySelector("#feedback"),
  movesLeft: document.querySelector("#moves-left"),
  undo: document.querySelector("#undo-word"),
  tryImprove: document.querySelector("#try-improve"),
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
  openWalkthrough: document.querySelector("#open-walkthrough"),
  walkthrough: document.querySelector("#walkthrough"),
  walkthroughProgress: document.querySelector("#walkthrough-progress"),
  walkthroughClose: document.querySelector("#walkthrough-close"),
  walkthroughBack: document.querySelector("#walkthrough-back"),
  walkthroughNext: document.querySelector("#walkthrough-next"),
};

let embeddingData;
let vectors;
let projection;
let indexByWord;
let mapAnimation;
let mapHitTargets = [];
let activeMapRoute = [];
let activeMapSteps = [];
let selectedStepIndex = null;
let walkthroughStep = 0;
let state = { puzzleIndex: 0, bridges: [], finished: false, finishReady: false, improving: false, undosUsed: 0 };

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

const directionValue = { closer: 1, sideways: 0.55, detour: 0.15 };

function routeDirections(bridges = state.bridges) {
  const puzzle = currentPuzzle();
  const bridgeRoute = [puzzle.start, ...bridges];
  return bridgeRoute.slice(1).map((word, index) => classifyDirection(
    similarity(word, puzzle.end),
    similarity(bridgeRoute[index], puzzle.end),
  ));
}

function routeScoreData(bridges = state.bridges) {
  const puzzle = currentPuzzle();
  const route = [puzzle.start, ...bridges, puzzle.end];
  const steps = route.slice(0, -1).map((word, index) => similarity(word, route[index + 1]));
  const directions = routeDirections(bridges);
  const progressionFraction = directions.length
    ? directions.reduce((sum, direction) => sum + directionValue[direction], 0) / directions.length
    : 1;
  return { route, steps, directions, score: scoreRoute(steps, bridges.length, progressionFraction) };
}

function setEndpointScale(element, word) {
  element.classList.toggle("long-word", word.length >= 8);
  element.classList.toggle("very-long-word", word.length >= 11);
}

function renderGoalPull() {
  const currentSimilarity = finishSimilarity();
  const displayRange = PULL_DISPLAY_MAX - PULL_DISPLAY_MIN;
  const progress = Math.max(0, Math.min(1, (currentSimilarity - PULL_DISPLAY_MIN) / displayRange));
  const threshold = Math.max(0, Math.min(1, (MIN_FINISH_SIMILARITY - PULL_DISPLAY_MIN) / displayRange));
  const percent = Math.round(progress * 100);
  const label = currentSimilarity >= 0.58
    ? "Strong bridge"
    : currentSimilarity >= MIN_FINISH_SIMILARITY
      ? "Landing zone"
      : currentSimilarity >= 0.18
        ? "Approaching"
        : "Far away";
  elements.goalPullFill.style.width = `${percent}%`;
  elements.goalPullMarker.style.left = `${percent}%`;
  elements.goalPullThreshold.style.left = `${Math.round(threshold * 100)}%`;
  elements.goalPullLabel.textContent = label;
  elements.goalPull.setAttribute("aria-valuenow", String(percent));
  elements.goalPull.setAttribute("aria-valuetext", label);
}

function setFeedback(message, tone = "") {
  elements.feedback.textContent = message;
  elements.feedback.className = `feedback ${tone}`.trim();
}

function renderRoute() {
  const puzzle = currentPuzzle();
  const finishEligible = !state.finished && canFinish();
  const nodes = [
    { label: "Start", word: puzzle.start, className: "endpoint" },
    ...state.bridges.map((word, index) => ({
      label: `Bridge ${index + 1}`,
      word,
      className: "filled",
    })),
    ...(!state.finished && state.bridges.length < MAX_BRIDGES && (!finishEligible || state.improving)
      ? [{ label: finishEligible ? "Improve" : `Bridge ${state.bridges.length + 1}`, word: "+", className: finishEligible ? "current optional" : "current" }]
      : []),
    { label: "Goal", word: puzzle.end, className: "endpoint" },
  ];
  elements.routeTrack.replaceChildren(...nodes.map(({ label, word, className }) => {
    const node = document.createElement("div");
    node.className = `route-node ${className}${word.length >= 9 ? " long-word" : ""}`.trim();
    node.title = word === "+" ? `${label} slot` : word;
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
  const finishEligible = !state.finished && canFinish();
  const justUnlocked = finishEligible && !state.finishReady;
  if (!finishEligible) state.improving = false;
  state.finishReady = finishEligible;
  const previewScore = finishEligible ? routeScoreData().score : null;
  const showForm = !state.finished
    && state.bridges.length < MAX_BRIDGES
    && (!finishEligible || state.improving);
  elements.puzzleNumber.textContent = `Puzzle ${String(state.puzzleIndex + 1).padStart(2, "0")} / ${String(puzzles.length).padStart(2, "0")}`;
  elements.startWord.textContent = puzzle.start;
  elements.endWord.textContent = puzzle.end;
  setEndpointScale(elements.startWord, puzzle.start);
  setEndpointScale(elements.endWord, puzzle.end);
  elements.form.hidden = !showForm;
  elements.input.placeholder = finishEligible ? `A word that improves “${currentWord()}”` : `A word near “${currentWord()}”`;
  elements.input.value = "";
  elements.input.disabled = !showForm;
  elements.placeWord.disabled = elements.input.disabled;
  const undosLeft = MAX_UNDOS - state.undosUsed;
  elements.undo.disabled = state.finished || state.bridges.length === 0 || undosLeft === 0;
  elements.undo.textContent = `Undo last · ${undosLeft} left`;
  elements.tryImprove.hidden = !finishEligible || state.improving || state.bridges.length >= MAX_BRIDGES;
  elements.finish.disabled = state.finished || !finishEligible;
  elements.finish.textContent = finishEligible ? `Finish with ${previewScore}` : "Get closer to finish";
  elements.finish.classList.toggle("is-ready", finishEligible);
  elements.guessLabel.textContent = finishEligible ? "Try to improve your route" : "Your next bridge";
  elements.placeWord.textContent = finishEligible ? "Test this bridge" : "Place word";
  elements.crossingReady.hidden = !finishEligible;
  elements.crossingCurrent.textContent = `“${currentWord()}”`;
  elements.crossingEnd.textContent = `“${puzzle.end}”`;
  elements.crossingScore.textContent = `${previewScore ?? 0} point${previewScore === 1 ? "" : "s"}`;
  elements.playCard.classList.toggle("route-ready", finishEligible);
  if (justUnlocked) {
    elements.crossingReady.classList.remove("celebrate");
    elements.finish.classList.remove("celebrate");
    requestAnimationFrame(() => {
      elements.crossingReady.classList.add("celebrate");
      elements.finish.classList.add("celebrate");
    });
    setTimeout(() => {
      elements.crossingReady.classList.remove("celebrate");
      elements.finish.classList.remove("celebrate");
    }, 2400);
  }
  elements.movesLeft.textContent = `${state.bridges.length} of ${MAX_BRIDGES} bridge spaces used`;

  if (state.finished) {
    elements.instruction.textContent = `Route complete in ${state.bridges.length} bridge words.`;
  } else if (finishEligible && state.improving) {
    elements.instruction.textContent = `Test another connected word. You’ll see immediately whether it improves your ${previewScore}-point route.`;
  } else if (finishEligible) {
    elements.instruction.textContent = `Bridge found. Finish with ${previewScore} points, or try to improve it.`;
  } else if (state.bridges.length >= MAX_BRIDGES) {
    elements.instruction.textContent = `No bridge spaces left. Use an undo to try another direction.`;
  } else if (state.bridges.length < MIN_BRIDGES) {
    const remaining = MIN_BRIDGES - state.bridges.length;
    elements.instruction.textContent = `Move from ${currentWord()} toward ${puzzle.end}. Place ${remaining} more before the final crossing.`;
  } else {
    elements.instruction.textContent = `Find a word connected to ${currentWord()}. A sideways move or detour is allowed.`;
  }
  renderGoalPull();
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
  const previousScore = canFinish() ? routeScoreData().score : null;
  const jump = similarity(previous, word);
  const previousToEnd = similarity(previous, puzzle.end);
  const wordToEnd = similarity(word, puzzle.end);
  const verdict = canAcceptWord({ nextSimilarity: jump });
  if (!verdict.accepted) {
    const detail = `That jump is too wide. “${word}” isn’t connected enough to “${previous}”.`;
    setFeedback(detail, "bad");
    return { accepted: false, reason: detail, similarity: jump };
  }
  if (state.improving && previousScore !== null && wordToEnd < MIN_FINISH_SIMILARITY) {
    const detail = `That word leaves the landing zone, so it can’t improve this route. Try another bridge.`;
    setFeedback(detail, "warn");
    return { accepted: false, reason: detail, similarity: jump };
  }

  state.bridges.push(word);
  const direction = classifyDirection(wordToEnd, previousToEnd);
  const directionFeedback = {
    closer: [`Closer. “${word}” pulls you toward “${puzzle.end}”.`, "good"],
    sideways: [`Sideways. “${word}” keeps you about the same distance from “${puzzle.end}”.`, "neutral"],
    detour: [`Detour. “${word}” moves away from “${puzzle.end}”, but the connection holds.`, "warn"],
  };
  const nextScore = canFinish() ? routeScoreData().score : null;
  if (previousScore !== null && nextScore !== null) {
    const delta = nextScore - previousScore;
    const directionLead = directionFeedback[direction][0].split(". ")[0];
    if (delta > 0) setFeedback(`${directionLead}. Route improved: ${previousScore} → ${nextScore} (+${delta}).`, "good");
    else if (delta < 0) setFeedback(`${directionLead}. Route slipped: ${previousScore} → ${nextScore} (${delta}). Undo it or keep exploring.`, "warn");
    else setFeedback(`${directionLead}. Route score stays at ${nextScore}.`, "neutral");
  } else {
    setFeedback(...directionFeedback[direction]);
  }
  renderPuzzle();
  if (!elements.input.disabled) elements.input.focus();
  return {
    accepted: true,
    word,
    route: [puzzle.start, ...state.bridges],
    jumpSimilarity: Number(jump.toFixed(3)),
    destinationSimilarity: Number(wordToEnd.toFixed(3)),
    direction,
    canFinish: canFinish(),
    previewScore: nextScore,
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
  const { route, steps, score } = routeScoreData();
  state.finished = true;
  renderPuzzle();
  renderResults(route, steps, score);
  saveSessionEntry({ start: puzzle.start, end: puzzle.end, score, bridges: state.bridges.length, route });
  return { completed: true, score, route, stepSimilarities: steps.map((value) => Number(value.toFixed(3))) };
}

function renderResults(route, steps, score) {
  elements.results.hidden = false;
  activeMapRoute = route;
  activeMapSteps = steps;
  selectedStepIndex = null;
  elements.scoreValue.textContent = score;
  const weakest = Math.min(...steps);
  const weakestIndex = steps.indexOf(weakest);
  const label = score >= 78 ? "Elegant and steady." : score >= 58 ? "A convincing route." : "A daring route with a wide jump.";
  const directionCounts = routeDirections().reduce((counts, direction) => ({ ...counts, [direction]: counts[direction] + 1 }), { closer: 0, sideways: 0, detour: 0 });
  const directionSummary = [
    directionCounts.closer && `${directionCounts.closer} closer`,
    directionCounts.sideways && `${directionCounts.sideways} sideways`,
    directionCounts.detour && `${directionCounts.detour} detour${directionCounts.detour === 1 ? "" : "s"}`,
  ].filter(Boolean).join(" · ");
  elements.scoreNote.textContent = `${label} Your weakest link was ${route[weakestIndex]} → ${route[weakestIndex + 1]} at ${weakest.toFixed(2)} similarity. ${directionSummary}.`;
  elements.stepList.replaceChildren(...steps.map((value, index) => {
    const row = document.createElement("li");
    row.className = `step-row${index === weakestIndex ? " weakest" : ""}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "step-button";
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-label", `Trace ${route[index]} to ${route[index + 1]}, ${value.toFixed(2)} similarity${index === weakestIndex ? ", weakest link" : ""}`);
    const pair = document.createElement("div");
    pair.className = "step-pair";
    pair.append(document.createTextNode(route[index]), Object.assign(document.createElement("span"), { textContent: " → " }), document.createTextNode(route[index + 1]));
    if (index === weakestIndex) pair.append(Object.assign(document.createElement("small"), { className: "weakest-note", textContent: "Weakest link" }));
    const number = document.createElement("span");
    number.className = "step-score";
    number.textContent = value.toFixed(2);
    const badge = document.createElement("span");
    badge.className = "step-label";
    badge.textContent = stepLabel(value);
    button.append(pair, number, badge);
    button.addEventListener("click", () => selectStep(index, route, steps));
    row.append(button);
    return row;
  }));
  elements.mapStatus.textContent = "Select a crossing to trace it";
  drawSemanticMap(route);
  elements.results.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

function resetPuzzle(index = state.puzzleIndex) {
  state = { puzzleIndex: (index + puzzles.length) % puzzles.length, bridges: [], finished: false, finishReady: false, improving: false, undosUsed: 0 };
  activeMapRoute = [];
  activeMapSteps = [];
  selectedStepIndex = null;
  elements.results.hidden = true;
  setFeedback("Each connected word is accepted. We’ll show whether it moves closer, sideways, or on a detour.");
  renderPuzzle();
  elements.input.focus();
}

function selectStep(index, route, steps) {
  selectedStepIndex = index;
  elements.stepList.querySelectorAll(".step-button").forEach((button, buttonIndex) => {
    button.setAttribute("aria-pressed", String(buttonIndex === index));
  });
  elements.mapStatus.textContent = `${route[index]} → ${route[index + 1]} · ${steps[index].toFixed(2)} similarity`;
  drawSemanticMap(route, index, false);
}

function drawSemanticMap(route, highlightedStep = selectedStepIndex, animate = true) {
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
  const reduced = !animate || matchMedia("(prefers-reduced-motion: reduce)").matches;

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

    if (Number.isInteger(highlightedStep) && progress === 1) {
      const selectedStart = routePoints[highlightedStep];
      const selectedEnd = routePoints[highlightedStep + 1];
      context.beginPath();
      context.moveTo(selectedStart.x, selectedStart.y);
      context.lineTo(selectedEnd.x, selectedEnd.y);
      context.lineWidth = 8;
      context.strokeStyle = "#ff7358";
      context.stroke();
      context.lineWidth = 3;
      context.strokeStyle = "#ffffff";
      context.stroke();
    }

    mapHitTargets = [];
    routePoints.forEach((point, index) => {
      if (index > segmentProgress + 0.12) return;
      const isSelected = index === highlightedStep || index === highlightedStep + 1;
      const color = isSelected ? "#ff7358" : index === 0 ? "#ff7358" : index === routePoints.length - 1 ? "#4de0c1" : "#ffffff";
      context.beginPath();
      context.arc(point.x, point.y, isSelected ? 8 : index === 0 || index === routePoints.length - 1 ? 7 : 5.5, 0, Math.PI * 2);
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

function renderWalkthrough() {
  const steps = [...elements.walkthrough.querySelectorAll(".walkthrough-step")];
  steps.forEach((step, index) => { step.hidden = index !== walkthroughStep; });
  elements.walkthroughProgress.textContent = `Step ${walkthroughStep + 1} of ${steps.length}`;
  elements.walkthroughBack.hidden = walkthroughStep === 0;
  elements.walkthroughNext.textContent = walkthroughStep === steps.length - 1 ? "Start playing" : "Next";
}

function openWalkthrough() {
  walkthroughStep = 0;
  renderWalkthrough();
  if (!elements.walkthrough.open) elements.walkthrough.showModal();
}

function rememberWalkthrough() {
  try { localStorage.setItem(WALKTHROUGH_KEY, "seen"); }
  catch { /* The game still works when local preferences are unavailable. */ }
}

function closeWalkthrough() {
  rememberWalkthrough();
  if (elements.walkthrough.open) elements.walkthrough.close();
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
  if (state.undosUsed >= MAX_UNDOS || state.bridges.length === 0) return;
  const removed = state.bridges.pop();
  state.undosUsed += 1;
  if (!canFinish()) state.improving = false;
  const undosLeft = MAX_UNDOS - state.undosUsed;
  setFeedback(`Removed “${removed}”. ${undosLeft} undo${undosLeft === 1 ? "" : "s"} left.`);
  renderPuzzle();
  if (!elements.input.disabled) elements.input.focus();
});
elements.tryImprove.addEventListener("click", () => {
  state.improving = true;
  setFeedback("Add a connected word. We’ll show exactly how it changes your score.");
  renderPuzzle();
  elements.input.focus();
});
elements.finish.addEventListener("click", completeRoute);
elements.nextPuzzle.addEventListener("click", () => resetPuzzle(state.puzzleIndex + 1));
elements.playAgain.addEventListener("click", () => resetPuzzle(state.puzzleIndex + 1));
elements.openWalkthrough.addEventListener("click", openWalkthrough);
elements.walkthroughClose.addEventListener("click", closeWalkthrough);
elements.walkthroughBack.addEventListener("click", () => {
  walkthroughStep = Math.max(0, walkthroughStep - 1);
  renderWalkthrough();
});
elements.walkthroughNext.addEventListener("click", () => {
  const stepCount = elements.walkthrough.querySelectorAll(".walkthrough-step").length;
  if (walkthroughStep >= stepCount - 1) closeWalkthrough();
  else {
    walkthroughStep += 1;
    renderWalkthrough();
  }
});
elements.walkthrough.addEventListener("close", rememberWalkthrough);
elements.canvas.addEventListener("pointermove", (event) => {
  const bounds = elements.canvas.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  const match = mapHitTargets.find((target) => Math.hypot(target.x - x, target.y - y) <= target.radius);
  elements.canvas.style.cursor = match ? "crosshair" : "default";
  if (match) elements.mapStatus.textContent = match.word;
  else if (selectedStepIndex === null) elements.mapStatus.textContent = "Select a crossing to trace it";
  else {
    const left = activeMapRoute[selectedStepIndex];
    const right = activeMapRoute[selectedStepIndex + 1];
    elements.mapStatus.textContent = `${left} → ${right} · ${activeMapSteps[selectedStepIndex].toFixed(2)} similarity`;
  }
});
new ResizeObserver(() => {
  if (!elements.results.hidden) {
    drawSemanticMap(activeMapRoute, selectedStepIndex, false);
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
    setFeedback("Each connected word is accepted. We’ll show whether it moves closer, sideways, or on a detour.");
    renderHistory();
    renderPuzzle();
    registerWebMcp();
    try {
      if (!localStorage.getItem(WALKTHROUGH_KEY)) openWalkthrough();
    } catch {
      openWalkthrough();
    }
  } catch (error) {
    console.error(error);
    elements.game.setAttribute("aria-busy", "false");
    setFeedback("The word map could not load. Refresh the page to try again.", "bad");
  }
}

initialize();
