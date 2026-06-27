/**
 * File: ChatBox.js
 * Purpose: Chat interface for agents with categorized knowledge base options, providing a floating chat icon, terms acceptance, and options to chat with a supervisor, AI, or view knowledge entries.
 * Author: $Panja
 * Creation Date: 2025-03-27
 * Modified Date: 2025-06-08
 * Changes:
 *  - Updated to fetch from RevaKnowledgeBase and display Question as options.
 *  - Added scrolling for options menu, showing 5 options by default.
 *  - Display Answer with option-specific text when an option is clicked, removed ModifiedAt display.
 *  - Fixed TypeError by ensuring knowledgeEntries is always an array.
 *  - Added debug logging to diagnose missing options issue.
 *  - Fixed options display to ensure RevaKnowledgeBase entries are shown.
 *  - Updated answer format to "[Option Name] is [Answer]."
 *  - Changed API endpoint to /api/reva-knowledge-options.
 *  - Categorized options into groups (e.g., Loan Products) with a submenu for each category.
 *  - Added "Back to Previous Menu" option alongside "Back to Main Menu" after selecting a product.
 *  - Renamed "Back to Categories" to "Back to Main Menu" and moved it to the bottom of the subcategory menu.
 *  - Fixed missing semicolon on line 129 to resolve SyntaxError.
 *  - Enhanced handleChatWithSupervisor with WebSocket readiness check and retry logic.
 */

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useChat } from "../../context/ChatContext";
import chatbotImg from "../../assets/myChatbotimage.jpg";
import config from "../../utils/envConfig";
import "./ChatBox.css";
import axios from "axios";

