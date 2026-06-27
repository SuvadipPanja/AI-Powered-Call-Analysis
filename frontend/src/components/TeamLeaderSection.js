/**
 * Author: $Panja
 * Creation Date: 2025-03-11
 * Updated: 2025-04-22
 * Description: Enhanced Team Leader Section with token-driven professional UI.
 * Compliance: IS Policy Standards (Security, Accessibility, Performance, Maintainability, Code Audit)
 * Signature Check: Do not modify this code without verifying the signature logic.
 */

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  LuChartBar,
  LuClipboardCheck,
  LuBookOpen,
  LuPlus,
  LuMegaphone,
  LuPencil,
  LuTrash2,
  LuDatabase,
  LuFileText,
  LuBanknote,
} from "../icons";
import config from "../utils/envConfig";
import { useWebSocket } from "../context/WebSocketContext";
import { useAuth } from "../context/AuthContext";
import KpiCard from "./shared/KpiCard";
import {
  Button,
  Badge,
  Input,
  Textarea,
  Select,
  Label,
  Modal,
  Spinner,
} from "./ui";
import "./reports/reports-page.css";
import "./management-pages.css";
import "./team-leader-page.css";
import ReportChartCard from "./reports/ReportChartCard";
import LoanLeadsPanel from "./reports/LoanLeadsPanel";
import { resolveDashboardDateRange } from "../utils/dashboardFilters";
import useLoanLeads from "../hooks/useLoanLeads";
import { modernDoughnutOptions } from "./reports/reportsChartConfig";

const sanitizeInput = (input) => {
  if (typeof input !== "string") return input;
  return input.replace(/[<>{}]/g, "");
};

class ErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="tl-alert tl-alert--error" role="alert">
          Something went wrong. Please refresh the page.
        </div>
      );
    }
    return this.props.children;
  }
}

const emptyQuestion = () => ({ question: "", options: ["", "", "", ""], correctAnswer: "" });

const formatCallId = (callId) => {
  if (callId == null || callId === "") return "—";
  return String(callId);
};

const isManuallyAudited = (call) =>
  Number(call?.hasManualAudit) === 1 || Boolean(call?.auditorName);

