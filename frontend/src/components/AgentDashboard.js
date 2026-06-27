import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Line, Bar } from "react-chartjs-2";
import axios from "axios";
import dayjs from "dayjs";
import {
  LuMessageSquare,
  LuLightbulb,
  LuClock,
  LuHistory,
  LuCircleX,
  LuX,
  LuPhoneCall,
  LuChartLine,
  LuStar,
  LuHeadphones,
  LuSearch,
  LuInbox,
} from "../icons";
import { useChat } from "../context/ChatContext";
import { useWebSocket } from "../context/WebSocketContext";
import ChatBox from "./chat/ChatBox";
import config from "../utils/envConfig";
import {
  PageSection,
  Card,
  Button,
  Badge,
  Skeleton,
  UserAvatar,
} from "./ui";
import ChartPanel from "./ui/ChartPanel";
import StatCard from "./ui/StatCard";
import { baseChartOptions, lineDataset, barDataset } from "../theme/chartTheme";
import "./agent-dashboard-page.css";
import { useAuth } from "../context/AuthContext";

function greetingForHour(hour) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const formatCallId = (callId) => {
  if (callId == null || callId === "") return "—";
  return String(callId);
};

const isManuallyAudited = (call) =>
  call?.hasManualAudit === true || Number(call?.hasManualAudit) === 1 || Boolean(call?.auditorName);

const scoreBadgeVariant = (score) => {
  if (score >= 80) return "success";
  if (score >= 60) return "warning";
  return "danger";
};

const displayScoreForCall = (call) => {
  if (isManuallyAudited(call) && call.manualScore != null) {
    return call.manualScore;
  }
  return call.overallScoring ?? 0;
};

