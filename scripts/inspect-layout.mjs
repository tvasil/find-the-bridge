import { writeFileSync } from "node:fs";

const pages = await fetch("http://127.0.0.1:9222/json").then((response) => response.json());
const page = pages.find((entry) => entry.type === "page" && entry.url.includes("127.0.0.1:4173"));
if (!page) throw new Error("Preview page not found");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let sequence = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});
const command = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});

if (process.argv.includes("--mobile")) {
  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
} else {
  await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
}

await command("Runtime.evaluate", { expression: `localStorage.setItem('find-the-bridge-walkthrough-v1','seen'); localStorage.setItem('find-the-bridge-mode-v1', ${JSON.stringify(process.argv.includes("--tania") ? "tania" : "classic")})` });
await command("Page.reload", { ignoreCache: true });
await new Promise((resolve) => setTimeout(resolve, 1100));
if (process.argv.includes("--tooltip")) {
  await command("Runtime.evaluate", { expression: "document.querySelector('.similarity-explainer summary').click()" });
  await new Promise((resolve) => setTimeout(resolve, 180));
}
if (process.argv.includes("--hard-tilt")) {
  const canvasRect = await command("Runtime.evaluate", { expression: "JSON.stringify((() => { const r = document.querySelector('#progress-galaxy').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })())", returnByValue: true });
  const rect = JSON.parse(canvasRect.result.value);
  const startX = rect.left + rect.width * .75;
  const endX = rect.left + 4;
  const y = rect.top + rect.height * .55;
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: startX, y });
  await command("Input.dispatchMouseEvent", { type: "mousePressed", x: startX, y, button: "left", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: endX, y, button: "left", buttons: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: endX, y, button: "left", clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 650));
}
const demoWords = process.argv.slice(3).filter((argument) => !argument.startsWith("--"));
const expectedStart = demoWords.shift();
if (expectedStart) {
  for (let index = 0; index < 24; index += 1) {
    const visibleStart = await command("Runtime.evaluate", { expression: "document.querySelector('#start-word').textContent", returnByValue: true });
    if (visibleStart.result.value === expectedStart) break;
    await command("Runtime.evaluate", { expression: "document.querySelector('#next-puzzle').click()" });
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
}
for (const word of demoWords) {
  await command("Runtime.evaluate", {
    expression: `document.querySelector('#guess-input').value = ${JSON.stringify(word)}; document.querySelector('#guess-form').requestSubmit();`,
  });
  await new Promise((resolve) => setTimeout(resolve, 700));
}
if (process.argv.includes("--finish")) {
  await command("Runtime.evaluate", { expression: "if (document.querySelector('#bridge-found-dialog')?.open) document.querySelector('#finish-found-route').click(); else if (!document.querySelector('#finish-route').disabled) document.querySelector('#finish-route').click()" });
  await new Promise((resolve) => setTimeout(resolve, 900));
} else if (process.argv.includes("--improve")) {
  await command("Runtime.evaluate", { expression: "if (document.querySelector('#bridge-found-dialog')?.open) document.querySelector('#improve-found-route').click(); else if (!document.querySelector('#try-improve').hidden) document.querySelector('#try-improve').click()" });
  await new Promise((resolve) => setTimeout(resolve, 250));
} else {
  await command("Runtime.evaluate", { expression: "if (document.querySelector('#bridge-found-dialog')?.open) document.querySelector('#bridge-found-dialog').close()" });
}
if (process.argv.includes("--type-test")) {
  await command("Runtime.evaluate", { expression: "document.querySelector('#next-puzzle').focus(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true }))" });
}
await command("Runtime.evaluate", { expression: process.argv.includes("--results") ? "document.querySelector('#results').scrollIntoView()" : "window.scrollTo(0, 0)" });
const diagnostics = await command("Runtime.evaluate", {
  expression: `JSON.stringify({
    viewport: [innerWidth, innerHeight],
    scrollWidth: document.documentElement.scrollWidth,
    scrollX,
    title: document.title,
    canvas: (() => { const r = document.querySelector('#progress-galaxy').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
    inputEnabled: !document.querySelector('#guess-input').disabled,
    mode: document.querySelector('#tania-mode').getAttribute('aria-pressed') === 'true' ? 'tania' : 'classic',
    taniaRuleVisible: !document.querySelector('#tania-rule').hidden,
    similarityExplainerOpen: document.querySelector('.similarity-explainer').open,
    similarityPopover: (() => { const details = document.querySelector('.similarity-explainer'); if (!details.open) return null; const r = document.querySelector('.similarity-popover').getBoundingClientRect(); const p = document.querySelector('.play-card').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width), playCardBottom: Math.round(p.bottom), clippedByCard: r.bottom > p.bottom }; })(),
    resultsVisible: !document.querySelector('#results').hidden,
    resultScore: document.querySelector('#score-value').textContent,
    inputValue: document.querySelector('#guess-input').value,
    inputWidth: Math.round(document.querySelector('#guess-input').getBoundingClientRect().width),
    autocomplete: document.querySelector('#guess-input').autocomplete,
    hasSuggestionList: document.querySelector('#guess-input').hasAttribute('list'),
    endpointFits: [...document.querySelectorAll('.destination-lockup strong')].map((node) => ({ word: node.textContent, client: node.clientWidth, scroll: node.scrollWidth, font: getComputedStyle(node).fontSize })),
    routeNodes: document.querySelectorAll('.route-node').length,
    errors: window.__layoutErrors || []
  })`,
  returnByValue: true,
});
const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
writeFileSync(process.argv[2] || "/private/tmp/find-the-bridge-galaxy.png", Buffer.from(screenshot.data, "base64"));
console.log(diagnostics.result.value);
socket.close();