const TeamLeaderSection = () => {
  const { username, userType = "" } = useAuth();
  const navigate = useNavigate();
  const { sendMessage, isConnected } = useWebSocket();
  const [briefingContent, setBriefingContent] = useState("");
  const [briefingMessage, setBriefingMessage] = useState("");
  const [loadingTeam, setLoadingTeam] = useState(true);
  const [teamStats, setTeamStats] = useState(null);
  const [agents, setAgents] = useState([]);
  const [auditQueue, setAuditQueue] = useState([]);
  const [questions, setQuestions] = useState([
    emptyQuestion(),
    emptyQuestion(),
    emptyQuestion(),
    emptyQuestion(),
    emptyQuestion(),
  ]);
  const [knowledgeMessage, setKnowledgeMessage] = useState("");
  const [broadcastContent, setBroadcastContent] = useState("");
  const [broadcastMessage, setBroadcastMessage] = useState("");
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
  const loanTypeChartRef = useRef(null);
  const loanDonutOpts = useMemo(() => modernDoughnutOptions(), []);

  const loanQueryString = useMemo(() => {
    const params = new URLSearchParams();
    if (fromDate) params.set("fromDate", fromDate);
    if (toDate) params.set("toDate", toDate);
    if (!fromDate && !toDate) {
      const { fromDate: fd, toDate: td } = resolveDashboardDateRange({ dateRange: "1 Week" });
      params.set("fromDate", fd);
      params.set("toDate", td);
    }
    params.set("tl", sanitizeInput(username));
    if (filterAgent) params.set("agent", sanitizeInput(filterAgent));
    return params.toString();
  }, [username, filterAgent, fromDate, toDate]);

  const {
    totals: loanLeadData,
    donutData: loanTypeData,
    loading: loanLoading,
  } = useLoanLeads(loanQueryString);

  const revaKnowledgeTabs = [
    "Loan Products",
    "Account related Service",
    "Current Offer",
    "Others",
  ];

  useEffect(() => {
    fetchTeamData();
    fetchAuditQueue();
    fetchKnowledgeEntries();
  }, [username, filterAgent, fromDate, toDate]);

  const fetchTeamData = async () => {
    setLoadingTeam(true);
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

        setTeamStats({ avgAIScore, totalCalls, avgAHT, avgSentiment, period: "Last 7 Days" });
      } else {
        setAgents([]);
        setTeamStats({ avgAIScore: 0, totalCalls: 0, avgAHT: 0, avgSentiment: "N/A", period: "Last 7 Days" });
      }
    } catch (err) {
      console.error("[API] Error fetching team data:", err.message);
      setAgents([]);
      setTeamStats({ avgAIScore: 0, totalCalls: 0, avgAHT: 0, avgSentiment: "N/A", period: "Last 7 Days" });
    } finally {
      setLoadingTeam(false);
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

  const handleSubmitBriefing = async () => {
    const sanitizedContent = sanitizeInput(briefingContent).trim();
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

  const handleSubmitKnowledgeTest = async () => {
    const sanitizedQuestions = questions.map(q => ({
      question: sanitizeInput(q.question).trim(),
      options: q.options.map(opt => sanitizeInput(opt).trim()),
      correctAnswer: sanitizeInput(q.correctAnswer).trim(),
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
        setQuestions([emptyQuestion(), emptyQuestion(), emptyQuestion(), emptyQuestion(), emptyQuestion()]);
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
    const sanitizedValue = sanitizeInput(value);
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
      setQuestions([...questions, emptyQuestion()]);
    }
  };

  const handleCancelKnowledgeTest = () => {
    setQuestions([emptyQuestion(), emptyQuestion(), emptyQuestion(), emptyQuestion(), emptyQuestion()]);
    setKnowledgeMessage("");
    setActiveTab("teamOverview");
  };

  const handleSubmitBroadcast = () => {
    const sanitizedContent = sanitizeInput(broadcastContent).trim();
    if (!sanitizedContent) {
      setBroadcastMessage("Failure: Broadcast message cannot be empty.");
      return;
    }
    if (!isConnected) {
      setBroadcastMessage("Failure: Real-time connection is offline. Refresh the page and try again.");
      return;
    }
    sendMessage("all", sanitizedContent);
    setBroadcastMessage("Success: Broadcast message sent to all connected agents.");
    setBroadcastContent("");
  };

  const handleAddKnowledge = async () => {
    const sanitizedKnowledge = {
      question: sanitizeInput(newKnowledge.question).trim(),
      answer: sanitizeInput(newKnowledge.answer).trim(),
      category: sanitizeInput(newKnowledge.category).trim(),
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
          question: sanitizedKnowledge.question,
          answer: sanitizedKnowledge.answer,
          category: sanitizedKnowledge.category,
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
      Question: sanitizeInput(selectedKnowledge.Question).trim(),
      Answer: sanitizeInput(selectedKnowledge.Answer).trim(),
      Category: sanitizeInput(selectedKnowledge.Category).trim(),
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
          question: sanitizedKnowledge.Question,
          answer: sanitizedKnowledge.Answer,
          category: sanitizedKnowledge.Category,
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
    setNewKnowledge((prev) => ({ ...prev, [field]: sanitizeInput(value) }));
  };

  const handleSelectedKnowledgeChange = (field, value) => {
    setSelectedKnowledge((prev) => ({ ...prev, [field]: sanitizeInput(value) }));
  };

  const tabs = [
    { id: "teamOverview", label: "Team Overview", icon: <LuChartBar /> },
    { id: "revaKnowledge", label: "Reva Knowledge", icon: <LuDatabase /> },
    { id: "uploadKnowledgeTest", label: "Upload Knowledge Test", icon: <LuBookOpen /> },
    { id: "uploadBriefing", label: "Upload Briefing", icon: <LuPlus /> },
    { id: "broadcast", label: "Broadcast", icon: <LuMegaphone /> },
  ];

  const MessageBanner = ({ msg }) => {
    if (!msg) return null;
    const isSuccess = msg.startsWith("Success");
    return (
      <div className={`tl-alert ${isSuccess ? "tl-alert--success" : "tl-alert--error"}`} role="alert" aria-live="polite">
        {msg.replace(/^(Success|Failure):\s*/, "")}
      </div>
    );
  };

  const TlPanel = ({ title, subtitle, icon: Icon, children, actions }) => (
    <section className="report-chart-card report-chart-card--agent tl-panel">
      <div className="report-chart-card__accent" aria-hidden="true" />
      <div className="report-chart-card__orb" aria-hidden="true" />
      <header className="report-chart-card__head">
        <div className="report-chart-card__titles">
          <div className="report-chart-card__title-row">
            {Icon && (
              <span className="report-chart-card__icon" aria-hidden="true">
                <Icon />
              </span>
            )}
            <div>
              {subtitle && <span className="report-chart-card__eyebrow">{subtitle}</span>}
              <h3 className="report-chart-card__title">{title}</h3>
            </div>
          </div>
        </div>
        {actions}
      </header>
      <div className="tl-panel__body">{children}</div>
    </section>
  );

  return (
    <ErrorBoundary>
      <div className="app-page reports-page tl-page" role="main" aria-label="Team Leader Section">
        <section className="reports-section tl-page__intro">
          <div className="mgmt-page__head-row">
            <div className="reports-section__head">
              <h2>Team Leader hub</h2>
              <p>Monitor team performance, manage Reva knowledge, briefings, tests, and agent broadcasts.</p>
            </div>
            <div className="mgmt-toolbar__actions">
              {["Super Admin", "Admin", "Manager", "Team Leader"].includes(userType) && (
                <Button variant="secondary" size="sm" onClick={() => navigate("/add-agent")}>
                  Add agent
                </Button>
              )}
              {["Super Admin", "Admin", "Manager"].includes(userType) && (
                <Button variant="primary" size="sm" onClick={() => navigate("/create-user")}>
                  Create user
                </Button>
              )}
            </div>
          </div>
        </section>

        <nav className="tl-tabs" role="tablist" aria-label="Team leader sections">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`tl-tabs__btn ${activeTab === tab.id ? "tl-tabs__btn--active" : ""}`}
              onClick={() => {
                setActiveTab(tab.id);
                if (tab.id === "uploadBriefing") setBriefingMessage("");
                if (tab.id === "broadcast") setBroadcastMessage("");
              }}
              aria-selected={activeTab === tab.id}
              role="tab"
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </nav>

        {activeTab === "teamOverview" && (
          <>
            {loadingTeam ? (
              <div className="tl-panel__body" style={{ textAlign: "center", padding: "var(--space-6)" }}>
                <Spinner /> Loading team data…
              </div>
            ) : teamStats && (
              <div className="tl-kpi-grid">
                <KpiCard accent="teal" label="Avg AI score" value={`${teamStats.avgAIScore}%`} icon={LuChartBar} />
                <KpiCard accent="cyan" label="Total calls" value={String(teamStats.totalCalls)} icon={LuClipboardCheck} />
                <KpiCard accent="amber" label="Avg AHT (min)" value={String(teamStats.avgAHT)} />
                <KpiCard accent="emerald" label="Sentiment" value={teamStats.avgSentiment} />
              </div>
            )}

            <ReportChartCard
              variant="insight"
              icon={LuBanknote}
              title="Loan leads & conversion"
              subtitle={teamStats?.period || "Last 7 days · your team"}
              loading={loanLoading}
              empty={!loanLoading && !loanLeadData}
              chartRef={loanTypeChartRef}
              chartData={loanTypeData}
              height={280}
              stagger={0.05}
              canvasWrapper={false}
            >
              {loanLeadData && (
                <LoanLeadsPanel
                  totals={loanLeadData}
                  donutData={loanTypeData}
                  chartRef={loanTypeChartRef}
                  donutOptions={loanDonutOpts}
                />
              )}
            </ReportChartCard>

            <div className="tl-split">
              <TlPanel title="My team" subtitle={teamStats?.period || "Last 7 days"} icon={LuClipboardCheck}>
                <div className="tl-table-wrap ui-table-wrap ui-table-wrap--stack">
                  <table className="ui-table ui-table--stack-sm">
                    <thead>
                      <tr>
                        <th>Agent</th>
                        <th>Avg score</th>
                        <th>Calls</th>
                        <th>AHT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agents.length > 0 ? (
                        agents.map((agent) => (
                          <tr key={agent.name}>
                            <td data-label="Agent">{sanitizeInput(agent.name)}</td>
                            <td data-label="Avg score">
                              <Badge variant={agent.avgScore > 80 ? "success" : "danger"}>
                                {agent.avgScore}%
                              </Badge>
                            </td>
                            <td data-label="Calls">{agent.calls}</td>
                            <td data-label="AHT">{agent.aht}</td>
                          </tr>
                        ))
                      ) : (
                        <tr><td colSpan={4} style={{ color: "var(--text-muted)" }}>No agents found for your scope.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </TlPanel>

              <TlPanel title="Audit queue" subtitle="Low scores & compliance flags" icon={LuChartBar}>
                <div className="tl-filters">
                  <div>
                    <Label>Agent</Label>
                    <Input
                      type="text"
                      value={filterAgent}
                      onChange={(e) => setFilterAgent(sanitizeInput(e.target.value))}
                      placeholder="Filter by agent…"
                    />
                  </div>
                  <div>
                    <Label>From</Label>
                    <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                  </div>
                  <div>
                    <Label>To</Label>
                    <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                  </div>
                </div>
                <div className="tl-audit-scroll tl-table-wrap ui-table-wrap ui-table-wrap--stack">
                  <table className="ui-table ui-table--stack-sm">
                    <thead>
                      <tr>
                        <th>Call ID</th>
                        <th>Agent</th>
                        <th>Type</th>
                        <th>AI</th>
                        <th>Manual</th>
                        <th className="ui-table__col--hide-sm">Auditor</th>
                        <th>Date</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditQueue.length > 0 ? (
                        auditQueue.map((call, idx) => {
                          const audited = isManuallyAudited(call);
                          const callIdLabel = formatCallId(call.callId);
                          return (
                          <tr key={`${call.fileName}-${idx}`}>
                            <td data-label="Call ID">
                              <span className="ellipsis" title={callIdLabel} style={{ maxWidth: 100, display: "inline-block" }}>
                                {callIdLabel}
                              </span>
                            </td>
                            <td data-label="Agent">{sanitizeInput(call.agentName)}</td>
                            <td data-label="Type">{call.callType}</td>
                            <td data-label="AI">
                              <Badge variant={call.score > 80 ? "success" : "danger"}>{call.score}</Badge>
                            </td>
                            <td data-label="Manual">{audited ? `${parseFloat(call.manualScoring || 0).toFixed(1)}%` : "—"}</td>
                            <td className="ui-table__col--hide-sm" data-label="Auditor">{audited ? sanitizeInput(call.auditorName || "—") : "—"}</td>
                            <td data-label="Date">{call.callDate}</td>
                            <td className="ui-table__cell--actions" data-label="Actions">
                              <Button size="sm" onClick={() => navigate(`/results/${encodeURIComponent(call.fileName)}`)}>
                                Review
                              </Button>
                            </td>
                          </tr>
                          );
                        })
                      ) : (
                        <tr><td colSpan={8} style={{ color: "var(--text-muted)" }}>No calls need auditing.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </TlPanel>
            </div>
          </>
        )}

        {activeTab === "uploadKnowledgeTest" && (
          <TlPanel title="Knowledge test" subtitle="Up to 5 questions for agents" icon={LuBookOpen}>
            <MessageBanner msg={knowledgeMessage} />
            <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-muted)" }}>
              Fill every question with four options and the correct answer. Agents see the latest test from their supervisor.
            </p>
            {questions.map((q, idx) => (
              <div key={idx} className="tl-form-card">
                <Label>Question {idx + 1}</Label>
                <Input
                  type="text"
                  value={q.question}
                  onChange={(e) => handleQuestionChange(idx, "question", e.target.value)}
                  placeholder="Enter question…"
                  style={{ marginBottom: "var(--space-3)" }}
                />
                <div className="tl-question-grid">
                  {q.options.map((opt, optIdx) => (
                    <div key={optIdx}>
                      <Label>Option {optIdx + 1}</Label>
                      <Input
                        type="text"
                        value={opt}
                        onChange={(e) => handleQuestionChange(idx, "option", e.target.value, optIdx)}
                        placeholder={`Option ${optIdx + 1}`}
                      />
                    </div>
                  ))}
                </div>
                <Label style={{ marginTop: "var(--space-3)" }}>Correct answer</Label>
                <Input
                  type="text"
                  value={q.correctAnswer}
                  onChange={(e) => handleQuestionChange(idx, "correctAnswer", e.target.value)}
                  placeholder="Must match one option exactly"
                />
              </div>
            ))}
            <div className="tl-form-actions">
              <Button variant="secondary" onClick={handleAddQuestion} disabled={questions.length >= 5}>
                <LuPlus /> Add question ({questions.length}/5)
              </Button>
              <Button onClick={handleSubmitKnowledgeTest}>Submit test</Button>
              <Button variant="danger" onClick={handleCancelKnowledgeTest}>Cancel</Button>
            </div>
          </TlPanel>
        )}

        {activeTab === "revaKnowledge" && (
          <TlPanel
            title="Reva knowledge base"
            subtitle="Categories for AI assistant"
            icon={LuDatabase}
            actions={(
              <Button
                size="sm"
                onClick={() => {
                  setShowAddKnowledgeForm(true);
                  setKnowledgeBaseMessage("");
                  setNewKnowledge({ question: "", answer: "", category: activeKnowledgeTab });
                }}
              >
                <LuPlus /> Add entry
              </Button>
            )}
          >
            <div className="tl-cat-tabs" role="tablist">
              {revaKnowledgeTabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`tl-cat-tabs__btn ${activeKnowledgeTab === tab ? "tl-cat-tabs__btn--active" : ""}`}
                  onClick={() => { setActiveKnowledgeTab(tab); setKnowledgeBaseMessage(""); }}
                  role="tab"
                  aria-selected={activeKnowledgeTab === tab}
                >
                  {tab}
                </button>
              ))}
            </div>
            <MessageBanner msg={knowledgeBaseMessage} />
            <div className="tl-audit-scroll tl-table-wrap ui-table-wrap ui-table-wrap--stack">
              <table className="ui-table ui-table--stack-sm">
                <thead>
                  <tr>
                    <th className="ui-table__col--hide-sm">ID</th>
                    <th>Question</th>
                    <th>Answer</th>
                    <th className="ui-table__col--hide-sm">Modified by</th>
                    <th>Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {knowledgeCategories[activeKnowledgeTab]?.length > 0 ? (
                    knowledgeCategories[activeKnowledgeTab].map((entry) => (
                      <tr key={entry.ID}>
                        <td className="ui-table__col--hide-sm" data-label="ID">{entry.ID}</td>
                        <td data-label="Question">{sanitizeInput(entry.question)}</td>
                        <td data-label="Answer">{sanitizeInput(entry.answer)}</td>
                        <td className="ui-table__col--hide-sm" data-label="Modified by">{sanitizeInput(entry.modifiedBy)}</td>
                        <td data-label="Date">{entry.modifiedAt ? new Date(entry.modifiedAt).toISOString().split("T")[0] : "—"}</td>
                        <td className="ui-table__cell--actions" data-label="Actions">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setSelectedKnowledge({
                                ID: entry.ID,
                                Question: entry.question,
                                Answer: entry.answer,
                                Category: activeKnowledgeTab,
                              });
                              setShowUpdateKnowledgeForm(true);
                              setKnowledgeBaseMessage("");
                            }}
                          >
                            <LuPencil />
                          </Button>
                          <Button variant="danger" size="sm" onClick={() => handleDeleteKnowledge(entry.ID)}>
                            <LuTrash2 />
                          </Button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr><td colSpan={6} style={{ color: "var(--text-muted)" }}>No entries in this category yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </TlPanel>
        )}

        {activeTab === "uploadBriefing" && (
          <TlPanel title="Daily briefing" subtitle="Visible to your agents" icon={LuFileText}>
            <MessageBanner msg={briefingMessage} />
            <Textarea
              value={briefingContent}
              onChange={(e) => setBriefingContent(sanitizeInput(e.target.value))}
              placeholder="Enter today's briefing for your team…"
              rows={6}
            />
            <div className="tl-form-actions">
              <Button onClick={handleSubmitBriefing}>Submit briefing</Button>
              <Button variant="secondary" onClick={() => { setBriefingContent(""); setBriefingMessage(""); setActiveTab("teamOverview"); }}>
                Cancel
              </Button>
            </div>
          </TlPanel>
        )}

        {activeTab === "broadcast" && (
          <TlPanel title="Broadcast" subtitle="Real-time message to agents" icon={LuMegaphone}>
            <MessageBanner msg={broadcastMessage} />
            <div className="tl-ws-status">
              <span className={`tl-ws-status__dot ${isConnected ? "tl-ws-status__dot--on" : ""}`} aria-hidden="true" />
              {isConnected ? "Live connection active" : "Offline — refresh to reconnect"}
            </div>
            <Textarea
              value={broadcastContent}
              onChange={(e) => setBroadcastContent(sanitizeInput(e.target.value))}
              placeholder="Message all connected agents instantly…"
              rows={6}
            />
            <div className="tl-form-actions">
              <Button onClick={handleSubmitBroadcast} disabled={!isConnected}>Send broadcast</Button>
              <Button variant="secondary" onClick={() => { setBroadcastContent(""); setBroadcastMessage(""); setActiveTab("teamOverview"); }}>
                Cancel
              </Button>
            </div>
          </TlPanel>
        )}

        <Modal open={showAddKnowledgeForm} onClose={() => { setShowAddKnowledgeForm(false); setKnowledgeBaseMessage(""); }}>
          <h3 style={{ color: "var(--text-strong)", marginBottom: "var(--space-4)" }}>
            <LuDatabase style={{ marginRight: 8 }} /> Add New Reva Knowledge Entry
          </h3>
          <MessageBanner msg={knowledgeBaseMessage} />
          <Label>Category</Label>
          <Select
            value={newKnowledge.category}
            onChange={(e) => handleNewKnowledgeChange("category", e.target.value)}
            aria-required="true"
            style={{ marginBottom: "var(--space-3)" }}
          >
            {revaKnowledgeTabs.map((tab) => (
              <option key={tab} value={tab}>{tab}</option>
            ))}
          </Select>
          <Label>Question</Label>
          <Input
            type="text"
            value={newKnowledge.question}
            onChange={(e) => handleNewKnowledgeChange("question", e.target.value)}
            placeholder="Enter question..."
            aria-required="true"
            style={{ marginBottom: "var(--space-3)" }}
          />
          <Label>Answer</Label>
          <Input
            type="text"
            value={newKnowledge.answer}
            onChange={(e) => handleNewKnowledgeChange("answer", e.target.value)}
            placeholder="Enter answer..."
            aria-required="true"
            style={{ marginBottom: "var(--space-4)" }}
          />
          <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
            <Button onClick={handleAddKnowledge} aria-label="Add Knowledge Entry">
              Add Entry
            </Button>
            <Button
              variant="danger"
              onClick={() => { setShowAddKnowledgeForm(false); setNewKnowledge({ question: "", answer: "", category: "" }); setKnowledgeBaseMessage(""); }}
              aria-label="Cancel Add Knowledge Entry"
            >
              Cancel
            </Button>
          </div>
        </Modal>

        <Modal open={showUpdateKnowledgeForm && !!selectedKnowledge} onClose={() => { setShowUpdateKnowledgeForm(false); setKnowledgeBaseMessage(""); }}>
          <h3 style={{ color: "var(--text-strong)", marginBottom: "var(--space-4)" }}>
            <LuDatabase style={{ marginRight: 8 }} /> Update Reva Knowledge Entry
          </h3>
          <MessageBanner msg={knowledgeBaseMessage} />
          {selectedKnowledge && (
            <>
              <Label>Category</Label>
              <Select
                value={selectedKnowledge.Category}
                onChange={(e) => handleSelectedKnowledgeChange("Category", e.target.value)}
                aria-required="true"
                style={{ marginBottom: "var(--space-3)" }}
              >
                {revaKnowledgeTabs.map((tab) => (
                  <option key={tab} value={tab}>{tab}</option>
                ))}
              </Select>
              <Label>Question</Label>
              <Input
                type="text"
                value={selectedKnowledge.Question}
                onChange={(e) => handleSelectedKnowledgeChange("Question", e.target.value)}
                aria-required="true"
                style={{ marginBottom: "var(--space-3)" }}
              />
              <Label>Answer</Label>
              <Input
                type="text"
                value={selectedKnowledge.Answer}
                onChange={(e) => handleSelectedKnowledgeChange("Answer", e.target.value)}
                aria-required="true"
                style={{ marginBottom: "var(--space-4)" }}
              />
              <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
                <Button onClick={handleUpdateKnowledge} aria-label="Update Knowledge Entry">
                  Update Entry
                </Button>
                <Button
                  variant="danger"
                  onClick={() => { setShowUpdateKnowledgeForm(false); setSelectedKnowledge(null); setKnowledgeBaseMessage(""); }}
                  aria-label="Cancel Update Knowledge Entry"
                >
                  Cancel
                </Button>
              </div>
            </>
          )}
        </Modal>
      </div>
    </ErrorBoundary>
  );
};

export default TeamLeaderSection;
