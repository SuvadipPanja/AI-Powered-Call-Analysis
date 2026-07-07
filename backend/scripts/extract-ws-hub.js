/**
 * Extract WebSocket block from server.js → websocket/wsHub.js
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const serverPath = path.join(root, "server.js");
const lines = fs.readFileSync(serverPath, "utf8").split(/\r?\n/);

const wsBody = lines.slice(5389 - 1, 5773).join("\n")
  .replace(/^const wss = new WebSocket\.Server\(\{ server \}\);/m, "const wss = new WebSocket.Server({ server: httpServer });")
  .replace(/^global\.websocketServer = wss;/m, "global.websocketServer = wss;");

const out = `/**
 * WebSocket chat hub with optional Redis pub/sub for multi-instance scaling (Sprint 3.5).
 */
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const { createClient } = require("redis");
const { getRedisUrl, isRedisReady } = require("../services/redisClient");

const WS_CHAT_CHANNEL = "sp:ws:chat";
const WS_USERLIST_CHANNEL = "sp:ws:userList";
const INSTANCE_ID = process.env.HOSTNAME || process.env.INSTANCE_ID || \`node-\${process.pid}\`;

function attachWebSocketHub(httpServer, deps) {
  const { sql, sqlConnect, getISTTimeString, resolveProjectPath } = deps;

${wsBody}

  initWsPubSub({
    clients,
    getISTTimeString,
    deliverChatMessage: broadcastChatMessage,
    deliverUserList: broadcastUserList,
  }).catch((err) => {
    console.warn("[WARN] WS pub/sub init failed:", err.message);
  });

  return wss;
}

let pubSubReady = false;

async function initWsPubSub({ clients, getISTTimeString, deliverChatMessage, deliverUserList }) {
  const url = getRedisUrl();
  if (!url || String(process.env.WS_REDIS_PUBSUB || "true").toLowerCase() === "false") {
    return;
  }

  const publisher = createClient({ url });
  const subscriber = createClient({ url });
  await publisher.connect();
  await subscriber.connect();

  const originalChat = deliverChatMessage;
  const originalUserList = deliverUserList;

  global.__wsPublishChat = async (payload) => {
    await publisher.publish(WS_CHAT_CHANNEL, JSON.stringify({ origin: INSTANCE_ID, payload }));
  };
  global.__wsPublishUserList = async (payload) => {
    await publisher.publish(WS_USERLIST_CHANNEL, JSON.stringify({ origin: INSTANCE_ID, payload }));
  };

  await subscriber.subscribe(WS_CHAT_CHANNEL, (raw) => {
    try {
      const { origin, payload } = JSON.parse(raw);
      if (origin === INSTANCE_ID) return;
      originalChat(payload);
    } catch (err) {
      console.error(\`[\${getISTTimeString()}] [WS] Pub/sub chat error:\`, err.message);
    }
  });

  await subscriber.subscribe(WS_USERLIST_CHANNEL, (raw) => {
    try {
      const { origin, payload } = JSON.parse(raw);
      if (origin === INSTANCE_ID) return;
      const msg = payload;
      clients.forEach((_, clientWs) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify(msg));
        }
      });
    } catch (err) {
      console.error(\`[\${getISTTimeString()}] [WS] Pub/sub userList error:\`, err.message);
    }
  });

  pubSubReady = true;
  console.log(\`[INFO] WS Redis pub/sub active (instance \${INSTANCE_ID})\`);
}

module.exports = { attachWebSocketHub, INSTANCE_ID };
`;

// Patch broadcast functions in extracted body to use pub/sub when available
const patched = out.replace(
  "function broadcastUserList() {",
  `function broadcastUserList() {
  if (typeof global.__wsPublishUserList === "function") {
    const supervisors = [];
    clients.forEach((info) => {
      if (info.userType === "Team Leader" || info.userType === "Super Admin") {
        supervisors.push(info.username);
      }
    });
    global.__wsPublishUserList({ type: "userList", supervisors }).catch(() => {});
  }`
).replace(
  "function broadcastChatMessage(message) {",
  `function broadcastChatMessage(message) {
  if (typeof global.__wsPublishChat === "function") {
    global.__wsPublishChat(message).catch(() => {});
  }`
);

fs.mkdirSync(path.join(root, "websocket"), { recursive: true });
fs.writeFileSync(path.join(root, "websocket", "wsHub.js"), patched);
console.log("Wrote websocket/wsHub.js");
