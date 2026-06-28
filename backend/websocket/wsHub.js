/**
 * WebSocket chat hub with optional Redis pub/sub for multi-instance scaling (Sprint 3.5).
 */
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const { createClient } = require("redis");
const { getRedisUrl } = require("../services/redisClient");

const WS_CHAT_CHANNEL = "sp:ws:chat";
const WS_LICENSE_CHANNEL = "sp:ws:license";
const INSTANCE_ID = process.env.HOSTNAME || process.env.INSTANCE_ID || `node-${process.pid}`;

function attachWebSocketHub(httpServer, deps) {
  const { sql, sqlConnect, getISTTimeString, resolveProjectPath } = deps;

/* ===================== 11) WebSocket Integration ===================== */
const wss = new WebSocket.Server({ server: httpServer });
global.websocketServer = wss;

const clients = new Map();
const chatSessions = new Map();
const activeChats = new Map();
const usernameToUserId = new Map();

// WebSocket auth follows the same toggle as the REST API gate.
const WS_AUTH_ENFORCE = String(process.env.API_AUTH_ENFORCE || "true").toLowerCase() !== "false";

/**
 * Validates a session token against dbo.ActiveSessions and returns the
 * authoritative identity from the DB (never trusting client-supplied values).
 */
async function validateWsSession(token) {
  if (!token) return null;
  try {
    const pool = await sqlConnect();
    const result = await pool.request()
      .input("token", sql.NVarChar, token)
      .query(`
        SELECT TOP 1 s.UserID, s.Username, s.LogID, u.AccountType
        FROM dbo.ActiveSessions s
        LEFT JOIN dbo.Users u ON s.Username = u.Username
        WHERE s.Token = @token AND s.IsActive = 1
      `);
    if (!result.recordset.length) return null;
    const row = result.recordset[0];
    return {
      userId: row.UserID != null ? String(row.UserID) : null,
      username: row.Username,
      userType: row.AccountType || "Agent",
      logId: row.LogID,
    };
  } catch (err) {
    console.error(`[${getISTTimeString()}] [WS] Session validation error: ${err.message}`);
    return null;
  }
}

function deliverUserListLocal() {
  const supervisors = [];
  clients.forEach((info) => {
    if (info.userType === "Team Leader" || info.userType === "Super Admin") {
      supervisors.push(info.username);
    }
  });
  const userListMessage = { type: "userList", supervisors };
  clients.forEach((_, clientWs) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify(userListMessage));
    }
  });
}

function broadcastUserList() {
  deliverUserListLocal();
}

function deliverChatMessageLocal(message) {
  const chatMessage = { type: "chat", from, fromType, to, text, timestamp, logId };
  const sentClients = new Set(); // Track sent clients to avoid duplicates

  if (to === "all" && fromType === "Agent") {
    clients.forEach((clientInfo, clientWs) => {
      if (
        clientWs.readyState === WebSocket.OPEN &&
        (clientInfo.userType === "Team Leader" || clientInfo.userType === "Super Admin") &&
        !sentClients.has(clientWs)
      ) {
        clientWs.send(JSON.stringify(chatMessage));
        console.log(`[${getISTTimeString()}] [WS] Sent message to ${clientInfo.userType} ${clientInfo.username} (UserID: ${clientInfo.userId})`);
        sentClients.add(clientWs);
      }
    });
  } else if (to === "all") {
    clients.forEach((clientInfo, clientWs) => {
      if (
        clientWs.readyState === WebSocket.OPEN &&
        clientInfo.userType === "Agent" &&
        !sentClients.has(clientWs)
      ) {
        clientWs.send(JSON.stringify(chatMessage));
        console.log(`[${getISTTimeString()}] [WS] Broadcast to agent ${clientInfo.username}`);
        sentClients.add(clientWs);
      }
    });
    clients.forEach((clientInfo, clientWs) => {
      if (
        clientWs.readyState === WebSocket.OPEN &&
        (clientInfo.username === from || clientInfo.userType === "Team Leader" || clientInfo.userType === "Super Admin") &&
        !sentClients.has(clientWs)
      ) {
        clientWs.send(JSON.stringify(chatMessage));
        sentClients.add(clientWs);
      }
    });
  } else {
    // Send to the recipient (to), the sender (from), and all supervisors
    clients.forEach((clientInfo, clientWs) => {
      if (
        clientWs.readyState === WebSocket.OPEN &&
        (clientInfo.username === to || // Include the recipient
         clientInfo.username === from || // Include the sender
         clientInfo.userType === "Team Leader" || // Include all Team Leaders
         clientInfo.userType === "Super Admin") && // Include all Super Admins
        !sentClients.has(clientWs)
      ) {
        clientWs.send(JSON.stringify(chatMessage));
        console.log(`[${getISTTimeString()}] [WS] Sent message to ${clientInfo.username} (UserID: ${clientInfo.userId})`);
        sentClients.add(clientWs);
      }
    });
  }
}