const ChatBox = ({ username, onClose }) => {
  const { sendMessage } = useChat();

  // State variables
  const [showChatbot, setShowChatbot] = useState(false);
  const [showWelcomeSection, setShowWelcomeSection] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showTermsPrompt, setShowTermsPrompt] = useState(false);
  const [showAIChat, setShowAIChat] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [aiMessages, setAIMessages] = useState([]);
  const [userMessage, setUserMessage] = useState("");
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [isAITyping, setIsAITyping] = useState(false);
  const [logId] = useState(localStorage.getItem("logId") || "");
  const [aiChatLogId, setAIChatLogId] = useState(null);
  const [aiChatContent, setAIChatContent] = useState("");
  const [categories, setCategories] = useState({});
  const [selectedCategory, setSelectedCategory] = useState(null);

  const chatBodyRef = useRef(null);
  const optionsRef = useRef(null);

  // Auto-scroll function for chat messages
  const scrollToBottom = () => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTo({
        top: chatBodyRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [aiMessages, isAITyping]);

  // Fetch knowledge entries from RevaKnowledgeBase on mount
  useEffect(() => {
    const fetchKnowledgeEntries = async () => {
      try {
        const response = await axios.get(`${config.apiBaseUrl}/api/reva-knowledge-options`);
        if (response.data.success && response.data.categories) {
          setCategories(response.data.categories);
        } else {
          console.error("[Frontend] Failed to fetch knowledge entries:", response.data.message);
          setCategories({});
        }
      } catch (error) {
        console.error("[Frontend] Error fetching knowledge entries:", error);
        setCategories({});
      }
    };
    fetchKnowledgeEntries();
  }, []);

  // AI Chat Logging Functions
  const startAIChatLog = async () => {
    try {
      const response = await axios.post(`${config.apiBaseUrl}/api/start-ai-chat`, {
        username: username,
        entireChat: "",
        startTime: new Date().toISOString(),
        isClosed: false,
      });
      if (response.data.success) {
        setAIChatLogId(response.data.logId);
        console.log(`[Frontend] AI chat log started with LogID: ${response.data.logId}`);
      }
    } catch (error) {
      console.error("[Frontend] Error starting AI chat log:", error);
    }
  };

  const updateAIChatLog = async (entireChat) => {
    if (!aiChatLogId) return;
    try {
      await axios.post(`${config.apiBaseUrl}/api/update-ai-chat`, {
        logId: aiChatLogId,
        entireChat: entireChat,
      });
      console.log(`[Frontend] AI chat log updated for LogID: ${aiChatLogId}`);
    } catch (error) {
      console.error("[Frontend] Error updating AI chat log:", error);
    }
  };

  const closeAIChatLog = async () => {
    if (!aiChatLogId) return;
    try {
      await axios.post(`${config.apiBaseUrl}/api/close-ai-chat`, {
        logId: aiChatLogId,
        entireChat: aiChatContent,
        endTime: new Date().toISOString(),
        isClosed: true,
      });
      console.log(`[Frontend] AI chat log closed for LogID: ${aiChatLogId}`);
      setAIChatLogId(null);
      setAIChatContent("");
    } catch (error) {
      console.error("[Frontend] Error closing AI chat log:", error);
    }
  };

  // Log knowledge option selection to the database
  const logKnowledgeOption = async (option) => {
    try {
      await axios.post(`${config.apiBaseUrl}/api/log-banking-option`, {
        username,
        option,
        timestamp: new Date().toISOString(),
      });
      console.log(`[Frontend] Logged knowledge option: ${option}`);
    } catch (error) {
      console.error("[Frontend] Error logging knowledge option:", error);
    }
  };

  // Handle Close
  const handleClose = () => {
    sendMessage(username, "", () => {}); // Trigger close via WebSocket with callback
    closeAIChatLog();
    setShowChatbot(false);
    setShowWelcomeSection(false);
    setShowTermsPrompt(false);
    setShowAIChat(false);
    setShowOptions(false);
    setAIMessages([]);
    setFailedAttempts(0);
    setIsAITyping(false);
    setSelectedCategory(null);
    if (onClose) onClose();
  };

  // AI Chat Handlers
  const handleChatWithAI = () => {
    setShowAIChat(true);
    setShowWelcomeSection(false);
    setShowOptions(false);
    setFailedAttempts(0);
    setSelectedCategory(null);
    setAIMessages([
      { sender: "AI", text: "Hello! How can I assist you today?", timestamp: new Date().toISOString() },
    ]);
    startAIChatLog();
  };

  const handleSendAIMessage = async () => {
    if (!userMessage.trim()) return;
    const newUserMessage = {
      sender: "You",
      text: userMessage,
      timestamp: new Date().toISOString(),
    };
    setAIMessages((prev) => [...prev, newUserMessage]);
    const updatedChatContent = `${aiChatContent}[${new Date(newUserMessage.timestamp).toLocaleString()}] You: ${newUserMessage.text}\n`;
    setAIChatContent(updatedChatContent);
    await updateAIChatLog(updatedChatContent);
    setIsAITyping(true);
    setUserMessage("");

    try {
      const response = await axios.post(`${config.apiBaseUrl}/api/chat-with-ai`, {
        message: newUserMessage.text,
      });
      setIsAITyping(false);
      if (response.data.success) {
        const aiResponse = {
          sender: "AI",
          text: response.data.response,
          timestamp: new Date().toISOString(),
        };
        setAIMessages((prev) => [...prev, aiResponse]);
        const updatedChatContentWithAI = `${aiChatContent}[${new Date(aiResponse.timestamp).toLocaleString()}] AI: ${aiResponse.text}\n`;
        setAIChatContent(updatedChatContentWithAI);
        await updateAIChatLog(updatedChatContentWithAI);
        if (response.data.escalate) {
          setFailedAttempts((prev) => prev + 1);
          if (failedAttempts + 1 >= 3) {
            const escalationMessage = {
              sender: "AI",
              text: "I've had difficulty understanding your request. I'll escalate this to a supervisor. Please wait.",
              timestamp: new Date().toISOString(),
            };
            setAIMessages((prev) => [...prev, escalationMessage]);
            const updatedChatContentWithEscalation = `${aiChatContent}[${new Date(escalationMessage.timestamp).toLocaleString()}] AI: ${escalationMessage.text}\n`;
            setAIChatContent(updatedChatContentWithEscalation);
            await updateAIChatLog(updatedChatContentWithEscalation);
            handleChatWithSupervisor();
            setFailedAttempts(0);
          }
        } else {
          setFailedAttempts(0);
        }
      } else {
        const errorMessage = {
          sender: "AI",
          text: response.data.message || "Sorry, I encountered an error. Please try again.",
          timestamp: new Date().toISOString(),
        };
        setAIMessages((prev) => [...prev, errorMessage]);
        const updatedChatContentWithError = `${aiChatContent}[${new Date(errorMessage.timestamp).toLocaleString()}] AI: ${errorMessage.text}\n`;
        setAIChatContent(updatedChatContentWithError);
        await updateAIChatLog(updatedChatContentWithError);
      }
    } catch (error) {
      setIsAITyping(false);
      const errorMessage = {
        sender: "AI",
        text: error.response?.data?.message || "Sorry, I encountered an error. Please try again.",
        timestamp: new Date().toISOString(),
      };
      setAIMessages((prev) => [...prev, errorMessage]);
      const updatedChatContentWithError = `${aiChatContent}[${new Date(errorMessage.timestamp).toLocaleString()}] AI: ${errorMessage.text}\n`;
      setAIChatContent(updatedChatContentWithError);
      await updateAIChatLog(updatedChatContentWithError);
    }
  };

  // Buttons & Logic
  const handleChatbotClick = () => {
    setShowChatbot(true);
    setShowWelcomeSection(false);
    setTermsAccepted(false);
    setShowAIChat(false);
    setShowOptions(false);
    setSelectedCategory(null);
  };

  const handleChatWithSupervisor = () => {
    setShowWelcomeSection(false);
    setShowChatbot(false);
    setShowAIChat(false);
    setShowOptions(false);
    setSelectedCategory(null);
    closeAIChatLog();
    const initialMessage = "Hello, I need assistance.";
    console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [Frontend] Attempting to send chat message to 'all' from ${username}: ${initialMessage}`);
    sendMessage("all", initialMessage, (success) => {
      if (success) {
        console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [Frontend] Message sent successfully to 'all'`);
      } else {
        console.error(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [Frontend] Failed to send message to 'all' after retries`);
      }
    });
    console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] Chat with Supervisor started.`);
  };

  const handleGetStarted = () => {
    if (termsAccepted) {
      setShowChatbot(false);
      setShowOptions(true);
    }
  };

  const handleTermsClick = (e) => {
    e.preventDefault();
    setShowTermsPrompt(true);
  };

  const handleCloseTermsPrompt = () => {
    setShowTermsPrompt(false);
  };

  // Handle Knowledge Option Selection
  const handleKnowledgeOption = (entry) => {
    setShowOptions(false);
    setShowAIChat(true);
    const message = {
      sender: "AI",
      text: `${entry.question} is ${entry.answer}.`,
      timestamp: new Date().toISOString(),
    };
    setAIMessages([message]);
    startAIChatLog();
    const chatContent = `[${new Date(message.timestamp).toLocaleString()}] AI: ${message.text}\n`;
    setAIChatContent(chatContent);
    updateAIChatLog(chatContent);
    logKnowledgeOption(entry.question);
  };

  // Handle Category Selection
  const handleCategorySelect = (category) => {
    setSelectedCategory(category);
  };

  // Handle Back to Categories (Main Menu)
  const handleBackToCategories = () => {
    setSelectedCategory(null);
  };

  // Handle Back to Previous Menu (from AI chat to subcategory)
  const handleBackToPreviousMenu = () => {
    setShowAIChat(false);
    setShowOptions(true);
    setAIMessages([]);
    setUserMessage("");
    setIsAITyping(false);
    setFailedAttempts(0);
    // selectedCategory remains unchanged to show the subcategory menu
  };

  // Handle Back to Main Menu
  const handleBackToMainMenu = () => {
    closeAIChatLog();
    setShowAIChat(false);
    setShowOptions(true);
    setAIMessages([]);
    setUserMessage("");
    setIsAITyping(false);
    setFailedAttempts(0);
    setSelectedCategory(null);
  };

  // Click Outside Handler
  useEffect(() => {
    const handleClickOutside = (event) => {
      const chatbotPopup = document.querySelector(".chatbot-popup");
      const welcomeSection = document.querySelector(".welcome-section");
      const termsPrompt = document.querySelector(".terms-prompt");
      const aiChatSection = document.querySelector(".ai-chat-section");
      const optionsSection = document.querySelector(".options-section");

      const clickedOutsideChatbot =
        showChatbot && chatbotPopup && !chatbotPopup.contains(event.target) && !termsPrompt?.contains(event.target);
      const clickedOutsideWelcome =
        showWelcomeSection && welcomeSection && !welcomeSection.contains(event.target) && !termsPrompt?.contains(event.target);
      const clickedOutsideAIChat =
        showAIChat && aiChatSection && !aiChatSection.contains(event.target) && !termsPrompt?.contains(event.target);
      const clickedOutsideOptions =
        showOptions && optionsSection && !optionsSection.contains(event.target) && !termsPrompt?.contains(event.target);

      if (clickedOutsideChatbot || clickedOutsideWelcome || clickedOutsideAIChat || clickedOutsideOptions) {
        handleClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showChatbot, showWelcomeSection, showTermsPrompt, showAIChat, showOptions]);

  const widget = (
    <div className="reva-widget" aria-live="polite">
      {!showChatbot && !showWelcomeSection && !showAIChat && !showOptions && (
        <button
          type="button"
          className="reva-widget__launcher"
          onClick={handleChatbotClick}
          aria-label="Open Reva assistant"
        >
          <img src={chatbotImg} alt="" className="reva-widget__launcher-img" />
        </button>
      )}

      {showChatbot && (
        <div className="chatbot-popup">
          <div className="chatbot-title-bar">
            <div className="window-controls">
              <span className="window-control" onClick={handleClose}>
                ×
              </span>
            </div>
          </div>
          <div className="chatbot-content">
            <div style={{ textAlign: "center", marginBottom: "0.5rem" }}>
              <img src={chatbotImg} alt="Bot Icon" className="chatbot-image" />
            </div>
            <h3 style={{ fontWeight: "bold", margin: "0" }}>Hi</h3>
            <h3 style={{ fontWeight: "bold", margin: "0.2rem 0" }}>I'm Reva</h3>
            <p>Please feel free to ask any questions</p>
            <p style={{ fontSize: "0.8rem", margin: "0.3rem 0 0.8rem 0" }}>
              Your Personal Assistant
            </p>
            <div style={{ marginBottom: "1rem" }}>
              <input
                type="checkbox"
                id="terms"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                style={{ marginRight: "0.5rem" }}
              />
              <label htmlFor="terms" style={{ fontSize: "0.8rem" }}>
                I accept the{" "}
                <span
                  onClick={handleTermsClick}
                  style={{ color: "#007bff", textDecoration: "underline", cursor: "pointer" }}
                >
                  terms & conditions
                </span>
              </label>
            </div>
            <button className="welcome-btn" onClick={handleGetStarted} disabled={!termsAccepted}>
              Get Started
            </button>
          </div>
          {showTermsPrompt && (
            <div className="terms-prompt">
              <h4>Terms & Conditions</h4>
              <p>Please read through our policy carefully. By proceeding, you agree to follow these terms.</p>
              <ul>
                <li>Keep your login credentials confidential.</li>
                <li>Respect data privacy and user confidentiality.</li>
                <li>Comply with your organization's guidelines at all times.</li>
                <li>Do not misuse the chatbot or any integrated AI features.</li>
                <li>Contact admin if you have questions about policy or usage.</li>
              </ul>
              <button className="welcome-btn" onClick={handleCloseTermsPrompt}>
                Close
              </button>
            </div>
          )}
        </div>
      )}

      {showOptions && (
        <div className="options-section welcome-section">
          <div className="chatbot-title-bar">
            <div className="window-controls">
              <span className="window-control" onClick={handleClose}>
                ×
              </span>
            </div>
          </div>
          <div className="chatbot-content">
            <img src={chatbotImg} alt="Chatbot" className="chatbot-image" />
            <h3>Welcome, {username || "User"}!</h3>
            <p>Select an option below:</p>
            <div
              ref={categories && Object.keys(categories).length > 5 ? optionsRef : null}
              style={{
                maxHeight: categories && Object.keys(categories).length > 5 ? "200px" : "auto",
                overflowY: categories && Object.keys(categories).length > 5 ? "auto" : "visible",
                width: "100%",
                marginBottom: "0.5rem",
              }}
            >
              {selectedCategory ? (
                <>
                  {categories[selectedCategory].map((entry, index) => (
                    <button
                      key={index}
                      className="welcome-btn"
                      onClick={() => handleKnowledgeOption(entry)}
                    >
                      {entry.question}
                    </button>
                  ))}
                  <button
                    className="welcome-btn"
                    onClick={handleBackToCategories}
                    style={{ marginTop: "0.5rem" }}
                  >
                    Back to Main Menu
                  </button>
                </>
              ) : (
                <>
                  {categories && Object.keys(categories).length > 0 ? (
                    Object.keys(categories).map((category, index) => (
                      <button
                        key={index}
                        className="welcome-btn"
                        onClick={() => handleCategorySelect(category)}
                      >
                        {category}
                      </button>
                    ))
                  ) : (
                    <p>No knowledge categories available.</p>
                  )}
                </>
              )}
            </div>
            {!selectedCategory && (
              <>
                <button className="chat-special-btn" onClick={handleChatWithSupervisor}>
                  Chat with Supervisor
                </button>
                <button className="chat-special-btn" onClick={handleChatWithAI}>
                  Chat with AI
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {showWelcomeSection && (
        <div className="welcome-section">
          <div className="chatbot-title-bar">
            <div className="window-controls">
              <span className="window-control" onClick={handleClose}>
                ×
              </span>
            </div>
          </div>
          <div className="chatbot-content">
            <img src={chatbotImg} alt="Chatbot" className="chatbot-image" />
            <h3>Welcome, {username || "User"}!</h3>
            <p>How would you like to proceed?</p>
            <button className="chat-special-btn" onClick={handleChatWithSupervisor}>
              Chat with Supervisor
            </button>
            <button className="chat-special-btn" onClick={handleChatWithAI}>
              Chat with AI
            </button>
          </div>
        </div>
      )}

      {showAIChat && (
        <div className="ai-chat-section welcome-section">
          <div className="chatbot-title-bar">
            <div className="window-controls">
              <span className="window-control" onClick={handleClose}>
                ×
              </span>
            </div>
          </div>
          <div className="chatbot-content" style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
            <div style={{ textAlign: "center", marginBottom: "0.5rem" }}>
              <img src={chatbotImg} alt="Chatbot" className="chatbot-image" />
              <h3>Chat with AI</h3>
            </div>
            <div
              ref={chatBodyRef}
              style={{
                flex: 1,
                maxHeight: "300px",
                overflowY: "auto",
                padding: "10px",
                background: "#E0F7FA",
                borderRadius: "8px",
                marginBottom: "1rem",
                position: "relative",
              }}
            >
              {aiMessages.map((msg, idx) => (
                <div
                  key={idx}
                  style={{
                    margin: "8px 0",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    background: msg.sender === "You" ? "#00AEEF" : "#FFFFFF",
                    color: msg.sender === "You" ? "#FFFFFF" : "#000000",
                    textAlign: msg.sender === "You" ? "right" : "left",
                    marginLeft: msg.sender === "You" ? "20%" : "0",
                    marginRight: msg.sender === "You" ? "0" : "20%",
                    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
                  }}
                >
                  <strong>{msg.sender}:</strong> {msg.text}
                  <small style={{ display: "block", fontSize: "0.7rem", marginTop: "4px" }}>
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </small>
                </div>
              ))}
              {isAITyping && (
                <div style={{ margin: "8px 0", textAlign: "right", marginLeft: "20%", marginRight: "0" }}>
                  <div className="typing-dots">
                    <span className="typing-dot"></span>
                    <span className="typing-dot"></span>
                    <span className="typing-dot"></span>
                  </div>
                </div>
              )}
              <div style={{ textAlign: "center", marginTop: "10px", display: "flex", justifyContent: "center", gap: "10px" }}>
                {selectedCategory && (
                  <button
                    className="welcome-btn"
                    onClick={handleBackToPreviousMenu}
                    style={{
                      background: "#FFFFFF",
                      color: "#00AEEF",
                      border: "none",
                      borderRadius: "20px",
                      padding: "8px 16px",
                      fontSize: "0.9rem",
                      cursor: "pointer",
                      transition: "background 0.3s ease",
                    }}
                  >
                    Back to Previous Menu
                  </button>
                )}
                <button
                  className="welcome-btn"
                  onClick={handleBackToMainMenu}
                  style={{
                    background: "#FFFFFF",
                    color: "#00AEEF",
                    border: "none",
                    borderRadius: "20px",
                    padding: "8px 16px",
                    fontSize: "0.9rem",
                    cursor: "pointer",
                    transition: "background 0.3s ease",
                  }}
                >
                  Back to Main Menu
                </button>
              </div>
            </div>
            <div style={{ display: "flex", padding: "10px", background: "#CFEAE5" }}>
              <input
                type="text"
                value={userMessage}
                onChange={(e) => setUserMessage(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && handleSendAIMessage()}
                placeholder="Type a message..."
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  border: "none",
                  borderRadius: "20px",
                  background: "#FFFFFF",
                  color: "#000000",
                  fontSize: "0.9rem",
                  marginRight: "10px",
                }}
              />
              <button
                onClick={handleSendAIMessage}
                style={{
                  background: "#00AEEF",
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: "20px",
                  padding: "8px 16px",
                  fontSize: "0.9rem",
                  cursor: "pointer",
                  transition: "background 0.3s ease",
                }}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return typeof document !== "undefined" ? createPortal(widget, document.body) : widget;
};

export default ChatBox;