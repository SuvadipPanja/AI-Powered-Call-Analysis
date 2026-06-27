import React, { createContext, useContext, useEffect, useState } from "react";
import config from "../utils/envConfig";

const WebSocketContext = createContext(null);

export const WebSocketProvider = ({ children }) => {
  const [ws, setWs] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [supervisors, setSupervisors] = useState([]);
  const [username, setUsername] = useState("");
  const [userType, setUserType] = useState("");
  const [logId, setLogId] = useState("");
  const [userId, setUserId] = useState("");

  const connectWebSocket = (userId, username, userType, logId) => {
    if (ws && isConnected) {
      console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [WS] WebSocket already connected, skipping reconnection.`);
      return;
    }

    if (!userId || !username || !userType || !logId) {
      console.error(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [WS] Cannot connect WebSocket: Missing parameters`, { userId, username, userType, logId });
      return;
    }

    const websocket = new WebSocket(config.wsUrl || 'ws://localhost:5000');

    websocket.onopen = () => {
      console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [WS] WebSocket connection established`);
      setIsConnected(true);
      const sessionToken =
        localStorage.getItem("token") || localStorage.getItem("sessionToken") || "";
      const registerMessage = {
        type: "register",
        userId,
        username,
        userType,
        logId: parseInt(logId, 10),
        sessionToken,
      };
      websocket.send(JSON.stringify(registerMessage));
      console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [WS] Sent register message:`, registerMessage);
      setWs(websocket);
      setUserId(userId);
      setUsername(username);
      setUserType(userType);
      setLogId(logId);
    };

    websocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [WS] Message received:`, message);
        if (message.type === "userList") {
          setSupervisors(message.supervisors || []);
        } else if (message.type === "chat") {
          setChatMessages((prev) => [...prev, message]);
        } else if (message.type === "chatClosed") {
          setChatMessages((prev) => [
            ...prev,
            {
              type: "chatClosed",
              agentUsername: message.agentUsername,
              timestamp: message.timestamp,
              logId: message.logId,
            },
          ]);
        } else if (message.type === "error") {
          console.error(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [WS] Server error:`, message.message);
        }
      } catch (error) {
        console.error(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [WS] Error parsing message:`, error);
      }
    };

    websocket.onclose = () => {
      console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [WS] WebSocket connection closed`);
      setIsConnected(false);
      setWs(null);
      setUserId("");
      setUsername("");
      setUserType("");
      setLogId("");
    };

    websocket.onerror = (error) => {
      console.error(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [WS] WebSocket error:`, error);
    };
  };

  const disconnectWebSocket = () => {
    if (ws) {
      ws.close();
      console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [WS] WebSocket connection closed manually`);
    }
  };

  const sendMessage = (to, text) => {
    if (ws && isConnected) {
      const message = {
        type: "chat",
        from: username,
        to,
        text,
        timestamp: new Date().toISOString(),
        fromType: userType,
      };
      ws.send(JSON.stringify(message));
      console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [WS] Sent chat message:`, message);
    } else {
      console.error(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [WS] Cannot send message: WebSocket is not connected`);
    }
  };

  return (
    <WebSocketContext.Provider
      value={{
        connectWebSocket,
        disconnectWebSocket,
        sendMessage,
        chatMessages,
        supervisors,
        isConnected,
      }}
    >
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocket = () => useContext(WebSocketContext);