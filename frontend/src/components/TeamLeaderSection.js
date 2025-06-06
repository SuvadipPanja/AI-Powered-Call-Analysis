/**
 * Author: $Panja
 * Creation Date: 2025-03-11
 * Updated: 2025-04-22
 * Description: Enhanced Team Leader Section with modern UI matching AfterLogin.js, including consistent colors, button styles, and neumorphic design.
 *              Added security enhancements (input sanitization, WebSocket reconnection, error boundary). Preserves all functionality (team overview,
 *              audit queue, briefing, broadcast, knowledge test, Reva Knowledge) and APIs. Fixed visibility issue by ensuring white backgrounds have black foreground text.
 *              Modified Upload Briefing and Broadcast to be sections instead of modals, with normal button styling by default. Updated Knowledge Test to start with one question,
 *              with an option to add up to 5 questions. Fixed issue where spaces could not be added between sentences in input fields by modifying sanitizeInput.
 * Compliance: IS Policy Standards (Security, Accessibility, Performance, Maintainability, Code Audit)
 * Signature Check: Do not modify this code without verifying the signature logic.
 * Note: This is Part 1 of the code (up to event handlers). Combine with Parts 2 and 3 in WordPad to create the complete file.
 */

import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  FaFileAlt,
  FaUsers,
  FaChartBar,
  FaClipboardCheck,
  FaBook,
  FaPlus,
  FaBroadcastTower,
  FaFilter,
  FaCalendar,
  FaEdit,
  FaTrash,
  FaDatabase,
  FaHome,
} from "react-icons/fa";
import config from "../utils/envConfig";
import "./AfterLogin.css";

// Simple input sanitization function (Security Enhancement)
// Modified to preserve spaces by removing trim()
const sanitizeInput = (input) => {
  if (typeof input !== "string") return input;
  return input.replace(/[<>{}]/g, ""); // Remove dangerous characters but keep spaces
};

// Error Boundary Component (Security Enhancement)
class ErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-message" role="alert">
          Something went wrong. Please refresh the page.
        </div>
      );
    }
    return this.props.children;
  }
}

