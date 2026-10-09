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
}

await command("Runtime.evaluate", { expression: "localStorage.setItem('find-the-bridge-walkthrough-v1','seen')" });
await command("Page.reload", { ignoreCache: true });
await new Promise((resolve) => setTimeout(resolve, 1100));
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
if (process.argv.includes("--improve")) {
  await command("Runtime.evaluate", { expression: "if (document.querySelector('#bridge-found-dialog')?.open) document.querySelector('#improve-found-route').click(); else if (!document.querySelector('#try-improve').hidden) document.querySelector('#try-improve').click()" });
  await new Promise((resolve) => setTimeout(resolve, 250));
} else {
  await command("Runtime.evaluate", { expression: "if (document.querySelector('#bridge-found-dialog')?.open) document.querySelector('#bridge-found-dialog').close()" });
}
if (process.argv.includes("--type-test")) {
  await command("Runtime.evaluate", { expression: "document.querySelector('#next-puzzle').focus(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true }))" });
}
await command("Runtime.evaluate", { expression: "window.scrollTo(0, 0)" });
const diagnostics = await command("Runtime.evaluate", {
  expression: `JSON.stringify({
    viewport: [innerWidth, innerHeight],
    scrollWidth: document.documentElement.scrollWidth,
    scrollX,
    title: document.title,
    canvas: (() => { const r = document.querySelector('#progress-galaxy').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
    inputEnabled: !document.querySelector('#guess-input').disabled,
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
