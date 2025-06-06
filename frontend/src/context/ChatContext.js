/**
 * File: ChatContext.js
 * Purpose: Provides a context for managing chat sessions and WebSocket communication in the application.
 * Author: $Panja
 * Creation Date: 2025-03-27
 * Modified Date: 2025-03-27
 * Changes:
 *  - Migrated WebSocket URL to use environment variable from envConfig.
 *  - Updated to use config.wsUrl directly after adding REACT_APP_WS_URL to envConfig.
 *  - Fixed import path for envConfig to resolve Module not found error.
 */

import { createContext, useContext, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import config from "../utils/envConfig"; // Fixed path: navigate up to src/ then into utils/

const ChatContext = createContext();

export const ChatProvider = ({ children }) => {
  // Initialize chatSessions from localStorage or as an empty object
  const [chatSessions, setChatSessions] = useState(() => {
    return JSON.parse(localStorage.getItem("chatSessions")) || {};
  });

  const [ws, setWs] = useState(null);
  const [username, setUsername] = useState(localStorage.getItem("username") || "");
  const [userType, setUserType] = useState(localStorage.getItem("userType") || "");

  // Establish WebSocket connection and handle messages
  useEffect(() => {
    const websocket = new WebSocket(config.wsUrl);
    setWs(websocket);

    // On WebSocket open, register the client
    websocket.onopen = () => {
      websocket.send(
        JSON.stringify({
          type: "register",
          username: username,
          userType: userType,
          logId: localStorage.getItem("logId") || "",
        })
      );
      console.log(`[WS] Registered ${userType} ${username}`);
    };

    // Handle incoming WebSocket messages
    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);

      // Handle incoming chat messages from Agent to Team Leader/Super Admin
      if (data.type === "chat" && data.fromType === "Agent") {
        // If I'm a Supervisor or Super Admin, display the agent's message
        if (userType === "Team Leader" || userType === "Super Admin") {
          // If the message is broadcast (to: "all")
          if (data.to === "all") {
            setChatSessions((prev) => {
              const existingSession = prev[data.from] || {
                messages: [],
                minimized: false,
              };
              const updatedSession = {
                ...prev,
                [data.from]: {
                  ...existingSession,
                  messages: [
                    ...existingSession.messages,
                    {
                      from: data.from,
                      text: data.text,
                      timestamp: data.timestamp,
                    },
                  ],
                },
              };
              localStorage.setItem("chatSessions", JSON.stringify(updatedSession));
              return updatedSession;
            });
          }
        }
      }
      // Handle replies from Team Leader/Super Admin to Agent
      else if (
        data.type === "chat" &&
        (data.fromType === "Team Leader" || data.fromType === "Super Admin")
      ) {
        // If I'm an Agent, and the message is specifically addressed to me
        if (userType === "Agent" && data.to === username) {
          setChatSessions((prev) => {
            const existingSession = prev["all"] || {
              messages: [],
              minimized: false,
            };
            const updatedSession = {
              ...prev,
              ["all"]: {
                ...existingSession,
                messages: [
                  ...existingSession.messages,
                  {
                    from: data.from,
                    text: data.text,
                    timestamp: data.timestamp,
                  },
                ],
              },
            };
            localStorage.setItem("chatSessions", JSON.stringify(updatedSession));
            return updatedSession;
          });
        }
      }
      // Handle chat closure event from Agent
      else if (data.type === "chatClosed") {
        const { agentUsername } = data;
        // Remove that agent's chat session from the supervisor
        setChatSessions((prev) => {
          const newSessions = { ...prev };
          if (newSessions[agentUsername]) {
            delete newSessions[agentUsername];
            console.log(`Chat session closed for ${agentUsername}`);
            localStorage.setItem("chatSessions", JSON.stringify(newSessions));
          }
          return newSessions;
        });
      }
    };

    // Log WebSocket disconnection
    websocket.onclose = () => {
      console.log("[WS] WebSocket disconnected");
    };

    // Cleanup WebSocket on component unmount
    return () => {
      websocket.close();
    };
  }, [username, userType]);

  // Function to send a message via WebSocket
  const sendMessage = (agentUsername, messageText) => {
    if (messageText.trim() && ws && agentUsername) {
      const timestamp = new Date().toISOString();
      const message = {
        type: "chat",
        from: username,
        to: agentUsername,
        text: messageText,
        timestamp,
        fromType: userType,
      };
      ws.send(JSON.stringify(message));

      // Update sender's chat session with their own message
      setChatSessions((prev) => {
        const existingSession = prev[agentUsername] || {
          messages: [],
          minimized: false,
        };
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
    }
  };

  // Function to close a chat session
  const closeChat = (agentUsername) => {
    if (ws) {
      ws.send(
        JSON.stringify({
          type: "chatClosed",
          agentUsername,
        })
      );
    }
    setChatSessions((prev) => {
      const newSessions = { ...prev };
      delete newSessions[agentUsername];
      localStorage.setItem("chatSessions", JSON.stringify(newSessions));
      return newSessions;
    });
  };

  // Function to toggle minimization of a chat session
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