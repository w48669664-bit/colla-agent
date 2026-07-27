import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "public", "game");
const [html, css, js] = await Promise.all([
  readFile(path.join(root, "index.html"), "utf8"),
  readFile(path.join(root, "styles.css"), "utf8"),
  readFile(path.join(root, "game.js"), "utf8"),
]);

assert.match(html, /<canvas\b/i, "index.html must include a canvas");
assert.match(html, /game\.js/i, "index.html must load game.js");
assert.match(html, /styles\.css/i, "index.html must load styles.css");
assert.match(js, /keydown/i, "game.js must support keyboard controls");
assert.match(js, /(touchstart|pointerdown)/i, "game.js must support touch or pointer controls");
assert.match(js, /localStorage/i, "game.js must persist a best score");
assert.match(js, /__snakeDebug/i, "game.js must expose window.__snakeDebug");
assert.match(js, /(pause|paused)/i, "game.js must implement pause");
assert.match(js, /(restart|resetGame|startGame)/i, "game.js must implement restart");
assert.ok(css.length > 600, "styles.css must contain a complete visual treatment");

console.log("PASS index/canvas/assets");
console.log("PASS keyboard/touch/pause/restart");
console.log("PASS best-score persistence");
console.log("PASS window.__snakeDebug contract");
