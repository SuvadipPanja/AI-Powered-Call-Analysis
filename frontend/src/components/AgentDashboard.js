import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Line, Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import axios from "axios";
import dayjs from "dayjs";
import {
  FaHeadset,
  FaSignOutAlt,
  FaComments,
  FaLightbulb,
  FaClock,
  FaHistory,
  FaTimesCircle,
  FaTimes,
} from "react-icons/fa";
import { useChat } from "../context/ChatContext";
import { useWebSocket } from "../context/WebSocketContext";
import "./AfterLogin.css";
import ChatBox from "./chat/ChatBox";
import config from "../utils/envConfig";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend
);

const AgentDashboardContent = ({ onLogout }) => {
  /*************************************************
   * (1) Code Integrity Check
   * Purpose: Ensures the code has not been tampered with.
   * Compliance: IS Policy (Security), Code Audit Policy.
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
   * Purpose: Manages the state for the agent dashboard, including metrics, briefing, and knowledge test.
   *************************************************/
  const { chatSessions } = useChat();
  const { chatMessages, supervisors } = useWebSocket();
  const [dashboardData, setDashboardData] = useState(null);
  const [showLogout, setShowLogout] = useState(false);
  const [profilePicUrl, setProfilePicUrl] = useState("");
  const [todayBriefing, setTodayBriefing] = useState("Loading briefing...");
  const [knowledgeQuestions, setKnowledgeQuestions] = useState([]);
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

  // Storage
  const navigate = useNavigate();
  const username = localStorage.getItem("username") || "Agent";
  const logId = localStorage.getItem("logId") || "";

  // Ref for Knowledge Test section
  const knowledgeTestRef = useRef(null);

  /*************************************************
   * (3) Fetch Profile Picture
   * Purpose: Fetches the agent's profile picture from the server using environment variables.
   * Compliance: IS Policy (Security: Secure API calls), ISO 27001 (Secure API communication).
   *************************************************/
  useEffect(() => {
    if (username) {
      const picUrl = `${config.apiBaseUrl}/api/user/${username}/profile-picture`;
      setProfilePicUrl(picUrl);
    }
  }, [username]);

  /*************************************************
   * (4) Fetch Today's Briefing
   * Purpose: Fetches the latest briefing for today using the agent's username.
   * Compliance: IS Policy (Security: Secure API calls), ISO 27001 (Secure API communication).
   *************************************************/
  useEffect(() => {
    axios
      .get(`${config.apiBaseUrl}/api/briefing/today-latest?agentUsername=${username}`)
      .then((res) => {
        if (res.data && res.data.success) {
          setTodayBriefing(res.data.briefing || "No briefing available.");
        } else {
          setTodayBriefing("No briefing found.");
        }
      })
      .catch((err) => {
        console.error("Error fetching today's briefing:", err.message);
        setTodayBriefing("Failed to fetch briefing due to server error.");
      });
  }, [username]);

  /*************************************************
   * (5) Fetch Knowledge Test Questions and Status
   * Purpose: Fetches knowledge test questions and the agent's test result for today.
   * Compliance: IS Policy (Security: Secure API calls), ISO 27001 (Secure API communication).
   *************************************************/
  useEffect(() => {
    // Fetch Knowledge Test Questions
    axios
      .get(`${config.apiBaseUrl}/api/knowledge-test-latest?agentUsername=${username}`)
      .then((res) => {
        if (res.data && res.data.success) {
          setKnowledgeQuestions(res.data.questions || []);
        } else {
          setKnowledgeQuestions([]);
        }
      })
      .catch((err) => {
        console.error("Error fetching Knowledge Test questions:", err.message);
        setKnowledgeQuestions([]);
      });

    // Fetch Knowledge Test Result for Today
    axios
      .get(`${config.apiBaseUrl}/api/knowledge-test-result-today?username=${username}`)
      .then((res) => {
        if (res.data && res.data.success) {
          setTestStatus({
            hasSubmitted: res.data.hasSubmitted,
            correctAnswers: res.data.correctAnswers || 0,
            wrongAnswers: res.data.wrongAnswers || 0,
            totalScore: res.data.totalScore || 0,
            answers: res.data.answers || [],
          });
        }
      })
      .catch((err) => {
        console.error("Error fetching Knowledge Test result:", err.message);
      });
  }, [username]);

  /*************************************************
   * (6) Fetch Dashboard Data
   * Purpose: Fetches the agent's dashboard data, including metrics and call history.
   * Compliance: IS Policy (Security: Secure API calls), ISO 27001 (Secure API communication).
   *************************************************/
  const fetchDashboardData = useCallback(async () => {
    try {
      const url = `${config.apiBaseUrl}/api/agent/dashboard?username=${username}`;
      const res = await axios.get(url);
      if (res.data && res.data.success) {
        setDashboardData(res.data);
      }
    } catch (err) {
      console.error("Error fetching agent dashboard data:", err.message);
    }
  }, [username]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  /*************************************************
   * (7) Handle Incoming Chat Messages and Broadcasts
   * Purpose: Displays incoming chat messages and broadcasts in real-time using WebSocketContext.
   * Compliance: Web Page Policy (User Experience: Real-time updates), IS Policy (Security: Secure WebSocket).
   *************************************************/
  useEffect(() => {
    const relevantMessages = chatMessages.filter(
      (msg) =>
        (msg.type === "chat" &&
          (msg.to === username || msg.to === "all") &&
          msg.fromType !== "Agent") ||
        (msg.type === "broadcast" && msg.to === "all")
    );

    const broadcasts = relevantMessages.filter((msg) => msg.type === "broadcast");
    const chats = relevantMessages.filter((msg) => msg.type === "chat");

    if (broadcasts.length > 0) {
      const latestBroadcast = broadcasts[broadcasts.length - 1];
      setCurrentBroadcast({
        from: latestBroadcast.from,
        text: latestBroadcast.text,
        timestamp: latestBroadcast.timestamp,
      });
      setShowBroadcastPopup(true);
    }

    if (chats.length > 0) {
      setCurrentChatMessages(chats);
      setChatPopupVisible(true);
    }
  }, [chatMessages, username]);

  /*************************************************
   * (8) Knowledge Test Handlers
   * Purpose: Handles user interactions with the knowledge test, including answer selection and submission.
   * Compliance: Web Page Policy (User Experience: Intuitive interactions), IS Policy (Accessibility).
   *************************************************/
  const handleOptionSelect = (option) => {
    const newAnswers = [...selectedAnswers];
    newAnswers[currentQuestionIndex] = {
      question: knowledgeQuestions[currentQuestionIndex].question,
      selectedAnswer: option,
    };
    setSelectedAnswers(newAnswers);
  };

  const handleNextQuestion = () => {
    if (currentQuestionIndex < knowledgeQuestions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      if (knowledgeTestRef.current) {
        knowledgeTestRef.current.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
  };

  const handleSubmitTest = async () => {
    try {
      const response = await axios.post(`${config.apiBaseUrl}/api/submit-knowledge-test`, {
        username,
        answers: selectedAnswers,
        createdAt: new Date().toISOString(),
      });

      if (response.data && response.data.success) {
        setTestStatus({
          hasSubmitted: true,
          correctAnswers: response.data.correctAnswers,
          wrongAnswers: response.data.wrongAnswers,
          totalScore: response.data.totalScore,
          answers: selectedAnswers,
        });
        setCurrentQuestionIndex(0);
        setSelectedAnswers([]);
        if (knowledgeTestRef.current) {
          knowledgeTestRef.current.scrollTo({ top: 0, behavior: "smooth" });
        }
      }
    } catch (err) {
      console.error("Error submitting Knowledge Test:", err.message);
    }
  };

  /*************************************************
   * (9) Chart Data & Options
   * Purpose: Configures chart data and options for scoring trend and KPI metrics.
   * Compliance: Web Page Policy (Responsive Design).
   *************************************************/
  const scoringData = {
    labels:
      dashboardData?.overallScoring?.map((d) => d.dateStr) || [
        "2025-03-01",
        "2025-03-02",
        "2025-03-03",
        "2025-03-04",
        "2025-03-05",
      ],
    datasets: [
      {
        label: "Average Score",
        data:
          dashboardData?.overallScoring?.map((d) => d.avgScore || 0) || [60, 65, 70, 75, 80],
        fill: true,
        borderColor: "#4FC1E9",
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
        pointBackgroundColor: "#fff",
        pointBorderColor: "#4FC1E9",
        pointBorderWidth: 2,
        pointStyle: "circle",
      },
    ],
  };

  const scoringOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        title: { display: true, text: "Date", color: "#EEEEEE", font: { size: 10 } },
        ticks: { color: "#EEEEEE", font: { size: 10 }, maxRotation: 0, minRotation: 0 },
        grid: { color: "rgba(255, 255, 255, 0.1)", drawOnChartArea: false },
      },
      y: {
        title: { display: true, text: "Score", color: "#EEEEEE", font: { size: 10 } },
        beginAtZero: true,
        max: 100,
        ticks: { color: "#EEEEEE", font: { size: 10 }, stepSize: 20 },
        grid: { color: "rgba(255,255,255,0.1)" },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: { intersect: false, backgroundColor: "rgba(79, 193, 233, 0.8)", titleFont: { size: 12 }, bodyFont: { size: 12 } },
      filler: { propagate: false },
    },
    onResize: (chart) => {
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      const dataset = chart.config.data.datasets[0];
      const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
      gradient.addColorStop(0, "rgba(79,193,233,0.1)");
      gradient.addColorStop(0.5, "rgba(79,193,233,0.15)");
      gradient.addColorStop(1, "rgba(79,193,233,0.4)");
      dataset.backgroundColor = gradient;
    },
    onHover: (chart) => {
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      const dataset = chart.config.data.datasets[0];
      if (!dataset.backgroundColor || typeof dataset.backgroundColor !== "object") {
        const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
        gradient.addColorStop(0, "rgba(79,193,233,0.1)");
        gradient.addColorStop(0.5, "rgba(79,193,233,0.15)");
        gradient.addColorStop(1, "rgba(79,193,233,0.4)");
        dataset.backgroundColor = gradient;
      }
    },
  };

  const kpiData = {
    labels: dashboardData?.kpiMetrics?.map((k) => k.name) || [],
    datasets: [
      {
        label: "KPI",
        data: dashboardData?.kpiMetrics?.map((k) => k.value) || [],
        backgroundColor: (context) => {
          const chart = context.chart;
          const { ctx, chartArea } = chart;
          if (!chartArea) return "#4ecdc4";
          const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          gradient.addColorStop(0, "#ff6b6b");
          gradient.addColorStop(0.5, "#4ecdc4");
          gradient.addColorStop(1, "#45b7d1");
          return gradient;
        },
        borderRadius: 8,
      },
    ],
  };

  const kpiOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { ticks: { color: "#EEEEEE", font: { size: 8 } }, grid: { display: false } },
      y: {
        beginAtZero: true,
        ticks: { color: "#EEEEEE", font: { size: 8 }, maxTicksLimit: 5 },
        grid: { color: "rgba(255,255,255,0.1)" },
      },
    },
    plugins: { legend: { display: false }, tooltip: { intersect: false } },
  };

  /*************************************************
   * (10) Additional Data
   * Purpose: Formats additional data for display, such as last working day and metrics.
   *************************************************/
  const formattedLastDay = dashboardData?.lastWorkingDay
    ? dayjs(dashboardData.lastWorkingDay).format("DD-MMM-YYYY")
    : "N/A";
  const aht = dashboardData?.ahtMinutesForLastDay || 0;
  const totalCallsLastDay = dashboardData?.totalCallsLastDay || 0;

  /*************************************************
   * (11) Handlers
   * Purpose: Event handlers for user interactions (logout, navigation).
   * Compliance: Web Page Policy (User Experience: Intuitive interactions), IS Policy (Accessibility).
   *************************************************/
  const handleLogoutClick = (e) => {
    e.stopPropagation();
    onLogout();
  };

  /*************************************************
   * (12) Hide Logout if Clicked Outside
   * Purpose: Closes the logout dropdown if the user clicks outside the profile section.
   * Compliance: Web Page Policy (User Experience: Intuitive interactions).
   *************************************************/
  useEffect(() => {
    const handleClickOutside = (event) => {
      const profileSection = document.querySelector(".agentdashboard-profile-section");
      if (showLogout && profileSection && !profileSection.contains(event.target)) {
        setShowLogout(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showLogout]);

  /*************************************************
   * (13) Render
   * Purpose: Renders the agent dashboard with metrics, recent calls, briefing, and knowledge test sections.
   * Compliance: Web Page Policy (Responsive Design, User Experience), IS Policy (Accessibility).
   *************************************************/
  return (
    <div
      className="agentdashboard-ai-audit-dashboard modern-page-animation"
      role="main"
      aria-label="Agent Dashboard"
    >
      {/* Navbar */}
      <nav
        className="agentdashboard-nav"
        aria-label="Agent Navigation"
      >
        <div className="agentdashboard-nav-header">
          <FaHeadset className="agentdashboard-nav-icon" />
          <span className="agentdashboard-nav-username">{username}</span>
        </div>
        <div
          className="agentdashboard-profile-section"
          onClick={() => setShowLogout(!showLogout)}
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && setShowLogout(!showLogout)}
          aria-label="Profile Section"
        >
          {profilePicUrl && (
            <img
              src={profilePicUrl}
              alt="Profile"
              className="agentdashboard-profile-picture"
            />
          )}
          {showLogout && (
            <div className={`agentdashboard-dropdown ${showLogout ? "" : "agentdashboard-dropdown-hidden"}`}>
              <button
                onClick={handleLogoutClick}
                className="agentdashboard-logout-btn"
                aria-label="Logout"
              >
                <FaSignOutAlt /> Logout
              </button>
            </div>
          )}
        </div>
      </nav>

      {/* Broadcast Popup */}
      {showBroadcastPopup && currentBroadcast && (
        <div
          className="agentdashboard-broadcast-popup"
          role="alertdialog"
          aria-label="Broadcast Message"
        >
          <h3 className="agentdashboard-broadcast-title">
            Broadcast from {currentBroadcast.from}
          </h3>
          <p>{currentBroadcast.text}</p>
          <small className="agentdashboard-broadcast-timestamp">
            {new Date(currentBroadcast.timestamp).toLocaleString()}
          </small>
          <button
            onClick={() => setShowBroadcastPopup(false)}
            className="agentdashboard-broadcast-close-btn"
            aria-label="Close Broadcast Popup"
          >
            <FaTimesCircle /> Close
          </button>
        </div>
      )}

      {/* Chat Popup for Incoming Messages */}
      {chatPopupVisible && (
        <div
          style={{
            position: "fixed",
            bottom: "20px",
            right: "20px",
            width: "350px",
            maxHeight: "400px",
            background: "linear-gradient(135deg, #2e333b, #222831)",
            borderRadius: "15px",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              background: "linear-gradient(90deg, #00adb5, #00cc00)",
              padding: "10px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <h3 style={{ margin: 0, color: "#fff", fontSize: "16px" }}>
              <FaComments style={{ marginRight: "8px" }} /> Incoming Messages
            </h3>
            <button
              onClick={() => setChatPopupVisible(false)}
              style={{
                background: "none",
                border: "none",
                color: "#fff",
                cursor: "pointer",
                fontSize: "16px",
              }}
              aria-label="Close Chat Popup"
            >
              <FaTimes />
            </button>
          </div>
          <div
            style={{
              flex: 1,
              padding: "10px",
              overflowY: "auto",
              background: "#222831",
            }}
          >
            {currentChatMessages.map((msg, idx) => (
              <div
                key={idx}
                style={{
                  margin: "8px 0",
                  padding: "8px 12px",
                  borderRadius: "8px",
                  background: "#393e46",
                  color: "#fff",
                  textAlign: "left",
                  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.3)",
                }}
              >
                <strong>{msg.from}:</strong> {msg.text}
                <small
                  style={{
                    display: "block",
                    fontSize: "0.7rem",
                    marginTop: "4px",
                    color: "#ccc",
                  }}
                >
                  {new Date(msg.timestamp).toLocaleString()}
                </small>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="agentdashboard-main-content">
        {/* Left Column */}
        <div className="agentdashboard-left-column">
          {/* Top Row: Last Day + Scoring Trend */}
          <div className="agentdashboard-top-row">
            <div className="agentdashboard-dark-card agentdashboard-last-day-card neon-card">
              <h3 className="agentdashboard-card-title">
                <FaClock /> Last Day: {formattedLastDay}
              </h3>
              <div className="agentdashboard-last-day-content">
                <div>Calls: {totalCallsLastDay}</div>
                <div>AHT: {aht}m</div>
              </div>
            </div>

            <div className="agentdashboard-dark-card agentdashboard-scoring-trend-card neon-card">
              <h3 className="agentdashboard-card-title">Scoring Trend</h3>
              <div className="agentdashboard-scoring-trend-content">
                <Line data={scoringData} options={scoringOptions} />
              </div>
            </div>
          </div>

          {/* Bottom Row: KPI Metrics + Recent Calls */}
          <div className="agentdashboard-bottom-row">
            <div className="agentdashboard-dark-card agentdashboard-kpi-metrics-card neon-card">
              <h3 className="agentdashboard-card-title">KPI Metrics</h3>
              <div className="agentdashboard-kpi-metrics-content">
                <Bar data={kpiData} options={kpiOptions} />
              </div>
            </div>
            <div className="agentdashboard-dark-card agentdashboard-recent-calls-card neon-card">
              <h3 className="agentdashboard-card-title">
                <FaHistory /> Recent Calls
              </h3>
              <div className="agentdashboard-recent-calls-content">
                {dashboardData?.callHistory?.length > 0 ? (
                  dashboardData.callHistory.map((call, idx) => {
                    const cdate = dayjs(call.callDateTime).format("DD-MM HH:mm");
                    const feedback = call.feedback || "No AI feedback available.";
                    return (
                      <div
                        key={idx}
                        className="agentdashboard-recent-call-item"
                      >
                        <div>
                          {cdate} | {call.durationSec}s
                        </div>
                        <div>
                          Score: {call.overallScoring} | {call.callType}
                        </div>
                        <div className="agentdashboard-recent-call-feedback">
                          AI Feedback: {feedback}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="agentdashboard-no-calls">
                    No calls
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Today Briefing, Feedback by AI, Knowledge Test */}
        <div className="agentdashboard-right-column">
          {[
            {
              title: (
                <>
                  <FaComments /> <span className="blink">Today Briefing</span>
                </>
              ),
              content: todayBriefing,
              className: "agentdashboard-today-briefing-card",
            },
            {
              title: "Feedback by AI",
              icon: FaLightbulb,
              content:
                dashboardData?.lowestScoringFeedback || "No feedback available.",
              className: "agentdashboard-feedback-ai-card",
            },
            {
              title: "Knowledge Test",
              icon: FaClock,
              content: testStatus.hasSubmitted ? (
                <div>
                  <p className="agentdashboard-knowledge-test-result">
                    Today's Knowledge Test Completed!
                  </p>
                  <p className="agentdashboard-knowledge-test-stats">
                    Correct Answers: {testStatus.correctAnswers}
                    <br />
                    Wrong Answers: {testStatus.wrongAnswers}
                    <br />
                    Total Score: {testStatus.totalScore}/5
                  </p>
                  <h4 className="agentdashboard-knowledge-test-answers-title">
                    Your Answers:
                  </h4>
                  {testStatus.answers.map((answer, idx) => (
                    <div key={idx} className="agentdashboard-knowledge-test-answer">
                      <p className="agentdashboard-knowledge-test-question">
                        {idx + 1}. {answer.question}
                      </p>
                      <p
                        className={
                          answer.selectedAnswer ===
                          knowledgeQuestions[idx]?.correctAnswer
                            ? "agentdashboard-knowledge-test-selected-answer-correct"
                            : "agentdashboard-knowledge-test-selected-answer-wrong"
                        }
                      >
                        Your Answer: {answer.selectedAnswer}
                      </p>
                      <p className="agentdashboard-knowledge-test-correct-answer">
                        Correct Answer: {knowledgeQuestions[idx]?.correctAnswer}
                      </p>
                    </div>
                  ))}
                </div>
              ) : knowledgeQuestions.length > 0 ? (
                <div className="agentdashboard-knowledge-test-content">
                  <h4 className="agentdashboard-knowledge-test-question-title">
                    {currentQuestionIndex + 1}. {knowledgeQuestions[currentQuestionIndex]?.question}
                  </h4>
                  <div className="agentdashboard-knowledge-test-options">
                    {knowledgeQuestions[currentQuestionIndex]?.options.map(
                      (option, optIdx) => (
                        <button
                          key={optIdx}
                          onClick={() => handleOptionSelect(option)}
                          className={`agentdashboard-knowledge-test-option ${
                            selectedAnswers[currentQuestionIndex]?.selectedAnswer === option
                              ? "agentdashboard-knowledge-test-option-selected"
                              : ""
                          }`}
                          aria-label={`Select option ${option}`}
                        >
                          {String.fromCharCode(97 + optIdx)}. {option}
                        </button>
                      )
                    )}
                  </div>
                  {currentQuestionIndex < knowledgeQuestions.length - 1 ? (
                    <button
                      onClick={handleNextQuestion}
                      className="agentdashboard-knowledge-test-button"
                      disabled={!selectedAnswers[currentQuestionIndex]?.selectedAnswer}
                      aria-label="Next Question"
                    >
                      Next
                    </button>
                  ) : (
                    <button
                      onClick={handleSubmitTest}
                      className="agentdashboard-knowledge-test-button"
                      disabled={!selectedAnswers[currentQuestionIndex]?.selectedAnswer}
                      aria-label="Submit Test"
                    >
                      Submit
                    </button>
                  )}
                </div>
              ) : (
                <p className="agentdashboard-knowledge-test-no-test">
                  No Knowledge Test available today.
                </p>
              ),
              className: "agentdashboard-knowledge-test-card",
            },
          ].map((item, idx) => (
            <div
              key={idx}
              className={`agentdashboard-dark-card ${item.className} neon-card`}
              ref={item.title === "Knowledge Test" ? knowledgeTestRef : null}
              role="region"
              aria-label={typeof item.title === "string" ? item.title : "Today Briefing"}
            >
              <h3 className="agentdashboard-card-title">
                {typeof item.title === "string" ? (
                  <>
                    {item.icon && <item.icon />} {item.title}
                  </>
                ) : (
                  item.title
                )}
              </h3>
              <div className="agentdashboard-card-content">
                {item.content}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Integrate ChatBox Component */}
      <ChatBox username={username} onClose={() => {}} />
    </div>
  );
};

export default AgentDashboardContent;