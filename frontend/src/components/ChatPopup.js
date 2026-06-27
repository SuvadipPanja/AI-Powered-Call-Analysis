/**
 * File: ChatPopup.js
 * Purpose: Component for displaying a chat popup for agent communication.
 * Author: $Panja
 * Creation Date: 2024-12-27
 * Signature Check: Do not modify this code without verifying the signature logic.
 * Updated: 2025-03-28
 */

import React, { useState, useEffect, useRef } from "react";
import { useChat } from "../context/ChatContext";
import { LuX, LuMinimize2, LuMaximize2 } from "../icons";
import config from "../utils/envConfig";
import { Button, Input, UserAvatar } from "./ui";

const ChatPopup = ({ username }) => {
  const { chatSessions, sendMessage, closeChat, toggleMinimize } = useChat();
  const [chatInput, setChatInput] = useState("");
  const [activeAgent, setActiveAgent] = useState("");
  const chatBodyRef = useRef(null);

  const handleSendMessage = (agentUsername) => {
    if (chatInput.trim()) {
      sendMessage(agentUsername, chatInput);
      setChatInput("");
      scrollToBottom(agentUsername);
    }
  };

  const handleChatInputFocus = (agentUsername) => {
    setActiveAgent(agentUsername);
  };

  const scrollToBottom = (agentUsername) => {
    if (chatBodyRef.current && activeAgent === agentUsername) {
      const chatBody = chatBodyRef.current;
      chatBody.scrollTo({
        top: chatBody.scrollHeight,
        behavior: "smooth",
      });
    }
  };

  useEffect(() => {
    if (chatBodyRef.current && chatSessions[activeAgent]) {
      const chatBody = chatBodyRef.current;
      const isNearBottom =
        chatBody.scrollHeight - chatBody.scrollTop - chatBody.clientHeight < 50;
      if (isNearBottom) {
        scrollToBottom(activeAgent);
      }
    }
  }, [chatSessions, activeAgent]);

  useEffect(() => {
    if (activeAgent && chatSessions[activeAgent] && !chatSessions[activeAgent].minimized) {
      scrollToBottom(activeAgent);
    }
  }, [activeAgent, chatSessions]);

  return (
    <>
      {Object.entries(chatSessions).map(([agentUsername, session], idx) => (
        session && (
          <div
            key={agentUsername}
            className={`ui-chat-popup ${session.minimized ? "minimized" : ""}`}
            style={{ right: `${100 + idx * 340}px` }}
          >
            <div className="ui-chat-popup__head">
              <span className="ui-chat-popup__head-user">
                <UserAvatar username={agentUsername} size="sm" alt="" />
                <h3>Chat with {agentUsername}</h3>
              </span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {session.minimized ? (
                  <button
                    className="ui-chat-popup__close"
                    onClick={() => toggleMinimize(agentUsername)}
                    aria-label="Maximize chat"
                  >
                    <LuMaximize2 />
                  </button>
                ) : (
                  <button
                    className="ui-chat-popup__close"
                    onClick={() => toggleMinimize(agentUsername)}
                    aria-label="Minimize chat"
                  >
                    <LuMinimize2 />
                  </button>
                )}
                <button
                  className="ui-chat-popup__close"
                  onClick={() => closeChat(agentUsername)}
                  aria-label="Close chat"
                >
                  <LuX />
                </button>
              </div>
            </div>
            {!session.minimized && (
              <>
                <div
                  className="ui-chat-popup__body"
                  ref={activeAgent === agentUsername ? chatBodyRef : null}
                  style={{ maxHeight: 300 }}
                >
                  {session.messages.map((msg, idx) => (
                    <div key={idx} className="ui-chat-popup__msg">
                      <strong>{msg.from}:</strong> {msg.text}
                      <time>{new Date(msg.timestamp).toLocaleTimeString()}</time>
                    </div>
                  ))}
                </div>
                <div style={{
                  display: "flex",
                  gap: "var(--space-2)",
                  padding: "var(--space-3)",
                  borderTop: "1px solid var(--border)",
                  background: "var(--surface)",
                }}>
                  <Input
                    value={activeAgent === agentUsername ? chatInput : ""}
                    onChange={(e) => setChatInput(e.target.value)}
                    onFocus={() => handleChatInputFocus(agentUsername)}
                    onKeyPress={(e) => {
                      if (e.key === "Enter") {
                        handleSendMessage(agentUsername);
                      }
                    }}
                    placeholder="Type a message..."
                    style={{ flex: 1 }}
                  />
                  <Button size="sm" onClick={() => handleSendMessage(agentUsername)}>
                    Send
                  </Button>
                </div>
              </>
            )}
          </div>
        )
      ))}
    </>
  );
};

export default ChatPopup;