function broadcastChatMessage(message) {
  deliverChatMessageLocal(message);
  if (typeof global.__wsPublishChat === "function") {
    global.__wsPublishChat(message).catch(() => {});
  }
}

// Sprint 8 — real-time license control. Push license state to every connected
// client so revoke/expiry/tamper takes effect live (no restart). Fans out across
// instances via Redis when pub/sub is enabled.
function deliverLicenseStateLocal(message) {
  clients.forEach((_, clientWs) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify(message));
    }
  });
}
global.wsBroadcastLicense = (payload) => {
  const message = { type: "license", ...payload };
  deliverLicenseStateLocal(message);
  if (typeof global.__wsPublishLicense === "function") {
    global.__wsPublishLicense(message).catch(() => {});
  }
};

wss.on("connection", (ws) => {
  //console.log(`[${getISTTimeString()}] [WS] New WebSocket connection established`);

  ws.on("message", async (msg) => {
    let parsedMessage;
    try {
      parsedMessage = JSON.parse(msg);
      //console.log(`[${getISTTimeString()}] [WS] Received raw message:`, msg); // Debug raw input
    } catch (error) {
      console.error(`[${getISTTimeString()}] [WS] Invalid message format:`, error.message);
      ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
      return;
    }

    if (parsedMessage.type === "register") {
      let { userId, username, userType, logId } = parsedMessage;
      const sessionToken = parsedMessage.sessionToken || parsedMessage.token;
      //console.log(`[${getISTTimeString()}] [WS] Received register message: ${username}`);

      if (WS_AUTH_ENFORCE) {
        const session = await validateWsSession(sessionToken);
        if (!session) {
          ws.send(JSON.stringify({ type: "error", message: "Authentication required. Please log in again." }));
          console.warn(`[${getISTTimeString()}] [WS] Register rejected: invalid or missing session token`);
          return;
        }
        // Trust the DB session, not client-supplied identity fields.
        userId = session.userId;
        username = session.username;
        userType = session.userType;
        logId = session.logId != null ? session.logId : logId;
      }

      if (!userId || !username || !userType || !logId) {
        ws.send(JSON.stringify({ type: "error", message: "Missing registration details" }));
        return;
      }
      let existingClient = null;
      for (const [clientWs, info] of clients) {
        if (info.username === username || info.userId === userId) {
          existingClient = clientWs;
          break;
        }
      }
      if (existingClient) {
        clients.delete(existingClient);
        //console.log(`[${getISTTimeString()}] [WS] Replaced existing connection for ${username}`);
      }
      clients.set(ws, { userId, username, userType, logId });
      usernameToUserId.set(username, userId);
      //console.log(`[${getISTTimeString()}] [WS] Registered ${userType}: ${username}`);
      ws.send(JSON.stringify({ type: "registerAck", message: "Registration successful" })); // Acknowledge registration
      broadcastUserList();
      return;
    }

    if (parsedMessage.type === "chat") {
      const { from, to, text, timestamp, fromType } = parsedMessage;
      console.log(`[${getISTTimeString()}] [WS] Received chat message: from=${from}, to=${to}, text=${text}, fromType=${fromType}`); // Debug received chat
      const senderInfo = clients.get(ws);
      if (!senderInfo) {
        ws.send(JSON.stringify({ type: "error", message: "Not registered" }));
        console.error(`[${getISTTimeString()}] [WS] Chat message failed: Sender not registered`);
        return;
      }
      if (!to || !text || !timestamp) {
        ws.send(JSON.stringify({ type: "error", message: "Invalid chat message data" }));
        console.error(`[${getISTTimeString()}] [WS] Chat message failed: Invalid data`);
        return;
      }

      let session;
      let logId = null;

      if (senderInfo.userType === "Agent" && !chatSessions.has(senderInfo.userId)) {
        const timestampStr = new Date().toISOString().replace(/[:.]/g, "-");
        const chatDir = resolveProjectPath(process.env.CHAT_DUMP_DIR);
        if (!fs.existsSync(chatDir)) {
          fs.mkdirSync(chatDir, { recursive: true });
          console.log(`[${getISTTimeString()}] [WS] Chat dump directory created: ${chatDir}`);
        }
        const filePath = path.join(chatDir, `chat_UserID_${senderInfo.userId}_${timestampStr}.txt`);
        chatSessions.set(senderInfo.userId, {
          filePath,
          ws,
          logId: null,
          startTime: null,
          chatContent: "",
        });
        fs.writeFileSync(
          filePath,
          `Chat Session Started: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} by UserID ${senderInfo.userId} (Username: ${senderInfo.username})\n`
        );
        console.log(`[${getISTTimeString()}] [WS] Chat session file created for ${senderInfo.userId}: ${filePath}`);

        try {
          const pool = await sqlConnect();
          const result = await pool.request()
            .input("agentUserID", sql.NVarChar, senderInfo.userId)
            .input("agentUsername", sql.NVarChar, senderInfo.username)
            .input("entireChat", sql.NVarChar(sql.MAX), "")
            .input("startTime", sql.DateTime, new Date())
            .input("isClosed", sql.Bit, 0)
            .query(`
              INSERT INTO [dbo].[ChatLog] (AgentUserID, AgentUsername, EntireChat, StartTime, IsClosed)
              OUTPUT INSERTED.LogID
              VALUES (@agentUserID, @agentUsername, @entireChat, @startTime, @isClosed)
            `);
          logId = result.recordset[0].LogID;
          if (!logId) {
            throw new Error("LogID not returned from DB");
          }
          chatSessions.get(senderInfo.userId).logId = logId;
          chatSessions.get(senderInfo.userId).startTime = new Date();
          activeChats.set(senderInfo.userId, {
            logId,
            startTime: new Date(),
          });
          console.log(`[${getISTTimeString()}] [WS] New chat started for ${senderInfo.userId} with LogID: ${logId}`);
        } catch (error) {
          console.error(`[${getISTTimeString()}] [WS] Error starting chat log:`, error.message);
          ws.send(JSON.stringify({ type: "error", message: "Failed to start chat session" }));
          chatSessions.delete(senderInfo.userId);
          return;
        }
      }

      if (senderInfo.userType === "Agent") {
        session = chatSessions.get(senderInfo.userId);
        logId = session ? session.logId : null;
      } else if (to !== "all") {
        const toUserId = usernameToUserId.get(to);
        if (toUserId && chatSessions.has(toUserId)) {
          session = chatSessions.get(toUserId);
          logId = session ? session.logId : null;
        }
      }

      if (session) {
        const formattedMessage = `[${new Date(timestamp).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] ${from} (${senderInfo.userType}): ${text}\n`;
        try {
          fs.appendFileSync(session.filePath, formattedMessage);
          session.chatContent += formattedMessage;
          console.log(`[${getISTTimeString()}] [WS] Chat logged to ${session.filePath}: ${formattedMessage.trim()}`);
        } catch (error) {
          console.error(`[${getISTTimeString()}] [WS] Error writing to chat file:`, error.message);
        }

        if (session.logId) {
          try {
            const pool = await sqlConnect();
            await pool.request()
              .input("logId", sql.Int, session.logId)
              .input("entireChat", sql.NVarChar(sql.MAX), session.chatContent)
              .query(`
                UPDATE [dbo].[ChatLog]
                SET EntireChat = @entireChat
                WHERE LogID = @logId
              `);
            console.log(`[${getISTTimeString()}] [WS] Chat updated in DB for LogID: ${session.logId}`);
          } catch (error) {
            console.error(`[${getISTTimeString()}] [WS] Error updating chat in DB:`, error.message);
          }
        }
      } else if (senderInfo.userType !== "Agent" && to !== "all") {
        console.warn(`[${getISTTimeString()}] [WS] No chat session found for recipient ${to}`);
      }

      broadcastChatMessage({ ...parsedMessage, logId });
      ws.send(JSON.stringify({ type: "chatAck", message: "Message broadcasted", to })); // Acknowledge to sender
      return;
    }

    if (parsedMessage.type === "chatClosed") {
      const senderInfo = clients.get(ws);
      if (!senderInfo || senderInfo.userType !== "Agent") {
        ws.send(JSON.stringify({ type: "error", message: "Only agents can close chats" }));
        console.error(`[${getISTTimeString()}] [WS] Chat closure failed: Sender is not an agent`);
        return;
      }
      const agentUserId = senderInfo.userId;
      const session = chatSessions.get(agentUserId);
      if (session && session.logId) {
        try {
          const pool = await sqlConnect();
          await pool.request()
            .input("logId", sql.Int, session.logId)
            .input("entireChat", sql.NVarChar(sql.MAX), session.chatContent)
            .input("endTime", sql.DateTime, new Date())
            .input("isClosed", sql.Bit, 1)
            .query(`
              UPDATE [dbo].[ChatLog]
              SET EntireChat = @entireChat, EndTime = @endTime, IsClosed = @isClosed
              WHERE LogID = @logId
            `);
          console.log(`[${getISTTimeString()}] [WS] Chat closed for ${agentUserId} with LogID: ${session.logId}`);
          const closeMessage = {
            type: "chatClosed",
            agentUserId,
            agentUsername: senderInfo.username,
            timestamp: new Date().toISOString(),
            logId: session.logId,
          };
          clients.forEach((clientInfo, clientWs) => {
            if (
              clientWs.readyState === WebSocket.OPEN &&
              clientWs !== ws &&
              (clientInfo.userType === "Team Leader" || clientInfo.userType === "Super Admin")
            ) {
              clientWs.send(JSON.stringify(closeMessage));
              console.log(`[${getISTTimeString()}] [WS] Notified ${clientInfo.userType} ${clientInfo.username} (UserID: ${clientInfo.userId}) of chat closure`);
            }
          });
          activeChats.delete(agentUserId);
          chatSessions.delete(agentUserId);
          broadcastUserList();
        } catch (error) {
          console.error(`[${getISTTimeString()}] [WS] Error closing chat:`, error.message);
          ws.send(JSON.stringify({ type: "error", message: "Failed to close chat" }));
        }
      } else {
        console.log(`[${getISTTimeString()}] [WS] No active chat session found for ${agentUserId}`);
        ws.send(JSON.stringify({ type: "error", message: "No active chat session to close" }));
      }
      return;
    }
  });

  ws.on("close", async () => {
  const clientInfo = clients.get(ws);
  if (clientInfo) {
    console.log(`[${getISTTimeString()}] [WS] ${clientInfo.userType} UserID ${clientInfo.userId} (Username: ${clientInfo.username}) disconnected`);
    if (clientInfo.userType === "Agent" && activeChats.has(clientInfo.userId)) {
      const chatInfo = activeChats.get(clientInfo.userId);
      try {
        const pool = await sqlConnect();
        await pool.request()
          .input("LogID", sql.Int, chatInfo.logId)
          .input("EndTime", sql.DateTime, new Date())
          .input("IsClosed", sql.Bit, 1)
          .query(`
            UPDATE [dbo].[ChatLog]
            SET EndTime = @EndTime, IsClosed = @IsClosed
            WHERE LogID = @LogID
          `);
        console.log(`[${getISTTimeString()}] [WS] Chat closed for UserID ${clientInfo.userId} with LogID: ${chatInfo.logId}`);
        activeChats.delete(clientInfo.userId);
        chatSessions.delete(clientInfo.userId);
      } catch (error) {
        console.error(`[${getISTTimeString()}] [WS] Error closing chat on disconnect:`, error.message);
      }
    }
    usernameToUserId.delete(clientInfo.username);
    clients.delete(ws);
    broadcastUserList();
    console.log(`[${getISTTimeString()}] [WS] Client removed for UserID ${clientInfo.userId}, no session invalidation`);
  }
});

  ws.on("error", (err) => {
    console.error(`[${getISTTimeString()}] [WS] WebSocket error:`, err.message);
  });

  ws.send(JSON.stringify({ message: "Welcome to the real-time chat system." }));
});

