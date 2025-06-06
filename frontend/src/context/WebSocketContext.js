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

  const connectWebSocket = (user, type, id) => {
    if (ws && isConnected) {
      console.log("[WS] WebSocket already connected, skipping reconnection.");
      return;
    }

    const websocket = new WebSocket(config.wsUrl);

    websocket.onopen = () => {
      console.log("[WS] WebSocket connection established");
      setIsConnected(true);
      websocket.send(
        JSON.stringify({
          type: "register",
          username: user,
          userType: type,
          logId: id,
        })
      );
      setWs(websocket);
      setUsername(user);
      setUserType(type);
      setLogId(id);
    };

    websocket.onmessage = (event) => {
      const message = JSON.parse(event.data);
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
          },
        ]);
      }
    };

    websocket.onclose = () => {
      console.log("[WS] WebSocket connection closed");
      setIsConnected(false);
      setWs(null);
      setUsername("");
      setUserType("");
      setLogId("");
    };

    websocket.onerror = (error) => {
      console.error("[WS] WebSocket error:", error);
    };
  };

  const disconnectWebSocket = () => {
    if (ws) {
      ws.close();
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
    } else {
      console.error("[WS] Cannot send message: WebSocket is not connected");
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