const TeamLeaderSection = ({ username }) => {
  /*************************************************
   * (1) Code Integrity Check
   *************************************************/
  const signature = "$Panja";
  const verifySignature = (sig) => {
    if (sig !== "$Panja") {
      throw new Error("Signature mismatch: Code integrity compromised.");
    }
  };
  verifySignature(signature);

  /*************************************************
   * (2) State Variables
   *************************************************/
  const navigate = useNavigate();
  const [briefingContent, setBriefingContent] = useState("");
  const [briefingMessage, setBriefingMessage] = useState("");
  const [teamStats, setTeamStats] = useState(null);
  const [agents, setAgents] = useState([]);
  const [auditQueue, setAuditQueue] = useState([]);
  const [questions, setQuestions] = useState([
    {
      question: "",
      options: ["", "", "", ""],
      correctAnswer: "",
    },
  ]); // Start with 1 question by default
  const [knowledgeMessage, setKnowledgeMessage] = useState("");
  const [broadcastContent, setBroadcastContent] = useState("");
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [ws, setWs] = useState(null);
  const [filterAgent, setFilterAgent] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [activeTab, setActiveTab] = useState("teamOverview");
  const [knowledgeCategories, setKnowledgeCategories] = useState({});
  const [showAddKnowledgeForm, setShowAddKnowledgeForm] = useState(false);
  const [showUpdateKnowledgeForm, setShowUpdateKnowledgeForm] = useState(false);
  const [selectedKnowledge, setSelectedKnowledge] = useState(null);
  const [newKnowledge, setNewKnowledge] = useState({ question: "", answer: "", category: "" });
  const [knowledgeBaseMessage, setKnowledgeBaseMessage] = useState("");
  const [activeKnowledgeTab, setActiveKnowledgeTab] = useState("Loan Products");
  const [wsReconnectAttempts, setWsReconnectAttempts] = useState(0);

  const revaKnowledgeTabs = [
    "Loan Products",
    "Account related Service",
    "Current Offer",
    "Others",
  ];

  /*************************************************
   * (3) WebSocket Setup with Reconnection
   *************************************************/
  const setupWebSocket = useCallback(() => {
    const websocket = new WebSocket(config.wsUrl);
    setWs(websocket);

    websocket.onopen = () => {
      console.log("[WS] Connected at", new Date().toISOString());
      websocket.send(
        JSON.stringify({
          type: "register",
          username: sanitizeInput(username),
          userType: "Team Leader",
          logId: localStorage.getItem("logId") || "",
        })
      );
      setWsReconnectAttempts(0);
    };

    websocket.onclose = () => {
      console.log("[WS] Disconnected at", new Date().toISOString());
      if (wsReconnectAttempts < 3) {
        setTimeout(() => {
          console.log("[WS] Reconnecting attempt", wsReconnectAttempts + 1);
          setWsReconnectAttempts((prev) => prev + 1);
          setupWebSocket();
        }, 3000);
      }
    };

    websocket.onerror = (err) => {
      console.error("[WS] Error:", err);
    };

    return () => websocket.close();
  }, [username, wsReconnectAttempts]);

  useEffect(() => {
    const cleanup = setupWebSocket();
    return cleanup;
  }, [setupWebSocket]);

  /*************************************************
   * (4) Fetch Data with Logging
   *************************************************/
  useEffect(() => {
    console.log("[API] Fetching data at", new Date().toISOString());
    fetchTeamData();
    fetchAuditQueue();
    fetchKnowledgeEntries();
  }, [username, filterAgent, fromDate, toDate]);

  const fetchTeamData = async () => {
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/team-agents/${sanitizeInput(username)}`);
      const agentsData = await response.json();
      
      if (agentsData.success && agentsData.agents) {
        setAgents(agentsData.agents);

        const totalCalls = agentsData.agents.reduce((sum, agent) => sum + (agent.calls || 0), 0);
        const avgAIScore = agentsData.agents.length
          ? (agentsData.agents.reduce((sum, agent) => sum + (agent.avgScore || 0), 0) / agentsData.agents.length).toFixed(1)
          : 0;
        const avgAHT = agentsData.agents.length
          ? (agentsData.agents.reduce((sum, agent) => sum + (agent.aht || 0), 0) / agentsData.agents.length).toFixed(1)
          : 0;
        const avgSentiment = agentsData.agents.length
          ? (agentsData.agents.some(agent => agent.avgScore < 80) ? "Mixed" : "Positive")
          : "N/A";

        setTeamStats({
          avgAIScore,
          totalCalls,
          avgAHT,
          avgSentiment,
          period: "Last 7 Days",
        });
      } else {
        setAgents([]);
        setTeamStats({
          avgAIScore: 0,
          totalCalls: 0,
          avgAHT: 0,
          avgSentiment: "N/A",
          period: "Last 7 Days",
        });
      }
    } catch (err) {
      console.error("[API] Error fetching team data:", err.message);
      setAgents([]);
      setTeamStats({
        avgAIScore: 0,
        totalCalls: 0,
        avgAHT: 0,
        avgSentiment: "N/A",
        period: "Last 7 Days",
      });
    }
  };

  const fetchAuditQueue = async () => {
    try {
      const url = `${config.apiBaseUrl}/api/audit-queue/${sanitizeInput(username)}${
        (filterAgent || fromDate || toDate)
          ? `?${filterAgent ? `agentName=${encodeURIComponent(sanitizeInput(filterAgent))}` : ''}${
              fromDate ? `${filterAgent ? '&' : ''}fromDate=${sanitizeInput(fromDate)}` : ''
            }${toDate ? `${(filterAgent || fromDate) ? '&' : ''}toDate=${sanitizeInput(toDate)}` : ''}`
          : ''
      }`;
      const response = await fetch(url);
      const data = await response.json();
      if (data.success && data.auditQueue) {
        setAuditQueue(data.auditQueue);
      } else {
        setAuditQueue([]);
      }
    } catch (err) {
      console.error("[API] Error fetching audit queue:", err.message);
      setAuditQueue([]);
    }
  };

  const fetchKnowledgeEntries = async () => {
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/reva-knowledge`);
      const data = await response.json();
      if (data.success && data.categories) {
        setKnowledgeCategories(data.categories);
      } else {
        setKnowledgeCategories({});
      }
    } catch (err) {
      console.error("[API] Error fetching Reva Knowledge entries:", err.message);
      setKnowledgeCategories({});
    }
  };

  /*************************************************
   * (5) Handle Briefing Submission
   *************************************************/
  const handleSubmitBriefing = async () => {
    const sanitizedContent = sanitizeInput(briefingContent).trim(); // Apply trim() here before submission
    if (!sanitizedContent) {
      setBriefingMessage("Failure: Briefing content cannot be empty.");
      return;
    }
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/upload-briefing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: sanitizeInput(username), content: sanitizedContent }),
      });
      const result = await response.json();
      if (result.success) {
        setBriefingMessage("Success: Briefing uploaded successfully!");
        setBriefingContent("");
      } else {
        setBriefingMessage(`Failure: ${result.message || "Unable to upload briefing."}`);
      }
    } catch (err) {
      setBriefingMessage(`Failure: Error uploading briefing - ${err.message}`);
      console.error("[API] Briefing upload error:", err.message);
    }
  };

  /*************************************************
   * (6) Handle Knowledge Test Submission
   *************************************************/
  const handleSubmitKnowledgeTest = async () => {
    const sanitizedQuestions = questions.map(q => ({
      question: sanitizeInput(q.question).trim(), // Apply trim() here
      options: q.options.map(opt => sanitizeInput(opt).trim()), // Apply trim() to each option
      correctAnswer: sanitizeInput(q.correctAnswer).trim(), // Apply trim() here
    }));
    const invalidQuestion = sanitizedQuestions.some(
      (q) => !q.question || q.options.some((opt) => !opt) || !q.correctAnswer
    );
    if (invalidQuestion) {
      setKnowledgeMessage("Failure: All fields are required for each question.");
      return;
    }
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/upload-knowledge-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: sanitizeInput(username),
          questions: sanitizedQuestions,
          createdAt: new Date().toISOString(),
        }),
      });
      const result = await response.json();
      if (result.success) {
        setKnowledgeMessage("Success: Knowledge Test questions uploaded successfully!");
        setQuestions([
          {
            question: "",
            options: ["", "", "", ""],
            correctAnswer: "",
          },
        ]); // Reset to 1 question after submission
        setActiveTab("teamOverview");
      } else {
        setKnowledgeMessage(`Failure: ${result.message || "Unable to upload questions."}`);
      }
    } catch (err) {
      setKnowledgeMessage(`Failure: Error uploading questions - ${err.message}`);
      console.error("[API] Knowledge Test upload error:", err.message);
    }
  };

  const handleQuestionChange = (index, field, value, optionIndex = null) => {
    const newQuestions = [...questions];
    const sanitizedValue = sanitizeInput(value); // No trim() here to preserve spaces
    if (field === "question") {
      newQuestions[index].question = sanitizedValue;
    } else if (field === "correctAnswer") {
      newQuestions[index].correctAnswer = sanitizedValue;
    } else if (field === "option" && optionIndex !== null) {
      newQuestions[index].options[optionIndex] = sanitizedValue;
    }
    setQuestions(newQuestions);
  };

  const handleAddQuestion = () => {
    if (questions.length < 5) {
      setQuestions([
        ...questions,
        {
          question: "",
          options: ["", "", "", ""],
          correctAnswer: "",
        },
      ]);
    }
  };

  const handleCancelKnowledgeTest = () => {
    setQuestions([
      {
        question: "",
        options: ["", "", "", ""],
        correctAnswer: "",
      },
    ]);
    setKnowledgeMessage("");
    setActiveTab("teamOverview");
  };

  /*************************************************
   * (7) Handle Broadcast Submission
   *************************************************/
  const handleSubmitBroadcast = () => {
    const sanitizedContent = sanitizeInput(broadcastContent).trim(); // Apply trim() here
    if (!sanitizedContent) {
      setBroadcastMessage("Failure: Broadcast message cannot be empty.");
      return;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      const timestamp = new Date().toISOString();
      const message = {
        type: "chat",
        from: sanitizeInput(username),
        fromType: "Team Leader",
        to: "all",
        text: sanitizedContent,
        timestamp,
      };
      ws.send(JSON.stringify(message));
      setBroadcastMessage("Success: Broadcast message sent successfully!");
      setBroadcastContent("");
    } else {
      setBroadcastMessage("Failure: Unable to connect to WebSocket server.");
    }
  };

  /*************************************************
   * (8) Handle Reva Knowledge Operations
   *************************************************/
  const handleAddKnowledge = async () => {
    const sanitizedKnowledge = {
      question: sanitizeInput(newKnowledge.question).trim(), // Apply trim() here
      answer: sanitizeInput(newKnowledge.answer).trim(), // Apply trim() here
      category: sanitizeInput(newKnowledge.category).trim(), // Apply trim() here
    };
    if (!sanitizedKnowledge.question || !sanitizedKnowledge.answer || !sanitizedKnowledge.category) {
      setKnowledgeBaseMessage("Failure: Question, Answer, and Category are required.");
      return;
    }
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/reva-knowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...sanitizedKnowledge,
          username: sanitizeInput(username),
        }),
      });
      const result = await response.json();
      if (result.success) {
        setKnowledgeBaseMessage("Success: Knowledge entry added successfully!");
        setNewKnowledge({ question: "", answer: "", category: "" });
        setShowAddKnowledgeForm(false);
        fetchKnowledgeEntries();
      } else {
        setKnowledgeBaseMessage(`Failure: ${result.message || "Unable to add knowledge entry."}`);
      }
    } catch (err) {
      setKnowledgeBaseMessage(`Failure: Error adding knowledge entry - ${err.message}`);
      console.error("[API] Knowledge entry add error:", err.message);
    }
  };

  const handleUpdateKnowledge = async () => {
    const sanitizedKnowledge = {
      Question: sanitizeInput(selectedKnowledge.Question).trim(), // Apply trim() here
      Answer: sanitizeInput(selectedKnowledge.Answer).trim(), // Apply trim() here
      Category: sanitizeInput(selectedKnowledge.Category).trim(), // Apply trim() here
    };
    if (!sanitizedKnowledge.Question || !sanitizedKnowledge.Answer || !sanitizedKnowledge.Category) {
      setKnowledgeBaseMessage("Failure: Question, Answer, and Category are required.");
      return;
    }
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/reva-knowledge/${selectedKnowledge.ID}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...sanitizedKnowledge,
          username: sanitizeInput(username),
        }),
      });
      const result = await response.json();
      if (result.success) {
        setKnowledgeBaseMessage("Success: Knowledge entry updated successfully!");
        setShowUpdateKnowledgeForm(false);
        setSelectedKnowledge(null);
        fetchKnowledgeEntries();
      } else {
        setKnowledgeBaseMessage(`Failure: ${result.message || "Unable to update knowledge entry."}`);
      }
    } catch (err) {
      setKnowledgeBaseMessage(`Failure: Error updating knowledge entry - ${err.message}`);
      console.error("[API] Knowledge entry update error:", err.message);
    }
  };

  const handleDeleteKnowledge = async (id) => {
    if (!window.confirm("Are you sure you want to delete this knowledge entry?")) return;
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/reva-knowledge/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      const result = await response.json();
      if (result.success) {
        setKnowledgeBaseMessage("Success: Knowledge entry deleted successfully!");
        fetchKnowledgeEntries();
      } else {
        setKnowledgeBaseMessage(`Failure: ${result.message || "Unable to delete knowledge entry."}`);
      }
    } catch (err) {
      setKnowledgeBaseMessage(`Failure: Error deleting knowledge entry - ${err.message}`);
      console.error("[API] Knowledge entry delete error:", err.message);
    }
  };

  const handleNewKnowledgeChange = (field, value) => {
    setNewKnowledge((prev) => ({ ...prev, [field]: sanitizeInput(value) })); // No trim() here
  };

  const handleSelectedKnowledgeChange = (field, value) => {
    setSelectedKnowledge((prev) => ({ ...prev, [field]: sanitizeInput(value) })); // No trim() here
  };

  const handleNavigation = (path) => {
    console.log(`[NAV] Navigating to ${path} at ${new Date().toISOString()}`);
    navigate(path);
  };

  /*************************************************
   * (9) Render - Part 2 (Up to Upload Knowledge Test Section)
   *************************************************/
  return (
    <ErrorBoundary>
      <div
        className="dark-container modern-page-animation"
        style={{
          minHeight: "100vh",
          background: "linear-gradient(135deg, #1a1a1a 0%, #222831 100%)",
          padding: "2rem 1.5rem",
        }}
        role="main"
        aria-label="Team Leader Section"
      >
        {/* Top Navigation Bar */}
        <nav
          className="improved-navbar"
          style={{
            background: "linear-gradient(90deg, #393e46 0%, #2e333b 100%)",
            borderRadius: "12px",
            padding: "0.8rem 1.5rem",
            marginBottom: "1.5rem",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
          aria-label="Top Navigation"
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "1rem",
              color: "#EEEEEE",
              fontWeight: 600,
              fontSize: "1.2rem",
            }}
            role="heading"
            aria-level="1"
          >
            <FaUsers style={{ color: "#00ADB5" }} />
            Team Leader: {sanitizeInput(username)}
          </div>
          <ul className="nav-links" style={{ display: "flex", gap: "1.2rem", margin: 0 }}>
            <li>
              <button
                className={`dark-button ${activeTab === "teamOverview" ? "active-tab" : ""}`}
                onClick={() => setActiveTab("teamOverview")}
                style={{
                  background: activeTab === "teamOverview"
                    ? "linear-gradient(90deg, #00adb5, #00cc00)"
                    : "linear-gradient(90deg, #393e46, #2e333b)",
                  border: "none",
                  color: "#FFFFFF",
                  fontSize: "0.9rem",
                  fontWeight: 500,
                  padding: "0.5rem 1rem",
                  borderRadius: "8px",
                  cursor: "pointer",
                  transition: "transform 0.3s, background 0.3s",
                  boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
                onMouseOver={(e) => {
                  if (activeTab !== "teamOverview") {
                    e.target.style.transform = "scale(1.05)";
                    e.target.style.background = "linear-gradient(90deg, #00adb5, #00cc00)";
                  }
                }}
                onMouseOut={(e) => {
                  if (activeTab !== "teamOverview") {
                    e.target.style.transform = "scale(1)";
                    e.target.style.background = "linear-gradient(90deg, #393e46, #2e333b)";
                  }
                }}
                aria-selected={activeTab === "teamOverview"}
                role="tab"
              >
                <FaChartBar /> Team Overview
              </button>
            </li>
            <li>
              <button
                className={`dark-button ${activeTab === "revaKnowledge" ? "active-tab" : ""}`}
                onClick={() => setActiveTab("revaKnowledge")}
                style={{
                  background: activeTab === "revaKnowledge"
                    ? "linear-gradient(90deg, #00adb5, #00cc00)"
                    : "linear-gradient(90deg, #393e46, #2e333b)",
                  border: "none",
                  color: "#FFFFFF",
                  fontSize: "0.9rem",
                  fontWeight: 500,
                  padding: "0.5rem 1rem",
                  borderRadius: "8px",
                  cursor: "pointer",
                  transition: "transform 0.3s, background 0.3s",
                  boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
                onMouseOver={(e) => {
                  if (activeTab !== "revaKnowledge") {
                    e.target.style.transform = "scale(1.05)";
                    e.target.style.background = "linear-gradient(90deg, #00adb5, #00cc00)";
                  }
                }}
                onMouseOut={(e) => {
                  if (activeTab !== "revaKnowledge") {
                    e.target.style.transform = "scale(1)";
                    e.target.style.background = "linear-gradient(90deg, #393e46, #2e333b)";
                  }
                }}
                aria-selected={activeTab === "revaKnowledge"}
                role="tab"
              >
                <FaDatabase /> Reva Knowledge
              </button>
            </li>
            <li>
              <button
                className={`dark-button ${activeTab === "uploadKnowledgeTest" ? "active-tab" : ""}`}
                onClick={() => setActiveTab("uploadKnowledgeTest")}
                style={{
                  background: activeTab === "uploadKnowledgeTest"
                    ? "linear-gradient(90deg, #00adb5, #00cc00)"
                    : "linear-gradient(90deg, #393e46, #2e333b)",
                  border: "none",
                  color: "#FFFFFF",
                  fontSize: "0.9rem",
                  fontWeight: 500,
                  padding: "0.5rem 1rem",
                  borderRadius: "8px",
                  cursor: "pointer",
                  transition: "transform 0.3s, background 0.3s",
                  boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
                onMouseOver={(e) => {
                  if (activeTab !== "uploadKnowledgeTest") {
                    e.target.style.transform = "scale(1.05)";
                    e.target.style.background = "linear-gradient(90deg, #00adb5, #00cc00)";
                  }
                }}
                onMouseOut={(e) => {
                  if (activeTab !== "uploadKnowledgeTest") {
                    e.target.style.transform = "scale(1)";
                    e.target.style.background = "linear-gradient(90deg, #393e46, #2e333b)";
                  }
                }}
                aria-selected={activeTab === "uploadKnowledgeTest"}
                role="tab"
              >
                <FaBook /> Upload Knowledge Test
              </button>
            </li>
            <li>
              <button
                className={`dark-button ${activeTab === "uploadBriefing" ? "active-tab" : ""}`}
                onClick={() => {
                  setActiveTab("uploadBriefing");
                  setBriefingMessage("");
                }}
                style={{
                  background: activeTab === "uploadBriefing"
                    ? "linear-gradient(90deg, #00adb5, #00cc00)"
                    : "linear-gradient(90deg, #393e46, #2e333b)",
                  border: "none",
                  color: "#FFFFFF",
                  fontSize: "0.9rem",
                  fontWeight: 500,
                  padding: "0.5rem 1rem",
                  borderRadius: "8px",
                  cursor: "pointer",
                  transition: "transform 0.3s, background 0.3s",
                  boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
                onMouseOver={(e) => {
                  if (activeTab !== "uploadBriefing") {
                    e.target.style.transform = "scale(1.05)";
                    e.target.style.background = "linear-gradient(90deg, #00adb5, #00cc00)";
                  }
                }}
                onMouseOut={(e) => {
                  if (activeTab !== "uploadBriefing") {
                    e.target.style.transform = "scale(1)";
                    e.target.style.background = "linear-gradient(90deg, #393e46, #2e333b)";
                  }
                }}
                aria-selected={activeTab === "uploadBriefing"}
                role="tab"
              >
                <FaPlus /> Upload Briefing
              </button>
            </li>
            <li>
              <button
                className={`dark-button ${activeTab === "broadcast" ? "active-tab" : ""}`}
                onClick={() => {
                  setActiveTab("broadcast");
                  setBroadcastMessage("");
                }}
                style={{
                  background: activeTab === "broadcast"
                    ? "linear-gradient(90deg, #00adb5, #00cc00)"
                    : "linear-gradient(90deg, #393e46, #2e333b)",
                  border: "none",
                  color: "#FFFFFF",
                  fontSize: "0.9rem",
                  fontWeight: 500,
                  padding: "0.5rem 1rem",
                  borderRadius: "8px",
                  cursor: "pointer",
                  transition: "transform 0.3s, background 0.3s",
                  boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
                onMouseOver={(e) => {
                  if (activeTab !== "broadcast") {
                    e.target.style.transform = "scale(1.05)";
                    e.target.style.background = "linear-gradient(90deg, #00adb5, #00cc00)";
                  }
                }}
                onMouseOut={(e) => {
                  if (activeTab !== "broadcast") {
                    e.target.style.transform = "scale(1)";
                    e.target.style.background = "linear-gradient(90deg, #393e46, #2e333b)";
                  }
                }}
                aria-selected={activeTab === "broadcast"}
                role="tab"
              >
                <FaBroadcastTower /> Broadcast
              </button>
            </li>
            <li>
              <button
                className="dark-button"
                onClick={() => handleNavigation("/")}
                style={{
                  background: "linear-gradient(90deg, #f48fb1, #f06292)",
                  border: "none",
                  color: "#FFFFFF",
                  fontSize: "0.9rem",
                  fontWeight: 500,
                  padding: "0.5rem 1rem",
                  borderRadius: "8px",
                  cursor: "pointer",
                  transition: "transform 0.3s, background 0.3s",
                  boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
                onMouseOver={(e) => {
                  e.target.style.transform = "scale(1.05)";
                  e.target.style.background = "linear-gradient(90deg, #f06292, #f48fb1)";
                }}
                onMouseOut={(e) => {
                  e.target.style.transform = "scale(1)";
                  e.target.style.background = "linear-gradient(90deg, #f48fb1, #f06292)";
                }}
                aria-label="Go to Dashboard"
              >
                <FaHome /> Dashboard
              </button>
            </li>
          </ul>
        </nav>

        {/* Main Content */}
        <div
          style={{ padding: "1rem", overflowY: "auto" }}
          aria-label="Main Content"
        >
          {activeTab === "teamOverview" && (
            <section className="dark-card neon-card fadeInUp" style={{
              padding: "1.5rem",
              background: "linear-gradient(135deg, #2e333b, #222831)",
              borderRadius: "15px",
              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
              marginBottom: "1.5rem",
            }}>
              {teamStats && (
                <div role="region" aria-label="Team Performance Overview">
                  <h2 className="neon-card-title" style={{
                    position: "relative",
                    paddingBottom: "0.5rem",
                    color: "#00ADB5",
                    fontSize: "1.5rem",
                  }}>
                    Team Performance ({teamStats.period})
                    <span style={{
                      position: "absolute",
                      bottom: 0,
                      left: 0,
                      width: "50%",
                      height: "3px",
                      background: "linear-gradient(90deg, #00adb5, #00cc00)",
                      borderRadius: "2px",
                    }}></span>
                  </h2>
                  <div className="metric-grid" style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: "1rem",
                    padding: "1rem 0",
                  }}>
                    {[
                      { label: "Avg AI Score", value: `${teamStats.avgAIScore}%` },
                      { label: "Total Calls", value: teamStats.totalCalls },
                      { label: "Avg AHT (min)", value: teamStats.avgAHT },
                      { label: "Avg Sentiment", value: teamStats.avgSentiment },
                    ].map((metric, idx) => (
                      <div key={idx} style={{
                        padding: "1rem",
                        textAlign: "center",
                        borderRadius: "12px",
                        background: "linear-gradient(135deg, #2e333b, #393e46)",
                        boxShadow: "0 4px 8px rgba(0, 0, 0, 0.3), inset 0 1px 3px rgba(255, 255, 255, 0.1)",
                        transition: "transform 0.3s ease",
                      }}
                      onMouseOver={(e) => e.currentTarget.style.transform = "translateY(-5px)"}
                      onMouseOut={(e) => e.currentTarget.style.transform = "translateY(0)"}
                      >
                        <h3 style={{ fontSize: "1rem", color: "#00adb5", margin: 0, fontWeight: 600 }}>
                          {metric.label}
                        </h3>
                        <p style={{ fontSize: "1.4rem", color: "#ffffff", margin: "0.3rem 0 0 0", fontWeight: 700 }}>
                          {metric.value}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="dashboard-grid fadeInUp" style={{
                display: "grid",
                gridTemplateColumns: "1fr 1.5fr",
                gap: "1.5rem",
                marginTop: "1.5rem",
              }}>
                <div className="dark-card neon-card" style={{
                  background: "linear-gradient(135deg, #2e333b, #222831)",
                  borderRadius: "15px",
                  padding: "1.5rem",
                }} role="region" aria-label="My Team">
                  <h2 className="neon-card-title" style={{
                    position: "relative",
                    paddingBottom: "0.5rem",
                    color: "#00ADB5",
                    fontSize: "1.5rem",
                  }}>
                    My Team
                    <span style={{
                      position: "absolute",
                      bottom: 0,
                      left: 0,
                      width: "50%",
                      height: "3px",
                      background: "linear-gradient(90deg, #00adb5, #00cc00)",
                      borderRadius: "2px",
                    }}></span>
                  </h2>
                  <table className="dark-table" style={{ marginTop: "1rem" }}>
                    <thead>
                      <tr>
                        <th>Agent</th>
                        <th>Avg Score</th>
                        <th>Calls</th>
                        <th>AHT (min)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agents.length > 0 ? (
                        agents.map((agent, idx) => (
                          <tr key={idx} style={{
                            background: idx % 2 === 0 ? "linear-gradient(90deg, rgba(46, 51, 59, 0.9), rgba(34, 40, 49, 0.9))" : "transparent",
                          }}>
                            <td>{sanitizeInput(agent.name)}</td>
                            <td style={{ color: agent.avgScore > 80 ? "#00adb5" : "#ff5722" }}>
                              {agent.avgScore}%
                            </td>
                            <td>{agent.calls}</td>
                            <td>{agent.aht}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="4">No agents under your supervision.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="dark-card neon-card" style={{
                  background: "linear-gradient(135deg, #2e333b, #222831)",
                  borderRadius: "15px",
                  padding: "1.5rem",
                }} role="region" aria-label="Audit Queue">
                  <h2 className="neon-card-title" style={{
                    position: "relative",
                    paddingBottom: "0.5rem",
                    color: "#00ADB5",
                    fontSize: "1.5rem",
                  }}>
                    Audit Queue
                    <span style={{
                      position: "absolute",
                      bottom: 0,
                      left: 0,
                      width: "50%",
                      height: "3px",
                      background: "linear-gradient(90deg, #00adb5, #00cc00)",
                      borderRadius: "2px",
                    }}></span>
                  </h2>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1rem" }}>
                    <span style={{
                      fontSize: "0.8rem",
                      color: "#00adb5",
                      opacity: 0.7,
                      width: "60px",
                      textAlign: "center",
                      background: "rgba(57, 62, 70, 0.5)",
                      borderRadius: "5px",
                      padding: "0.3rem",
                      boxShadow: "inset 2px 2px 4px rgba(0, 0, 0, 0.3)",
                    }}>Agent</span>
                    <input
                      type="text"
                      className="dark-input"
                      value={filterAgent}
                      onChange={(e) => setFilterAgent(sanitizeInput(e.target.value))}
                      placeholder="Enter agent name..."
                      style={{
                        padding: "0.4rem",
                        borderRadius: "5px",
                        background: "#ffffff", // White background
                        border: "none",
                        color: "#000000", // Black text for visibility
                        boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
                      }}
                      css={{
                        "&::placeholder": {
                          color: "#333333", // Dark gray placeholder
                        },
                        "&:focus": {
                          outline: "none",
                          boxShadow: "0 0 8px rgba(0, 173, 181, 0.5)",
                        },
                      }}
                      aria-label="Filter Audit Queue by Agent Name"
                    />
                    <span style={{
                      fontSize: "0.8rem",
                      color: "#00adb5",
                      opacity: 0.7,
                      width: "60px",
                      textAlign: "center",
                      background: "rgba(57, 62, 70, 0.5)",
                      borderRadius: "5px",
                      padding: "0.3rem",
                      boxShadow: "inset 2px 2px 4px rgba(0, 0, 0, 0.3)",
                    }}>From</span>
                    <input
                      type="date"
                      className="dark-input"
                      value={fromDate}
                      onChange={(e) => setFromDate(sanitizeInput(e.target.value))}
                      style={{
                        padding: "0.4rem",
                        borderRadius: "5px",
                        background: "#ffffff",
                        border: "none",
                        color: "#000000", // Black text for visibility
                        boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
                      }}
                      css={{
                        "&:focus": {
                          outline: "none",
                          boxShadow: "0 0 8px rgba(0, 173, 181, 0.5)",
                        },
                      }}
                      aria-label="Filter Audit Queue by Start Date"
                    />
                    <span style={{
                      fontSize: "0.8rem",
                      color: "#00adb5",
                      opacity: 0.7,
                      width: "60px",
                      textAlign: "center",
                      background: "rgba(57, 62, 70, 0.5)",
                      borderRadius: "5px",
                      padding: "0.3rem",
                      boxShadow: "inset 2px 2px 4px rgba(0, 0, 0, 0.3)",
                    }}>To</span>
                    <input
                      type="date"
                      className="dark-input"
                      value={toDate}
                      onChange={(e) => setToDate(sanitizeInput(e.target.value))}
                      style={{
                        padding: "0.4rem",
                        borderRadius: "5px",
                        background: "#ffffff",
                        border: "none",
                        color: "#000000", // Black text for visibility
                        boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
                      }}
                      css={{
                        "&:focus": {
                          outline: "none",
                          boxShadow: "0 0 8px rgba(0, 173, 181, 0.5)",
                        },
                      }}
                      aria-label="Filter Audit Queue by End Date"
                    />
                  </div>
                  <div className="audit-queue-table-container" style={{ maxHeight: "250px", overflowY: "auto" }}>
                    <table className="dark-table" style={{ marginTop: "1rem" }}>
                      <thead>
                        <tr>
                          <th>Agent Name</th>
                          <th>Call Type</th>
                          <th>AI Score</th>
                          <th>Manual Score</th>
                          <th>Call Date</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditQueue.length > 0 ? (
                          auditQueue.map((call, idx) => (
                            <tr key={idx} style={{
                              background: idx % 2 === 0 ? "linear-gradient(90deg, rgba(46, 51, 59, 0.9), rgba(34, 40, 49, 0.9))" : "transparent",
                            }}>
                              <td>{sanitizeInput(call.agentName)}</td>
                              <td>{call.callType}</td>
                              <td style={{ color: call.score > 80 ? "#00adb5" : "#ff5722" }}>
                                {call.score}
                              </td>
                              <td>{call.manualScoring || "N/A"}</td>
                              <td>{call.callDate}</td>
                              <td>
                                <button
                                  className="dark-button"
                                  style={{
                                    fontSize: "0.9rem",
                                    background: "linear-gradient(90deg, #00adb5, #00cc00)",
                                    boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                                    padding: "0.5rem 1rem",
                                    borderRadius: "8px",
                                    transition: "transform 0.3s",
                                  }}
                                  onMouseOver={(e) => e.target.style.transform = "scale(1.05)"}
                                  onMouseOut={(e) => e.target.style.transform = "scale(1)"}
                                  onClick={() => navigate(`/results/${call.fileName}`)}
                                  aria-label={`Review call ${call.fileName}`}
                                >
                                  Review
                                </button>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan="6">No calls require auditing at this time.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </section>
          )}
          
          {activeTab === "uploadKnowledgeTest" && (
            <section className="dark-card neon-card fadeInUp" style={{
              padding: "1.5rem",
              background: "linear-gradient(135deg, #2e333b, #222831)",
              borderRadius: "15px",
              marginBottom: "1.5rem",
            }}>
              <h2 className="neon-card-title" style={{
                position: "relative",
                paddingBottom: "0.5rem",
                color: "#00ADB5",
                fontSize: "1.5rem",
              }}>
                Upload Knowledge Test Questions
                <span style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  width: "50%",
                  height: "3px",
                  background: "linear-gradient(90deg, #00adb5, #00cc00)",
                  borderRadius: "2px",
                }}></span>
              </h2>
              {knowledgeMessage && (
                <div
                  className={knowledgeMessage.includes("Success") ? "success-message" : "error-message"}
                  role="alert"
                  aria-live="assertive"
                >
                  {knowledgeMessage}
                </div>
              )}
              {questions.map((q, idx) => (
                <div key={idx} style={{
                  marginBottom: "1.5rem",
                  padding: "1rem",
                  background: "linear-gradient(135deg, #393e46, #2e333b)",
                  borderRadius: "10px",
                  boxShadow: "0 0 6px rgba(0, 173, 181, 0.3), 0 2px 4px rgba(0, 0, 0, 0.3)",
                }}>
                  <label style={{ color: "#EEEEEE", display: "block", fontSize: "1rem", marginBottom: "0.5rem" }}>
                    Question {idx + 1}
                  </label>
                  <input
                    type="text"
                    className="dark-input"
                    value={q.question}
                    onChange={(e) => handleQuestionChange(idx, "question", e.target.value)}
                    placeholder="Enter question..."
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      borderRadius: "8px",
                      background: "#ffffff", // White background
                      border: "1px solid #00adb5",
                      color: "#000000", // Black text for visibility
                      boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
                      marginBottom: "1rem",
                    }}
                    css={{
                      "&::placeholder": {
                        color: "#333333", // Dark gray placeholder
                      },
                      "&:focus": {
                        outline: "none",
                        boxShadow: "0 0 8px rgba(0, 173, 181, 0.5)",
                      },
                    }}
                    aria-required="true"
                  />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
                    {q.options.map((opt, optIdx) => (
                      <div key={optIdx}>
                        <label style={{ color: "#EEEEEE", fontSize: "0.9rem", marginBottom: "0.3rem", display: "block" }}>
                          Option {optIdx + 1}
                        </label>
                        <input
                          type="text"
                          className="dark-input"
                          value={opt}
                          onChange={(e) => handleQuestionChange(idx, "option", e.target.value, optIdx)}
                          placeholder={`Option ${optIdx + 1}`}
                          style={{
                            width: "100%",
                            padding: "0.5rem",
                            borderRadius: "8px",
                            background: "#ffffff",
                            border: "1px solid #00adb5",
                            color: "#000000", // Black text for visibility
                            boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
                          }}
                          css={{
                            "&::placeholder": {
                              color: "#333333",
                            },
                            "&:focus": {
                              outline: "none",
                              boxShadow: "0 0 8px rgba(0, 173, 181, 0.5)",
                            },
                          }}
                          aria-required="true"
                        />
                      </div>
                    ))}
                  </div>
                  <label style={{ color: "#EEEEEE", display: "block", fontSize: "0.9rem", marginBottom: "0.3rem" }}>
                    Correct Answer
                  </label>
                  <input
                    type="text"
                    className="dark-input"
                    value={q.correctAnswer}
                    onChange={(e) => handleQuestionChange(idx, "correctAnswer", e.target.value)}
                    placeholder="Correct Answer"
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      borderRadius: "8px",
                      background: "#ffffff",
                      border: "1px solid #00adb5",
                      color: "#000000", // Black text for visibility
                      boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
                    }}
                    css={{
                      "&::placeholder": {
                        color: "#333333",
                      },
                      "&:focus": {
                        outline: "none",
                        boxShadow: "0 0 8px rgba(0, 173, 181, 0.5)",
                      },
                    }}
                    aria-required="true"
                  />
                </div>
              ))}
              <div style={{ marginBottom: "1rem" }}>
                <button
                  className="dark-button"
                  onClick={handleAddQuestion}
                  disabled={questions.length >= 5}
                  style={{
                    background: questions.length >= 5
                      ? "linear-gradient(90deg, #666666, #555555)"
                      : "linear-gradient(90deg, #00adb5, #00cc00)",
                    padding: "0.5rem 1rem",
                    fontSize: "0.9rem",
                    borderRadius: "8px",
                    border: "none",
                    color: "#ffffff",
                    boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                    transition: "transform 0.3s",
                    cursor: questions.length >= 5 ? "not-allowed" : "pointer",
                  }}
                  onMouseOver={(e) => {
                    if (questions.length < 5) e.target.style.transform = "scale(1.05)";
                  }}
                  onMouseOut={(e) => e.target.style.transform = "scale(1)"}
                  aria-label="Add Another Question"
                >
                  <FaPlus style={{ marginRight: "4px" }} /> Add Another Question
                </button>
              </div>
              <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
                <button
                  className="dark-button"
                  onClick={handleSubmitKnowledgeTest}
                  style={{
                    background: "linear-gradient(90deg, #00adb5, #00cc00)",
                    padding: "0.5rem 1rem",
                    fontSize: "0.9rem",
                    borderRadius: "8px",
                    border: "none",
                    color: "#ffffff",
                    boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                    transition: "transform 0.3s",
                  }}
                  onMouseOver={(e) => e.target.style.transform = "scale(1.05)"}
                  onMouseOut={(e) => e.target.style.transform = "scale(1)"}
                  aria-label="Submit Knowledge Test Questions"
                >
                  Submit Questions
                </button>
                <button
                  className="dark-button"
                  onClick={handleCancelKnowledgeTest}
                  style={{
                    background: "linear-gradient(90deg, #ff5722, #ff3333)",
                    padding: "0.5rem 1rem",
                    fontSize: "0.9rem",
                    borderRadius: "8px",
                    border: "none",
                    color: "#ffffff",
                    boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                    transition: "transform 0.3s",
                  }}
                  onMouseOver={(e) => e.target.style.transform = "scale(1.05)"}
                  onMouseOut={(e) => e.target.style.transform = "scale(1)"}
                  aria-label="Cancel Knowledge Test Upload"
                >
                  Cancel
                </button>
              </div>
            </section>
          )}

          {activeTab === "revaKnowledge" && (
            <section className="dark-card neon-card fadeInUp" style={{
              padding: "1.5rem",
              background: "linear-gradient(135deg, #2e333b, #222831)",
              borderRadius: "15px",
              marginBottom: "1.5rem",
            }}>
              <h2 className="neon-card-title" style={{
                position: "relative",
                paddingBottom: "0.5rem",
                color: "#00ADB5",
                fontSize: "1.5rem",
              }}>
                Manage Reva Knowledge
                <span style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  width: "50%",
                  height: "3px",
                  background: "linear-gradient(90deg, #00adb5, #00cc00)",
                  borderRadius: "2px",
                }}></span>
              </h2>
              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
                {revaKnowledgeTabs.map((tab) => (
                  <button
                    key={tab}
                    className={`dark-button ${activeKnowledgeTab === tab ? "active-tab" : ""}`}
                    onClick={() => {
                      setActiveKnowledgeTab(tab);
                      setKnowledgeBaseMessage("");
                    }}
                    style={{
                      background: activeKnowledgeTab === tab
                        ? "linear-gradient(90deg, #00adb5, #00cc00)"
                        : "linear-gradient(90deg, #393e46, #2e333b)",
                      border: "none",
                      color: "#FFFFFF",
                      fontSize: "0.9rem",
                      fontWeight: 500,
                      padding: "0.5rem 1rem",
                      borderRadius: "8px",
                      cursor: "pointer",
                      transition: "transform 0.3s, background 0.3s",
                      boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                    }}
                    onMouseOver={(e) => {
                      if (activeKnowledgeTab !== tab) {
                        e.target.style.transform = "scale(1.05)";
                        e.target.style.background = "linear-gradient(90deg, #00adb5, #00cc00)";
                      }
                    }}
                    onMouseOut={(e) => {
                      if (activeKnowledgeTab !== tab) {
                        e.target.style.transform = "scale(1)";
                        e.target.style.background = "linear-gradient(90deg, #393e46, #2e333b)";
                      }
                    }}
                    aria-selected={activeKnowledgeTab === tab}
                    role="tab"
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <button
                className="dark-button"
                onClick={() => {
                  setShowAddKnowledgeForm(true);
                  setKnowledgeBaseMessage("");
                  setNewKnowledge({ question: "", answer: "", category: activeKnowledgeTab });
                }}
                style={{
                  background: "linear-gradient(90deg, #00adb5, #00cc00)",
                  padding: "0.5rem 1rem",
                  fontSize: "0.9rem",
                  borderRadius: "8px",
                  border: "none",
                  color: "#ffffff",
                  boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                  marginBottom: "1rem",
                  transition: "transform 0.3s",
                }}
                onMouseOver={(e) => e.target.style.transform = "scale(1.05)"}
                onMouseOut={(e) => e.target.style.transform = "scale(1)"}
                aria-label="Add New Knowledge Entry"
              >
                <FaPlus style={{ marginRight: "4px" }} /> Add New Entry
              </button>
              {knowledgeBaseMessage && (
                <div
                  className={knowledgeBaseMessage.includes("Success") ? "success-message" : "error-message"}
                  role="alert"
                  aria-live="assertive"
                >
                  {knowledgeBaseMessage}
                </div>
              )}
              <div className="audit-queue-table-container" style={{ maxHeight: "400px", overflowY: "auto" }}>
                <table className="dark-table" style={{ marginTop: "1rem" }}>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Question</th>
                      <th>Answer</th>
                      <th>Modified By</th>
                      <th>Modified At</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {knowledgeCategories[activeKnowledgeTab] && knowledgeCategories[activeKnowledgeTab].length > 0 ? (
                      knowledgeCategories[activeKnowledgeTab].map((entry) => (
                        <tr key={entry.ID} style={{
                          background: entry.ID % 2 === 0 ? "linear-gradient(90deg, rgba(46, 51, 59, 0.9), rgba(34, 40, 49, 0.9))" : "transparent",
                        }}>
                          <td>{entry.ID}</td>
                          <td>{sanitizeInput(entry.question)}</td>
                          <td>{sanitizeInput(entry.answer)}</td>
                          <td>{sanitizeInput(entry.modifiedBy)}</td>
                          <td>{new Date(entry.modifiedAt).toISOString().split('T')[0]}</td>
                          <td>
                            <button
                              className="dark-button"
                              style={{
                                fontSize: "0.85rem",
                                padding: "0.5rem",
                                marginRight: "0.5rem",
                                background: "linear-gradient(90deg, #00adb5, #00cc00)",
                                borderRadius: "8px",
                                transition: "transform 0.3s",
                              }}
                              onClick={() => {
                                setSelectedKnowledge({
                                  ID: entry.ID,
                                  Question: entry.question,
                                  Answer: entry.answer,
                                  Category: activeKnowledgeTab,
                                  ModifiedBy: entry.modifiedBy,
                                  ModifiedAt: entry.modifiedAt,
                                });
                                setShowUpdateKnowledgeForm(true);
                                setKnowledgeBaseMessage("");
                              }}
                              onMouseOver={(e) => e.target.style.transform = "scale(1.05)"}
                              onMouseOut={(e) => e.target.style.transform = "scale(1)"}
                              aria-label={`Edit knowledge entry ${entry.ID}`}
                            >
                              <FaEdit />
                            </button>
                            <button
                              className="dark-button"
                              style={{
                                fontSize: "0.85rem",
                                padding: "0.5rem",
                                background: "linear-gradient(90deg, #ff5722, #ff3333)",
                                borderRadius: "8px",
                                transition: "transform 0.3s",
                              }}
                              onClick={() => handleDeleteKnowledge(entry.ID)}
                              onMouseOver={(e) => e.target.style.transform = "scale(1.05)"}
                              onMouseOut={(e) => e.target.style.transform = "scale(1)"}
                              aria-label={`Delete knowledge entry ${entry.ID}`}
                            >
                              <FaTrash />
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="6">No knowledge entries available for this category.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeTab === "uploadBriefing" && (
            <section className="dark-card neon-card fadeInUp" style={{
              padding: "1.5rem",
              background: "linear-gradient(135deg, #2e333b, #222831)",
              borderRadius: "15px",
              marginBottom: "1.5rem",
            }}>
              <h3 className="neon-card-title" style={{ color: "#00ADB5", fontSize: "1.5rem" }}>
                <FaFileAlt style={{ marginRight: "8px" }} />
                Upload Daily Briefing
              </h3>
              {briefingMessage && (
                <div
                  className={briefingMessage.includes("Success") ? "success-message" : "error-message"}
                  role="alert"
                  aria-live="assertive"
                >
                  {briefingMessage}
                </div>
              )}
              <textarea
                className="dark-input"
                value={briefingContent}
                onChange={(e) => setBriefingContent(sanitizeInput(e.target.value))}
                placeholder="Enter briefing content for your team..."
                rows="5"
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  borderRadius: "8px",
                  background: "#393e46", // Dark background for input
                  border: "1px solid #00adb5",
                  color: "#FFFFFF", // White text for entered content
                  boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
                  marginBottom: "1rem",
                  resize: "vertical",
                }}
                css={{
                  "&::placeholder": {
                    color: "#999999", // Gray placeholder for visibility
                  },
                  "&:focus": {
                    outline: "none",
                    boxShadow: "0 0 8px rgba(0, 173, 181, 0.5)", // Neon focus glow
                  },
                }}
                aria-required="true"
                aria-label="Daily Briefing Content"
              />
              <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
                <button
                  className="dark-button"
                  onClick={handleSubmitBriefing}
                  style={{
                    background: "linear-gradient(90deg, #00adb5, #00cc00)",
                    padding: "0.5rem 1rem",
                    fontSize: "0.9rem",
                    borderRadius: "8px",
                    border: "none",
                    color: "#FFFFFF",
                    boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                    transition: "transform 0.3s",
                  }}
                  onMouseOver={(e) => e.target.style.transform = "scale(1.05)"}
                  onMouseOut={(e) => e.target.style.transform = "scale(1)"}
                  aria-label="Submit Briefing"
                >
                  Submit Briefing
                </button>
                <button
                  className="dark-button"
                  onClick={() => {
                    setBriefingContent("");
                    setBriefingMessage("");
                    setActiveTab("teamOverview");
                  }}
                  style={{
                    background: "linear-gradient(90deg, #ff5722, #ff3333)",
                    padding: "0.5rem 1rem",
                    fontSize: "0.9rem",
                    borderRadius: "8px",
                    border: "none",
                    color: "#FFFFFF",
                    boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                    transition: "transform 0.3s",
                  }}
                  onMouseOver={(e) => e.target.style.transform = "scale(1.05)"}
                  onMouseOut={(e) => e.target.style.transform = "scale(1)"}
                  aria-label="Cancel Briefing Upload"
                >
                  Cancel
                </button>
              </div>
            </section>
          )}

          {activeTab === "broadcast" && (
            <section className="dark-card neon-card fadeInUp" style={{
              padding: "1.5rem",
              background: "linear-gradient(135deg, #2e333b, #222831)",
              borderRadius: "15px",
              marginBottom: "1.5rem",
            }}>
              <h3 className="neon-card-title" style={{ color: "#00ADB5", fontSize: "1.5rem" }}>
                <FaBroadcastTower style={{ marginRight: "8px" }} />
                Broadcast Message to Agents
              </h3>
              {broadcastMessage && (
                <div
                  className={broadcastMessage.includes("Success") ? "success-message" : "error-message"}
                  role="alert"
                  aria-live="assertive"
                >
                  {broadcastMessage}
                </div>
              )}
              <textarea
                className="dark-input"
                value={broadcastContent}
                onChange={(e) => setBroadcastContent(sanitizeInput(e.target.value))}
                placeholder="Enter broadcast message for all agents..."
                rows="5"
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  borderRadius: "8px",
                  background: "#393e46",
                  border: "1px solid #00adb5",
                  color: "#FFFFFF",
                  boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
                  marginBottom: "1rem",
                  resize: "vertical",
                }}
                css={{
                  "&::placeholder": {
                    color: "#999999",
                  },
                  "&:focus": {
                    outline: "none",
                    boxShadow: "0 0 8px rgba(0, 173, 181, 0.5)",
                  },
                }}
                aria-required="true"
                aria-label="Broadcast Message Content"
              />
              <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
                <button
                  className="dark-button"
                  onClick={handleSubmitBroadcast}
                  style={{
                    background: "linear-gradient(90deg, #00adb5, #00cc00)",
                    padding: "0.5rem 1rem",
                    fontSize: "0.9rem",
                    borderRadius: "8px",
                    border: "none",
                    color: "#FFFFFF",
                    boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                    transition: "transform 0.3s",
                  }}
                  onMouseOver={(e) => e.target.style.transform = "scale(1.05)"}
                  onMouseOut={(e) => e.target.style.transform = "scale(1)"}
                  aria-label="Send Broadcast Message"
                >
                  Send Broadcast
                </button>
                <button
                  className="dark-button"
                  onClick={() => {
                    setBroadcastContent("");
                    setBroadcastMessage("");
                    setActiveTab("teamOverview");
                  }}
                  style={{
                    background: "linear-gradient(90deg, #ff5722, #ff3333)",
                    padding: "0.5rem 1rem",
                    fontSize: "0.9rem",
                    borderRadius: "8px",
                    border: "none",
                    color: "#FFFFFF",
                    boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                    transition: "transform 0.3s",
                  }}
                  onMouseOver={(e) => e.target.style.transform = "scale(1.05)"}
                  onMouseOut={(e) => e.target.style.transform = "scale(1)"}
                  aria-label="Cancel Broadcast"
                >
                  Cancel
                </button>
              </div>
            </section>
          )}

          {/* Add Reva Knowledge Entry Modal - Updated for Visibility */}
          {showAddKnowledgeForm && (
            <div className="modal-overlay" role="dialog" aria-label="Add Reva Knowledge Entry Modal">
              <div className="modal-content" style={{
                background: "linear-gradient(135deg, #222831 0%, #2e333b 100%)",
                backdropFilter: "blur(10px)",
                border: "1px solid rgba(0, 173, 181, 0.3)",
                borderRadius: "15px",
                padding: "2rem",
                maxWidth: "500px",
                width: "90%",
                boxShadow: "0 8px 32px rgba(0, 0, 0, 0.2)",
              }}>
                <h3 className="neon-card-title" style={{ color: "#00ADB5", fontSize: "1.3rem" }}>
                  <FaDatabase style={{ marginRight: "8px" }} />
                  Add New Reva Knowledge Entry
                </h3>
                {knowledgeBaseMessage && (
                  <div
                    className={knowledgeBaseMessage.includes("Success") ? "success-message" : "error-message"}
                    role="alert"
                    aria-live="assertive"
                  >
                    {knowledgeBaseMessage}
                  </div>
                )}
                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ color: "#EEEEEE", display: "block", fontSize: "1rem", marginBottom: "0.5rem" }}>
                    Category
                  </label>
                  <select
                    className="dark-input"
                    value={newKnowledge.category}
                    onChange={(e) => handleNewKnowledgeChange("category", e.target.value)}
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      borderRadius: "8px",
                      background: "#393e46",
                      border: "1px solid #00adb5",
                      color: "#FFFFFF",
                      boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
                    }}
                    css={{
                      "&:focus": {
                        outline: "none",
                        boxShadow: "0 0 8px rgba(0, 173, 181, 0.5)",
                      },
                    }}
                    aria-required="true"
                  >
                    {revaKnowledgeTabs.map((tab) => (
                      <option key={tab} value={tab} style={{ color: "#FFFFFF", background: "#2e333b" }}>
                        {tab}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ color: "#EEEEEE", display: "block", fontSize: "1rem", marginBottom: "0.5rem" }}>
                    Question
                  </label>
                  <input
                    type="text"
                    className="dark-input"
                    value={newKnowledge.question}
                    onChange={(e) => handleNewKnowledgeChange("question", e.target.value)}
                    placeholder="Enter question..."
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      borderRadius: "8px",
                      background: "#393e46",
                      border: "1px solid #00adb5",
                      color: "#FFFFFF",
                      boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
                    }}
                    css={{
                      "&::placeholder": {
                        color: "#999999",
                      },
                      "&:focus": {
                        outline: "none",
                        boxShadow: "0 0 8px rgba(0, 173, 181, 0.5)",
                      },
                    }}
                    aria-required="true"
                  />
                </div>
                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ color: "#EEEEEE", display: "block", fontSize: "1rem", marginBottom: "0.5rem" }}>
                    Answer
                  </label>
                  <input
                    type="text"
                    className="dark-input"
                    value={newKnowledge.answer}
                    onChange={(e) => handleNewKnowledgeChange("answer", e.target.value)}
                    placeholder="Enter answer..."
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      borderRadius: "8px",
                      background: "#393e46",
                      border: "1px solid #00adb5",
                      color: "#FFFFFF",
                      boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
                    }}
                    css={{
                      "&::placeholder": {
                        color: "#999999",
                      },
                      "&:focus": {
                        outline: "none",
                        boxShadow: "0 0 8px rgba(0, 173, 181, 0.5)",
                      },
                    }}
                    aria-required="true"
                  />
                </div>
                <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
                  <button
                    className="dark-button"
                    onClick={handleAddKnowledge}
                    style={{
                      background: "linear-gradient(90deg, #00adb5, #00cc00)",
                      padding: "0.5rem 1rem",
                      fontSize: "0.9rem",
                      borderRadius: "8px",
                      border: "none",
                      color: "#FFFFFF",
                      boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                      transition: "transform 0.3s",
                    }}
                    onMouseOver={(e) => e.target.style.transform = "scale(1.05)"}
                    onMouseOut={(e) => e.target.style.transform = "scale(1)"}
                    aria-label="Add Knowledge Entry"
                  >
                    Add Entry
                  </button>
                  <button
                    className="dark-button"
                    onClick={() => {
                      setShowAddKnowledgeForm(false);
                      setNewKnowledge({ question: "", answer: "", category: "" });
                      setKnowledgeBaseMessage("");
                    }}
                    style={{
                      background: "linear-gradient(90deg, #ff5722, #ff3333)",
                      padding: "0.5rem 1rem",
                      fontSize: "0.9rem",
                      borderRadius: "8px",
                      border: "none",
                      color: "#FFFFFF",
                      boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                      transition: "transform 0.3s",
                    }}
                    onMouseOver={(e) => e.target.style.transform = "scale(1.05)"}
                    onMouseOut={(e) => e.target.style.transform = "scale(1)"}
                    aria-label="Cancel Add Knowledge Entry"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Update Reva Knowledge Entry Modal - Updated for Visibility */}
          {showUpdateKnowledgeForm && selectedKnowledge && (
            <div className="modal-overlay" role="dialog" aria-label="Update Reva Knowledge Entry Modal">
              <div className="modal-content" style={{
                background: "linear-gradient(135deg, #222831 0%, #2e333b 100%)",
                backdropFilter: "blur(10px)",
                border: "1px solid rgba(0, 173, 181, 0.3)",
                borderRadius: "15px",
                padding: "2rem",
                maxWidth: "500px",
                width: "90%",
                boxShadow: "0 8px 32px rgba(0, 0, 0, 0.2)",
              }}>
                <h3 className="neon-card-title" style={{ color: "#00ADB5", fontSize: "1.3rem" }}>
                  <FaDatabase style={{ marginRight: "8px" }} />
                  Update Reva Knowledge Entry
                </h3>
                {knowledgeBaseMessage && (
                  <div
                    className={knowledgeBaseMessage.includes("Success") ? "success-message" : "error-message"}
                    role="alert"
                    aria-live="assertive"
                  >
                    {knowledgeBaseMessage}
                  </div>
                )}
                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ color: "#EEEEEE", display: "block", fontSize: "1rem", marginBottom: "0.5rem" }}>
                    Category
                  </label>
                  <select
                    className="dark-input"
                    value={selectedKnowledge.Category}
                    onChange={(e) => handleSelectedKnowledgeChange("Category", e.target.value)}
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      borderRadius: "8px",
                      background: "#393e46",
                      border: "1px solid #00adb5",
                      color: "#FFFFFF",
                      boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
                    }}
                    css={{
                      "&:focus": {
                        outline: "none",
                        boxShadow: "0 0 8px rgba(0, 173, 181, 0.5)",
                      },
                    }}
                    aria-required="true"
                  >
                    {revaKnowledgeTabs.map((tab) => (
                      <option key={tab} value={tab} style={{ color: "#FFFFFF", background: "#2e333b" }}>
                        {tab}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ color: "#EEEEEE", display: "block", fontSize: "1rem", marginBottom: "0.5rem" }}>
                    Question
                  </label>
                  <input
                    type="text"
                    className="dark-input"
                    value={selectedKnowledge.Question}
                    onChange={(e) => handleSelectedKnowledgeChange("Question", e.target.value)}
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      borderRadius: "8px",
                      background: "#393e46",
                      border: "1px solid #00adb5",
                      color: "#FFFFFF",
                      boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
                    }}
                    css={{
                      "&::placeholder": {
                        color: "#999999",
                      },
                      "&:focus": {
                        outline: "none",
                        boxShadow: "0 0 8px rgba(0, 173, 181, 0.5)",
                      },
                    }}
                    aria-required="true"
                  />
                </div>
                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ color: "#EEEEEE", display: "block", fontSize: "1rem", marginBottom: "0.5rem" }}>
                    Answer
                  </label>
                  <input
                    type="text"
                    className="dark-input"
                    value={selectedKnowledge.Answer}
                    onChange={(e) => handleSelectedKnowledgeChange("Answer", e.target.value)}
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      borderRadius: "8px",
                      background: "#393e46",
                      border: "1px solid #00adb5",
                      color: "#FFFFFF",
                      boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
                    }}
                    css={{
                      "&::placeholder": {
                        color: "#999999",
                      },
                      "&:focus": {
                        outline: "none",
                        boxShadow: "0 0 8px rgba(0, 173, 181, 0.5)",
                      },
                    }}
                    aria-required="true"
                  />
                </div>
                <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
                  <button
                    className="dark-button"
                    onClick={handleUpdateKnowledge}
                    style={{
                      background: "linear-gradient(90deg, #00adb5, #00cc00)",
                      padding: "0.5rem 1rem",
                      fontSize: "0.9rem",
                      borderRadius: "8px",
                      border: "none",
                      color: "#FFFFFF",
                      boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                      transition: "transform 0.3s",
                    }}
                    onMouseOver={(e) => e.target.style.transform = "scale(1.05)"}
                    onMouseOut={(e) => e.target.style.transform = "scale(1)"}
                    aria-label="Update Knowledge Entry"
                  >
                    Update Entry
                  </button>
                  <button
                    className="dark-button"
                    onClick={() => {
                      setShowUpdateKnowledgeForm(false);
                      setSelectedKnowledge(null);
                      setKnowledgeBaseMessage("");
                    }}
                    style={{
                      background: "linear-gradient(90deg, #ff5722, #ff3333)",
                      padding: "0.5rem 1rem",
                      fontSize: "0.9rem",
                      borderRadius: "8px",
                      border: "none",
                      color: "#FFFFFF",
                      boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                      transition: "transform 0.3s",
                    }}
                    onMouseOver={(e) => e.target.style.transform = "scale(1.05)"}
                    onMouseOut={(e) => e.target.style.transform = "scale(1)"}
                    aria-label="Cancel Update Knowledge Entry"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
};

export default TeamLeaderSection;
  