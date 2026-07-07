const fs = require("fs");
const path = require("path");
const serverPath = path.join(__dirname, "..", "server.js");
const lines = fs.readFileSync(serverPath, "utf8").split(/\r?\n/);

const start = lines.findIndex((l) => l.includes("11) WebSocket Integration"));
const end = lines.findIndex((l) => l.includes("12) Start the Server"));
if (start < 0 || end < 0) throw new Error("WS block markers not found");

const replacement = [
  "/* ===================== 11) WebSocket Integration ===================== */",
  'const { attachWebSocketHub } = require("./websocket/wsHub");',
  "const wss = attachWebSocketHub(server, { sql, sqlConnect, getISTTimeString, resolveProjectPath });",
  "",
  "/* ===================== 12) Start the Server ===================== */",
];

const out = [...lines.slice(0, start), ...replacement, ...lines.slice(end + 1)];
fs.writeFileSync(serverPath, out.join("\n"));
console.log("Replaced inline WebSocket block with wsHub attach.");