wss.on("listening", () => {
  console.log(`[${getISTTimeString()}] [WS] WebSocket server is listening on port ${process.env.PORT}`);
});

  initWsPubSub({
    getISTTimeString,
    deliverChatMessageLocal,
  }).catch((err) => {
    console.warn("[WARN] WS pub/sub init failed:", err.message);
  });

  return wss;
}

async function initWsPubSub({ getISTTimeString, deliverChatMessageLocal }) {
  const url = getRedisUrl();
  if (!url || String(process.env.WS_REDIS_PUBSUB || "true").toLowerCase() === "false") {
    return;
  }

  const publisher = createClient({ url });
  const subscriber = createClient({ url });
  await publisher.connect();
  await subscriber.connect();

  global.__wsPublishChat = async (payload) => {
    await publisher.publish(WS_CHAT_CHANNEL, JSON.stringify({ origin: INSTANCE_ID, payload }));
  };

  global.__wsPublishLicense = async (payload) => {
    await publisher.publish(WS_LICENSE_CHANNEL, JSON.stringify({ origin: INSTANCE_ID, payload }));
  };

  await subscriber.subscribe(WS_CHAT_CHANNEL, (raw) => {
    try {
      const { origin, payload } = JSON.parse(raw);
      if (origin === INSTANCE_ID) return;
      deliverChatMessageLocal(payload);
    } catch (err) {
      console.error(`[${getISTTimeString()}] [WS] Pub/sub chat error:`, err.message);
    }
  });

  await subscriber.subscribe(WS_LICENSE_CHANNEL, (raw) => {
    try {
      const { origin, payload } = JSON.parse(raw);
      if (origin === INSTANCE_ID) return;
      deliverLicenseStateLocal(payload);
    } catch (err) {
      console.error(`[${getISTTimeString()}] [WS] Pub/sub license error:`, err.message);
    }
  });

  console.log(`[INFO] WS Redis pub/sub active (instance ${INSTANCE_ID})`);
}

module.exports = { attachWebSocketHub, INSTANCE_ID };
