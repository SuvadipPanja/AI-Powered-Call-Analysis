/**
 * File: ChatContext.js
 * Purpose: Provides a context for managing chat sessions and WebSocket communication in the application.
 * Author: $Panja
 * Creation Date: 2025-03-27
 * Modified Date: 2025-06-08
 * Changes:
 *  - Enhanced WebSocket readiness check with a callback mechanism.
 *  - Improved debug logging for WebSocket state transitions.
 *  - Added retry logic for message sending.
 */

import { createContext, useContext, useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import config from "../utils/envConfig";
import { useAuth } from "./AuthContext";

const ChatContext = createContext();

export const ChatProvider = ({ children }) => {
  const navigate = useNavigate();
  const { username, userType, userId, isLoggedIn } = useAuth();
  const [chatSessions, setChatSessions] = useState(() => {
    return JSON.parse(localStorage.getItem("chatSessions")) || {};
  });
  const [supervisors, setSupervisors] = useState([]); // State to store supervisors list
  const [ws, setWs] = useState(null);
  const wsRef = useRef(null); // Ref to track the current WebSocket instance
  const messageQueue = useRef([]); // Queue for pending messages
  const isWsReady = useRef(false); // Flag to track WebSocket readiness
  const logId = localStorage.getItem("logId") || "";

  useEffect(() => {
    if (!isLoggedIn || !username || !userType || !userId || !logId) {
      console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [WS] Waiting for login data before connecting WebSocket`);
      return;
    }

    const initializeWebSocket = () => {
      if (wsRef.current) {
        wsRef.current.close();
      }

      const newWs = new WebSocket(config.wsUrl);
      wsRef.current = newWs;
      setWs(newWs);

      newWs.onopen = () => {
        console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [WS] WebSocket opened for ${username} at ${new Date().toISOString()}`);
        isWsReady.current = true;
        const registerMessage = {
          type: "register",
          userId,
          username,
          userType,
          logId: parseInt(logId, 10),
        };
        newWs.send(JSON.stringify(registerMessage));
        console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [WS] Sent registration for ${userType} ${username}`);

        // Process queued messages
        while (messageQueue.current.length > 0) {
          const { agentUsername, messageText, resolve } = messageQueue.current.shift();
          sendMessage(agentUsername, messageText, resolve);
        }
      };

      newWs.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [WS] Received message:`, data);

        if (data.type === "userList") {
          setSupervisors(data.supervisors || []);
          console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [WS] Updated supervisors list:`, data.supervisors);
          return;
        }

        if (data.type === "chat") {
          if (userType === "Agent" && data.to === username) {
            setChatSessions((prev) => {
              const existingSession = prev["all"] || { messages: [], minimized: false };
              const updatedSession = {
                ...prev,
                ["all"]: {
                  ...existingSession,
                  messages: [
                    ...existingSession.messages,
                    { from: data.from, text: data.text, timestamp: data.timestamp },
                  ],
                },
              };
              localStorage.setItem("chatSessions", JSON.stringify(updatedSession));
              return updatedSession;
            });
          } else if ((userType === "Team Leader" || userType === "Super Admin") && data.fromType === "Agent") {
            setChatSessions((prev) => {
              const existingSession = prev[data.from] || { messages: [], minimized: false };
              const updatedSession = {
                ...prev,
                [data.from]: {
                  ...existingSession,
                  messages: [
                    ...existingSession.messages,
                    { from: data.from, text: data.text, timestamp: data.timestamp },
                  ],
                },
              };
              localStorage.setItem("chatSessions", JSON.stringify(updatedSession));
              return updatedSession;
            });
          }
        } else if (data.type === "chatAck") {
          console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [WS] Received chat acknowledgment:`, data.message);
        } else if (data.type === "chatClosed") {
          const { agentUsername } = data;
          setChatSessions((prev) => {
            const newSessions = { ...prev };
            if (newSessions[agentUsername]) {
              delete newSessions[agentUsername];
              console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [WS] Chat session closed for ${agentUsername}`);
              localStorage.setItem("chatSessions", JSON.stringify(newSessions));
            }
            return newSessions;
          });
        }
      };

      newWs.onclose = () => {
        console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [WS] WebSocket disconnected for ${username} at ${new Date().toISOString()}. Attempting to reconnect...`);
        isWsReady.current = false;
        setWs(null);
        wsRef.current = null;
        setTimeout(initializeWebSocket, 2000);
      };

      newWs.onerror = (error) => {
        console.error(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [WS] WebSocket error for ${username}:`, error);
      };
    };

    initializeWebSocket();

    return () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    };
  }, [username, userType, userId, logId, isLoggedIn, navigate]);

  const sendMessage = (agentUsername, messageText, resolve = () => {}, maxAttempts = 3, attempt = 1) => {
    if (!messageText.trim()) {
      console.warn(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [WS] Cannot send empty message to ${agentUsername}`);
      resolve(false);
      return;
    }

    if (!ws || !isWsReady.current) {
      console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [WS] WebSocket not ready, queuing message to ${agentUsername}:`, messageText);
      messageQueue.current.push({ agentUsername, messageText, resolve });
      return;
    }

    if (ws.readyState !== WebSocket.OPEN) {
      if (attempt < maxAttempts) {
        console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [WS] WebSocket not open (Attempt ${attempt}/${maxAttempts}), retrying in ${1000 * attempt}ms...`);
        setTimeout(() => sendMessage(agentUsername, messageText, resolve, maxAttempts, attempt + 1), 1000 * attempt);
        return;
      } else {
        console.error(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [WS] Failed to send message after ${maxAttempts} attempts to ${agentUsername}`);
        resolve(false);
        return;
      }
    }

    const timestamp = new Date().toISOString();
    const message = {
      type: "chat",
      from: username,
      to: agentUsername,
      text: messageText,
      timestamp,
      fromType: userType,
    };
    if (message.to === "all" && userType !== "Agent") {
      console.warn(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [WS] Only agents can broadcast to all. Sending to first supervisor instead.`);
      message.to = supervisors.length > 0 ? supervisors[0] : agentUsername;
    }
    console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [WS] Sending message to ${agentUsername}:`, message);
    ws.send(JSON.stringify(message));

    setChatSessions((prev) => {
      const existingSession = prev[agentUsername] || { messages: [], minimized: false };
      const updatedSessions = {
        ...prev,
        [agentUsername]: {
          ...existingSession,
          messages: [
            ...existingSession.messages,
            { from: "You", text: messageText, timestamp },
          ],
        },
      };
      localStorage.setItem("chatSessions", JSON.stringify(updatedSessions));
      return updatedSessions;
    });
    resolve(true);
  };

  const closeChat = (agentUsername) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "chatClosed", agentUsername }));
    }
    setChatSessions((prev) => {
      const newSessions = { ...prev };
      delete newSessions[agentUsername];
      localStorage.setItem("chatSessions", JSON.stringify(newSessions));
      return newSessions;
    });
  };

  const toggleMinimize = (agentUsername) => {
    setChatSessions((prev) => {
      if (!prev[agentUsername]) return prev;
      const updatedSessions = {
        ...prev,
        [agentUsername]: {
          ...prev[agentUsername],
          minimized: !prev[agentUsername].minimized,
        },
      };
      localStorage.setItem("chatSessions", JSON.stringify(updatedSessions));
      return updatedSessions;
    });
  };

  return (
    <ChatContext.Provider
      value={{
        chatSessions,
        supervisors,
        sendMessage,
        closeChat,
        toggleMinimize,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => useContext(ChatContext);