const AgentDashboardContent = () => {
  const { username } = useAuth();
  const { chatSessions, sendMessage, closeChat, toggleMinimize } = useChat();
  const { chatMessages, supervisors } = useWebSocket();
  const [dashboardData, setDashboardData] = useState(null);
  const [agentProfile, setAgentProfile] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState("");
  const [briefingState, setBriefingState] = useState({ text: "", loading: true, error: false, empty: false });
  const [knowledgeQuestions, setKnowledgeQuestions] = useState([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(true);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState([]);
  const [testStatus, setTestStatus] = useState({
    hasSubmitted: false,
    correctAnswers: 0,
    wrongAnswers: 0,
    totalScore: 0,
    answers: [],
  });
  const [showBroadcastPopup, setShowBroadcastPopup] = useState(false);
  const [currentBroadcast, setCurrentBroadcast] = useState(null);
  const [chatPopupVisible, setChatPopupVisible] = useState(false);
  const [currentChatMessages, setCurrentChatMessages] = useState([]);
  const [callSearch, setCallSearch] = useState("");
  const [scoreFilter, setScoreFilter] = useState("all");

  const knowledgeTestRef = useRef(null);

  const displayName = agentProfile?.identity?.displayName || dashboardData?.identity?.displayName || username;
  const greeting = useMemo(() => greetingForHour(new Date().getHours()), []);

  const fetchAgentProfile = useCallback(async () => {
    try {
      const res = await axios.get(`${config.apiBaseUrl}/api/agent-profile`, {
        params: { username },
      });
      if (res.data?.success) setAgentProfile(res.data);
    } catch (err) {
      console.error("Error fetching agent profile:", err.message);
    }
  }, [username]);

  const fetchBriefing = useCallback(async () => {
    setBriefingState((s) => ({ ...s, loading: true, error: false }));
    try {
      const res = await axios.get(`${config.apiBaseUrl}/api/briefing/today-latest`, {
        params: { agentUsername: username },
      });
      if (res.data?.success) {
        setBriefingState({
          text: res.data.briefing || "No briefing available.",
          loading: false,
          error: false,
          empty: Boolean(res.data.empty),
        });
      } else {
        setBriefingState({
          text: "No briefing found.",
          loading: false,
          error: false,
          empty: true,
        });
      }
    } catch (err) {
      console.error("Error fetching today's briefing:", err.message);
      setBriefingState({
        text: "Unable to load briefing right now. Please try again later.",
        loading: false,
        error: true,
        empty: false,
      });
    }
  }, [username]);

  const fetchKnowledgeData = useCallback(async () => {
    setKnowledgeLoading(true);
    try {
      const questionsRes = await axios.get(`${config.apiBaseUrl}/api/knowledge-test-latest`, {
        params: { agentUsername: username },
      });
      if (questionsRes.data?.success) {
        setKnowledgeQuestions(questionsRes.data.questions || []);
      } else {
        setKnowledgeQuestions([]);
      }

      const resultRes = await axios.get(`${config.apiBaseUrl}/api/knowledge-test-result-today`, {
        params: { username },
      });
      if (resultRes.data?.success) {
        const { hasSubmitted, correctAnswers, wrongAnswers, totalScore, answers } = resultRes.data;
        setTestStatus({
          hasSubmitted,
          correctAnswers: correctAnswers || 0,
          wrongAnswers: wrongAnswers || 0,
          totalScore: totalScore || 0,
          answers: answers || [],
        });
        if (hasSubmitted) {
          setSelectedAnswers([]);
          setCurrentQuestionIndex(0);
        }
      }
    } catch (err) {
      console.error("Error fetching knowledge test data:", err.message);
      setKnowledgeQuestions([]);
      setTestStatus({
        hasSubmitted: false,
        correctAnswers: 0,
        wrongAnswers: 0,
        totalScore: 0,
        answers: [],
      });
    } finally {
      setKnowledgeLoading(false);
    }
  }, [username]);

  const fetchDashboardData = useCallback(async () => {
    setDashboardLoading(true);
    setDashboardError("");
    try {
      const res = await axios.get(`${config.apiBaseUrl}/api/agent/dashboard`, {
        params: { username },
      });
      if (res.data?.success) {
        setDashboardData(res.data);
      } else {
        setDashboardError(res.data?.message || "Could not load dashboard data.");
      }
    } catch (err) {
      console.error("Error fetching agent dashboard data:", err.message);
      setDashboardError("Unable to load performance data. Please refresh or try again.");
    } finally {
      setDashboardLoading(false);
    }
  }, [username]);

  useEffect(() => {
    fetchAgentProfile();
    fetchBriefing();
    fetchKnowledgeData();
    fetchDashboardData();
  }, [fetchAgentProfile, fetchBriefing, fetchKnowledgeData, fetchDashboardData]);

  useEffect(() => {
    const relevantMessages = chatMessages.filter(
      (msg) =>
        msg.type === "chat" &&
        (msg.to === username || msg.to === "all") &&
        msg.fromType !== "Agent"
    );
    if (relevantMessages.length > 0) {
      setCurrentChatMessages(relevantMessages);
      setChatPopupVisible(true);
    }
  }, [chatMessages, username]);

  useEffect(() => {
    const agentMessages = chatMessages.filter(
      (msg) => msg.type === "chat" && msg.fromType === "Agent" && (msg.to === username || msg.to === "all")
    );
    if (agentMessages.length > 0) {
      agentMessages.forEach((msg) => {
        if (!chatSessions[msg.from]) {
          sendMessage(msg.from, "");
        }
      });
    }
  }, [chatMessages, username, chatSessions, sendMessage]);

  const handleOptionSelect = (option) => {
    if (testStatus.hasSubmitted) return;
    const newAnswers = [...selectedAnswers];
    newAnswers[currentQuestionIndex] = {
      question: knowledgeQuestions[currentQuestionIndex].question,
      selectedAnswer: option,
    };
    setSelectedAnswers(newAnswers);
  };

  const handleNextQuestion = () => {
    if (testStatus.hasSubmitted || currentQuestionIndex >= knowledgeQuestions.length - 1) return;
    setCurrentQuestionIndex(currentQuestionIndex + 1);
    knowledgeTestRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSubmitTest = async () => {
    if (testStatus.hasSubmitted) return;
    if (!selectedAnswers[currentQuestionIndex]?.selectedAnswer) return;

    try {
      const response = await axios.post(`${config.apiBaseUrl}/api/submit-knowledge-test`, {
        username,
        answers: selectedAnswers,
        createdAt: new Date().toISOString(),
      });

      if (response.data?.success) {
        setTestStatus({
          hasSubmitted: true,
          correctAnswers: response.data.correctAnswers,
          wrongAnswers: response.data.wrongAnswers,
          totalScore: response.data.totalScore,
          answers: selectedAnswers,
        });
        setCurrentQuestionIndex(0);
        setSelectedAnswers([]);
        knowledgeTestRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (err) {
      console.error("Error submitting Knowledge Test:", err.message);
    }
  };

  const scoringLabels = dashboardData?.overallScoring?.map((d) => d.dateStr) || [];
  const scoringValues = dashboardData?.overallScoring?.map((d) => d.avgScore || 0) || [];
  const scoringData = {
    labels: scoringLabels,
    datasets: [lineDataset("Average Score", scoringValues, 0)],
  };
  const scoringOptions = baseChartOptions({
    plugins: { legend: { display: false } },
    scales: {
      x: { ...baseChartOptions().scales.x, title: { display: true, text: "Date" } },
      y: { ...baseChartOptions().scales.y, max: 100, title: { display: true, text: "Score" } },
    },
  });

  const kpiLabels = dashboardData?.kpiMetrics?.map((k) => k.name) || [];
  const kpiValues = dashboardData?.kpiMetrics?.map((k) => k.value) || [];
  const kpiData = {
    labels: kpiLabels,
    datasets: [barDataset("KPI", kpiValues, 0)],
  };
  const kpiOptions = baseChartOptions({
    plugins: { legend: { display: false } },
    scales: {
      y: { ...baseChartOptions().scales.y, max: 100 },
    },
  });

  const formattedLastDay = dashboardData?.lastWorkingDay
    ? dayjs(dashboardData.lastWorkingDay).format("DD-MMM-YYYY")
    : "N/A";
  const aht = dashboardData?.ahtMinutesForLastDay ?? 0;
  const totalCallsLastDay = dashboardData?.totalCallsLastDay ?? 0;
  const callsToday = dashboardData?.callsToday ?? 0;
  const avgScoreToday = dashboardData?.avgScoreToday;
  const totalCallsAllTime = dashboardData?.totalCallsAllTime ?? 0;
  const supervisor = agentProfile?.identity?.supervisor || dashboardData?.identity?.supervisor;

  const filteredCallHistory = useMemo(() => {
    const history = dashboardData?.callHistory || [];
    const query = callSearch.trim().toLowerCase();

    return history.filter((call) => {
      const score = displayScoreForCall(call);
      if (scoreFilter === "high" && score < 80) return false;
      if (scoreFilter === "mid" && (score < 60 || score >= 80)) return false;
      if (scoreFilter === "low" && score >= 60) return false;

      if (!query) return true;

      const dateStr = dayjs(call.callDateTime).format("DD-MM HH:mm").toLowerCase();
      const typeStr = String(call.callType || "").toLowerCase();
      const scoreStr = String(score);
      const callIdStr = formatCallId(call.callId).toLowerCase();
      const auditorStr = String(call.auditorName || "").toLowerCase();
      return (
        dateStr.includes(query)
        || typeStr.includes(query)
        || scoreStr.includes(query)
        || callIdStr.includes(query)
        || auditorStr.includes(query)
      );
    });
  }, [dashboardData?.callHistory, callSearch, scoreFilter]);

  return (
    <div className="app-page reports-page agent-dash" role="main" aria-label="Agent Dashboard">
      {showBroadcastPopup && currentBroadcast && (
        <Card style={{ marginBottom: "var(--space-4)", borderColor: "var(--warning)" }} role="alertdialog" aria-label="Broadcast Message">
          <h3 style={{ color: "var(--text-strong)", marginBottom: 8 }}>
            Broadcast from {currentBroadcast.from}
          </h3>
          <p style={{ color: "var(--text)" }}>{currentBroadcast.text}</p>
          <small style={{ color: "var(--text-muted)" }}>
            {new Date(currentBroadcast.timestamp).toLocaleString()}
          </small>
          <div style={{ marginTop: 12 }}>
            <Button variant="secondary" size="sm" onClick={() => setShowBroadcastPopup(false)} aria-label="Close Broadcast Popup">
              <LuCircleX /> Close
            </Button>
          </div>
        </Card>
      )}

      {chatPopupVisible && (
        <div className="ui-chat-popup">
          <div className="ui-chat-popup__head">
            <h3><LuMessageSquare /> Incoming Messages</h3>
            <button className="ui-chat-popup__close" onClick={() => setChatPopupVisible(false)} aria-label="Close Chat Popup">
              <LuX />
            </button>
          </div>
          <div className="ui-chat-popup__body">
            {currentChatMessages.map((msg, idx) => (
              <div key={idx} className="ui-chat-popup__msg">
                <strong>{msg.from}:</strong> {msg.text}
                <time>{new Date(msg.timestamp).toLocaleString()}</time>
              </div>
            ))}
          </div>
        </div>
      )}

      <section className="agent-dash__hero" aria-label="Welcome">
        <UserAvatar username={username} size="xl" className="agent-dash__hero-avatar" alt={`${displayName} profile`} />
        <div className="agent-dash__hero-text">
          <h1>{greeting}, {displayName}</h1>
          <p>
            Here is your performance snapshot
            {supervisor ? ` · Team lead: ${supervisor}` : ""}.
          </p>
          <div className="agent-dash__hero-meta">
            <Badge variant="accent"><LuHeadphones /> Agent</Badge>
            {agentProfile?.agent?.agent_type && (
              <Badge variant="default">{agentProfile.agent.agent_type}</Badge>
            )}
            {formattedLastDay !== "N/A" && (
              <Badge variant="default">Last active: {formattedLastDay}</Badge>
            )}
          </div>
        </div>
      </section>

      {dashboardError && (
        <Card style={{ borderColor: "var(--danger)" }} role="alert">
          <p style={{ color: "var(--danger)", margin: 0 }}>{dashboardError}</p>
        </Card>
      )}

      {dashboardLoading ? (
        <>
          <div className="agent-dash__skeleton-grid" aria-busy="true" aria-label="Loading stats">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="agent-dash__skeleton-card" />
            ))}
          </div>
          <div className="agent-dash__chart-skeleton-grid" aria-hidden="true">
            <Skeleton className="agent-dash__chart-skeleton" />
            <Skeleton className="agent-dash__chart-skeleton" />
          </div>
          <div className="agent-dash__main-skeleton-grid" aria-hidden="true">
            <Skeleton className="agent-dash__main-skeleton-panel" />
            <Skeleton className="agent-dash__main-skeleton-panel" />
          </div>
        </>
      ) : (
        <>
        <div className="agent-dash__stat-grid">
          <StatCard icon={<LuPhoneCall />} label="Calls Today" value={callsToday} variant="default" />
          <StatCard
            icon={<LuStar />}
            label="Avg Score Today"
            value={avgScoreToday != null ? avgScoreToday : "—"}
            variant="success"
          />
          <StatCard
            icon={<LuClock />}
            label={`Last Day (${formattedLastDay})`}
            value={`${totalCallsLastDay} calls · ${aht}m AHT`}
            variant="default"
          />
          <StatCard icon={<LuChartLine />} label="Total Calls" value={totalCallsAllTime} variant="default" />
          <StatCard
            icon={<LuPhoneCall />}
            label="C-SAT Transfers"
            value={
              dashboardData?.csat
                ? `${dashboardData.csat.transferred || 0}${dashboardData.csat.total ? ` / ${dashboardData.csat.total}` : ""}`
                : "—"
            }
            variant="success"
          />
        </div>

      <div className="ui-chart-grid">
        <ChartPanel
          title="Scoring Trend"
          height={260}
          empty={scoringLabels.length === 0}
          emptyMessage="No scoring data yet — your call scores will appear here after analysis."
        >
          {scoringLabels.length > 0 && (
            <Line data={scoringData} options={scoringOptions} />
          )}
        </ChartPanel>

        <ChartPanel
          title="KPI Metrics"
          height={260}
          empty={kpiLabels.length === 0}
          emptyMessage="KPI metrics will populate once scored calls are available."
        >
          {kpiLabels.length > 0 && (
            <Bar data={kpiData} options={kpiOptions} />
          )}
        </ChartPanel>
      </div>

      <div className="agent-dash__main-grid">
        <PageSection
          className="agent-dash__panel agent-dash__panel--calls"
          title={<><LuHistory style={{ marginRight: 8 }} />Recent Calls</>}
          subtitle="Latest analyzed calls — AI scores; manual audits show auditor score."
          actions={
            dashboardData?.callHistory?.length > 0 ? (
              <div className="agent-dash__filters" role="search">
                <div className="agent-dash__search-wrap">
                  <LuSearch className="agent-dash__search-icon" aria-hidden="true" />
                  <input
                    type="search"
                    className="agent-dash__search"
                    placeholder="Search ID, date, score…"
                    value={callSearch}
                    onChange={(e) => setCallSearch(e.target.value)}
                    aria-label="Search recent calls"
                  />
                </div>
                <select
                  className="agent-dash__filter-select"
                  value={scoreFilter}
                  onChange={(e) => setScoreFilter(e.target.value)}
                  aria-label="Filter by score"
                >
                  <option value="all">All scores</option>
                  <option value="high">80+ (High)</option>
                  <option value="mid">60–79 (Mid)</option>
                  <option value="low">Below 60</option>
                </select>
                <span className="agent-dash__filter-count">
                  {filteredCallHistory.length} shown
                </span>
              </div>
            ) : null
          }
        >
          <div className="agent-dash__panel-body">
            {dashboardData?.callHistory?.length > 0 ? (
              filteredCallHistory.length > 0 ? (
                <div className="agent-dash__table-wrap">
                  <table className="ui-table agent-dash__table agent-dash__table--compact">
                    <thead>
                      <tr>
                        <th>Call ID</th>
                        <th>Date</th>
                        <th>Dur.</th>
                        <th>Score</th>
                        <th>Auditor</th>
                        <th>Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCallHistory.map((call, idx) => {
                        const audited = isManuallyAudited(call);
                        const displayScore = displayScoreForCall(call);
                        const callIdLabel = formatCallId(call.callId);
                        return (
                          <tr key={`${call.callId ?? call.callDateTime}-${idx}`}>
                            <td className="agent-dash__cell-callid">
                              <span className="agent-dash__callid" title={callIdLabel}>
                                {callIdLabel}
                              </span>
                            </td>
                            <td className="agent-dash__cell-date">
                              {dayjs(call.callDateTime).format("DD-MM HH:mm")}
                            </td>
                            <td className="agent-dash__cell-duration">{call.durationSec}s</td>
                            <td className="agent-dash__cell-score">
                              {audited ? (
                                <span className="agent-dash__score-cell">
                                  <Badge variant={scoreBadgeVariant(displayScore)}>
                                    {displayScore}
                                  </Badge>
                                  <Badge variant="default" className="agent-dash__manual-badge">Manual</Badge>
                                </span>
                              ) : (
                                <Badge variant={scoreBadgeVariant(displayScore)}>
                                  {displayScore}
                                </Badge>
                              )}
                            </td>
                            <td className="agent-dash__cell-auditor">
                              {audited ? (call.auditorName || "—") : "—"}
                            </td>
                            <td className="agent-dash__cell-type">{call.callType || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="agent-dash__empty">
                  <LuSearch aria-hidden="true" />
                  <p>No calls match your filters.</p>
                  <Button variant="ghost" size="sm" onClick={() => { setCallSearch(""); setScoreFilter("all"); }}>
                    Clear filters
                  </Button>
                </div>
              )
            ) : (
              <div className="agent-dash__empty">
                <LuInbox aria-hidden="true" />
                <p>No calls recorded yet for your profile.</p>
              </div>
            )}
          </div>
        </PageSection>

        <div className="agent-dash__stack">
          <PageSection
            className="agent-dash__panel agent-dash__panel--briefing"
            title={<><LuMessageSquare style={{ marginRight: 8 }} />Today Briefing</>}
            subtitle="Daily summary from your team lead."
          >
            <div className="agent-dash__panel-body">
              {briefingState.loading ? (
                <Skeleton style={{ height: 80, borderRadius: "var(--radius-md)" }} />
              ) : briefingState.error ? (
                <div className="agent-dash__empty agent-dash__empty--error">
                  <p>{briefingState.text}</p>
                </div>
              ) : briefingState.empty ? (
                <div className="agent-dash__empty">
                  <LuInbox aria-hidden="true" />
                  <p>{briefingState.text}</p>
                </div>
              ) : (
                <div className="agent-dash__content-block">
                  <p className="agent-dash__briefing">{briefingState.text}</p>
                </div>
              )}
            </div>
          </PageSection>

          <PageSection
            className="agent-dash__panel agent-dash__panel--feedback"
            title={<><LuLightbulb style={{ marginRight: 8 }} />Feedback by AI</>}
            subtitle="Coaching tips from your lowest-scoring recent call."
          >
            <div className="agent-dash__panel-body">
              {dashboardData?.lowestScoringFeedback ? (
                <div className="agent-dash__content-block agent-dash__content-block--feedback">
                  <p className="agent-dash__briefing">{dashboardData.lowestScoringFeedback}</p>
                </div>
              ) : (
                <div className="agent-dash__empty">
                  <LuLightbulb aria-hidden="true" />
                  <p>No AI feedback yet — feedback from your lowest-scoring recent call will show here.</p>
                </div>
              )}
            </div>
          </PageSection>

          <PageSection
            className="agent-dash__panel agent-dash__panel--knowledge"
            title={<><LuChartLine style={{ marginRight: 8 }} />Knowledge Test</>}
            subtitle="Complete today's quiz to track your product knowledge."
          >
            <div ref={knowledgeTestRef} className="agent-dash__panel-body agent-dash__knowledge-panel">
              {knowledgeLoading ? (
                <Skeleton className="agent-dash__table-skeleton-row" style={{ height: 120 }} />
              ) : testStatus.hasSubmitted ? (
                <div className="agent-dash__knowledge-results">
                  <p className="agent-dash__knowledge-complete">
                    Today&apos;s Knowledge Test Completed!
                  </p>
                  <div className="agent-dash__knowledge-stats">
                    <StatCard label="Correct" value={testStatus.correctAnswers} variant="success" />
                    <StatCard label="Wrong" value={testStatus.wrongAnswers} variant="danger" />
                    <StatCard label="Score" value={`${testStatus.totalScore}/${knowledgeQuestions.length || 5}`} />
                  </div>
                  <h4 className="agent-dash__knowledge-heading">Your Answers</h4>
                  {testStatus.answers.map((answer, idx) => (
                    <Card key={idx} className="agent-dash__answer-card">
                      <p className="agent-dash__answer-question">
                        {idx + 1}. {answer.question}
                      </p>
                      <p className={
                        answer.selectedAnswer === knowledgeQuestions[idx]?.correctAnswer
                          ? "agent-dash__answer-correct"
                          : "agent-dash__answer-wrong"
                      }>
                        Your answer: {answer.selectedAnswer}
                      </p>
                      {knowledgeQuestions[idx]?.correctAnswer && (
                        <p className="agent-dash__answer-ref">
                          Correct: {knowledgeQuestions[idx].correctAnswer}
                        </p>
                      )}
                    </Card>
                  ))}
                </div>
              ) : knowledgeQuestions.length > 0 ? (
                <div className="agent-dash__knowledge-quiz">
                  <div className="agent-dash__quiz-progress">
                    Question {currentQuestionIndex + 1} of {knowledgeQuestions.length}
                  </div>
                  <h4 className="agent-dash__quiz-question">
                    {knowledgeQuestions[currentQuestionIndex]?.question}
                  </h4>
                  <div className="agent-dash__quiz-options">
                    {knowledgeQuestions[currentQuestionIndex]?.options.map((option, optIdx) => (
                      <Button
                        key={optIdx}
                        variant={
                          selectedAnswers[currentQuestionIndex]?.selectedAnswer === option
                            ? "primary" : "secondary"
                        }
                        onClick={() => handleOptionSelect(option)}
                        style={{ justifyContent: "flex-start", textAlign: "left" }}
                        aria-label={`Select option ${option}`}
                      >
                        {String.fromCharCode(97 + optIdx)}. {option}
                      </Button>
                    ))}
                  </div>
                  {currentQuestionIndex < knowledgeQuestions.length - 1 ? (
                    <Button
                      onClick={handleNextQuestion}
                      disabled={!selectedAnswers[currentQuestionIndex]?.selectedAnswer}
                    >
                      Next
                    </Button>
                  ) : (
                    <Button
                      onClick={handleSubmitTest}
                      disabled={!selectedAnswers[currentQuestionIndex]?.selectedAnswer}
                    >
                      Submit
                    </Button>
                  )}
                </div>
              ) : (
                <div className="agent-dash__empty">
                  <LuChartLine aria-hidden="true" />
                  <p>No knowledge test published today. Check back when your team lead uploads one.</p>
                </div>
              )}
            </div>
          </PageSection>
        </div>
      </div>
        </>
      )}

      <ChatBox
        username={username}
        chatSessions={chatSessions}
        sendMessage={sendMessage}
        closeChat={closeChat}
        toggleMinimize={toggleMinimize}
        supervisors={supervisors}
      />
    </div>
  );
};

export default AgentDashboardContent;
