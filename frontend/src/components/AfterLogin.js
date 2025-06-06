/*
 * Author: $Panja
 * Create Date: 12-12-2024
 * Modified Date: 04-26-2025
 * Purpose: Displays the dashboard with metrics, reports, statistics, and recent activity for call center analytics.
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  FaInfoCircle,
  FaCloudUploadAlt,
  FaCog,
  FaUser,
  FaSignOutAlt,
  FaUserFriends,
  FaCheckCircle,
  FaTimesCircle,
  FaSpinner,
  FaUserShield,
  FaChartBar,
  FaTachometerAlt,
  FaArrowUp,
  FaArrowDown,
  FaRedo,
  FaSyncAlt,
  FaComments,
  FaTimes,
  FaUsers,
} from "react-icons/fa";
import { MdDashboard } from "react-icons/md";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar, Doughnut } from "react-chartjs-2";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import "./AfterLogin.css";
import { useWebSocket } from "../context/WebSocketContext";
import config from "../utils/envConfig";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

const AfterLogin = ({ username, onLogout, isAuthenticated = true, userType }) => {
  /************************************************
   * (1) Code Integrity & Security
   * Purpose: Ensures the code has not been tampered with.
   * Compliance: IS Policy (Security), Code Audit Policy.
   ************************************************/
  const signature = "$Panja";
  const verifySignature = (sig) => {
    if (sig !== "$Panja") {
      throw new Error("Signature mismatch: Code integrity compromised");
    }
  };
  verifySignature(signature);

  const navigate = useNavigate();
  const { chatMessages, supervisors } = useWebSocket();

  /************************************************
   * (2) State - Updated for Multiple Chats and Metrics Section with Success/Fail Counts
   * Purpose: Manages the state for the dashboard, including metrics, charts, and recent activity.
   ************************************************/
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [profilePicUrl, setProfilePicUrl] = useState("");
  const [tlList, setTlList] = useState([]);
  const [tlLoading, setTlLoading] = useState(false);
  const [locationList, setLocationList] = useState([]);
  const [metricsFetchFailed, setMetricsFetchFailed] = useState(false);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState(null);
  const [selectedLocation, setSelectedLocation] = useState("All");
  const [selectedTL, setSelectedTL] = useState("All");
  const [dateRange, setDateRange] = useState("1 Month");
  const [customFromDate, setCustomFromDate] = useState(null);
  const [customToDate, setCustomToDate] = useState(null);
  const [appliedFilters, setAppliedFilters] = useState({
    location: "All",
    tl: "All",
    dateRange: "1 Month",
    customFromDate: null,
    customToDate: null,
  });
  const [isFilterApplied, setIsFilterApplied] = useState(false);
  const [totalCallsProcessed, setTotalCallsProcessed] = useState(0);
  const [avgAiScoring, setAvgAiScoring] = useState(0);
  const [avgManualScoring, setAvgManualScoring] = useState(0);
  const [aht, setAht] = useState(0);
  const [successCount, setSuccessCount] = useState(0); // State for success count
  const [failedCount, setFailedCount] = useState(0);  // State for failed count
  const [prevPeriodData, setPrevPeriodData] = useState({ 
    totalCallsProcessed: 0, 
    avgAiScoring: 0, 
    avgManualScoring: 0, 
    aht: 0,
    successCount: 0,
    failedCount: 0
  });
  const [chatPopupVisible, setChatPopupVisible] = useState(false);
  const [currentChatMessages, setCurrentChatMessages] = useState([]);

  // Existing Chart Data States
  const [toneData, setToneData] = useState({
    labels: ["Positive", "Neutral", "Negative"],
    datasets: [
      {
        label: "AI Tone Analysis (Last 7 Days)",
        data: [0, 0, 0],
        backgroundColor: ["#00adb5", "#ffa500", "#ff5722"],
      },
    ],
  });

  const [agentWiseData, setAgentWiseData] = useState({
    labels: [],
    datasets: [
      {
        label: "Agent-Wise AI Scoring",
        data: [],
        backgroundColor: "#FF5722",
      },
    ],
  });

  const [dailyDurationData, setDailyDurationData] = useState({
    labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    datasets: [
      {
        label: "Daily Call Duration (mins)",
        data: [],
        borderColor: "#00adb5",
        backgroundColor: "#00adb5",
      },
    ],
  });

  const [inboundWeekly, setInboundWeekly] = useState({
    labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    datasets: [
      {
        label: "Inbound Calls",
        data: [],
        backgroundColor: "#f48fb1",
      },
    ],
  });
  const [outboundWeekly, setOutboundWeekly] = useState({
    labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    datasets: [
      {
        label: "Outbound Calls",
        data: [],
        backgroundColor: "#2196f3",
      },
    ],
  });

  // Recent Activity States
  const [recentCalls, setRecentCalls] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);

  /************************************************
   * (3) Helper Functions
   * Purpose: Utility functions for date range filtering and data fetching.
   ************************************************/
  const applyDateRangeFilter = (endDate, range) => {
  const currentDate = new Date(); // Use the current date for "Today"
  let startDate;
  switch (range) {
    case "Today":
      startDate = new Date(currentDate);
      startDate.setHours(0, 0, 0, 0); // Start of the day
      endDate = new Date(currentDate);
      endDate.setHours(23, 59, 59, 999); // End of the day
      break;
    case "1 Week":
      startDate = new Date(endDate);
      startDate.setDate(endDate.getDate() - 7);
      break;
    case "1 Month":
      startDate = new Date(endDate);
      startDate.setMonth(endDate.getMonth() - 1);
      break;
    case "Custom":
      return { from: null, to: null };
    default:
      startDate = new Date(endDate);
      startDate.setMonth(endDate.getMonth() - 1);
  }
  return { from: startDate, to: endDate };
};

  const fetchTlList = useCallback(async (location) => {
    setTlLoading(true);
    try {
      const url = location && location !== "All"
        ? `${config.apiBaseUrl}/api/team-leaders?location=${encodeURIComponent(location)}`
        : `${config.apiBaseUrl}/api/team-leaders`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch team leaders: HTTP error! Status: ${response.status}`);
      }
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error("Response is not JSON: " + contentType);
      }
      const data = await response.json();
      if (data.success) {
        setTlList(data.teamLeaders || []);
      } else {
        console.error("Failed to fetch team leaders:", data.message);
        setTlList([]);
      }
    } catch (err) {
      console.error("Failed to fetch TL list:", err);
      setTlList([]);
    } finally {
      setTlLoading(false);
    }
  }, []);

  const fetchLocationList = useCallback(async () => {
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/locations`);
      if (!response.ok) {
        throw new Error(`Failed to fetch locations: HTTP error! Status: ${response.status}`);
      }
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error("Response is not JSON: " + contentType);
      }
      const data = await response.json();
      if (data.success) {
        setLocationList(data.locations || []);
      } else {
        console.error("Failed to fetch locations:", data.message);
      }
    } catch (err) {
      console.error("Failed to fetch location list:", err);
    }
  }, []);

  useEffect(() => {
    fetchTlList(selectedLocation);
    setSelectedTL("All");
  }, [selectedLocation, fetchTlList]);

  const fetchMetrics = useCallback(async (filters, retryCount = 0) => {
  const maxRetries = 3;
  setMetricsLoading(true);
  setMetricsError(null);
  setMetricsFetchFailed(false);
  try {
    let endDate;
    const currentDate = new Date(); // Current date for validation
    try {
      const recentDateResponse = await fetch(`${config.apiBaseUrl}/api/most-recent-call-date`);
      if (!recentDateResponse.ok) {
        throw new Error(`Failed to fetch most recent call date: HTTP error! Status: ${recentDateResponse.status}`);
      }
      const contentType = recentDateResponse.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error("Response is not JSON: " + contentType);
      }
      const recentDateData = await recentDateResponse.json();
      if (!recentDateData.success) {
        throw new Error("Failed to fetch most recent call date: " + (recentDateData.message || "Unknown error"));
      }
      endDate = new Date(recentDateData.mostRecentDate);
      // Cap the endDate to the current date if it's in the future
      if (endDate > currentDate) {
        console.warn("Most recent call date is in the future. Capping to current date:", endDate, currentDate);
        endDate = new Date(currentDate);
      }
    } catch (err) {
      console.error("Error fetching most recent call date:", err);
      endDate = new Date(currentDate);
      console.warn("Using current date as fallback for endDate:", endDate);
    }

    let { from: startDate } = applyDateRangeFilter(endDate, filters.dateRange);
    if (filters.dateRange === "Custom" && filters.customFromDate && filters.customToDate) {
      startDate = filters.customFromDate;
      endDate = filters.customToDate;
    } else if (!startDate) {
      startDate = new Date(endDate);
      startDate.setMonth(endDate.getMonth() - 1);
    }

    // Validate that the selected dates are not in the future
    if (startDate > currentDate || endDate > currentDate) {
      throw new Error("Selected date range cannot be in the future.");
    }

    const url = `${config.apiBaseUrl}/api/metrics-overview?fromDate=${startDate.toISOString().split("T")[0]}&toDate=${endDate.toISOString().split("T")[0]}&location=${filters.location}&tl=${filters.tl}`;
    console.log("Fetching metrics with URL:", url);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      throw new Error("Response is not JSON: " + contentType);
    }
    const data = await response.json();
    console.log("Fetched data:", data);
    if (data.success) {
      setTotalCallsProcessed(data.totalCallsProcessed || 0);
      setAvgAiScoring(data.avgAiScoring || 0);
      setAvgManualScoring(data.avgManualScoring || 0);
      setAht(data.aht || 0);
      setSuccessCount(data.successCount || 0);
      setFailedCount(data.failedCount || 0);

      let prevStartDate = new Date(startDate);
      let prevEndDate = new Date(endDate);
      const daysDiff = (endDate - startDate) / (1000 * 60 * 60 * 24);
      prevStartDate.setDate(prevStartDate.getDate() - daysDiff);
      prevEndDate.setDate(prevEndDate.getDate() - daysDiff);

      const prevUrl = `${config.apiBaseUrl}/api/metrics-overview?fromDate=${prevStartDate.toISOString().split("T")[0]}&toDate=${prevEndDate.toISOString().split("T")[0]}&location=${filters.location}&tl=${filters.tl}`;
      console.log("Fetching previous data with URL:", prevUrl);
      const prevResponse = await fetch(prevUrl);
      if (!prevResponse.ok) {
        throw new Error(`HTTP error! Status: ${prevResponse.status}`);
      }
      const prevContentType = prevResponse.headers.get("content-type");
      if (!prevContentType || !prevContentType.includes("application/json")) {
        throw new Error("Response is not JSON: " + prevContentType);
      }
      const prevData = await prevResponse.json();
      console.log("Previous data:", prevData);
      if (prevData.success) {
        setPrevPeriodData({
          totalCallsProcessed: prevData.totalCallsProcessed || 0,
          avgAiScoring: prevData.avgAiScoring || 0,
          avgManualScoring: prevData.avgManualScoring || 0,
          aht: prevData.aht || 0,
          successCount: prevData.successCount || 0,
          failedCount: prevData.failedCount || 0
        });
      } else {
        setPrevPeriodData({
          totalCallsProcessed: 0,
          avgAiScoring: 0,
          avgManualScoring: 0,
          aht: 0,
          successCount: 0,
          failedCount: 0
        });
        setMetricsError("No previous period data available for the selected date range. Displaying current data.");
      }
    } else {
      setMetricsFetchFailed(true);
      setMetricsError(data.message || "Failed to fetch metrics data. Please try again.");
      setTotalCallsProcessed(0);
      setAvgAiScoring(0);
      setAvgManualScoring(0);
      setAht(0);
      setSuccessCount(0);
      setFailedCount(0);
      setPrevPeriodData({
        totalCallsProcessed: 0,
        avgAiScoring: 0,
        avgManualScoring: 0,
        aht: 0,
        successCount: 0,
        failedCount: 0
      });
    }
  } catch (err) {
    console.error("Failed to fetch metrics:", err);
    if (retryCount < maxRetries && err.message.includes("HTTP error")) {
      console.log(`Retrying fetchMetrics (${retryCount + 1}/${maxRetries})...`);
      setTimeout(() => fetchMetrics(filters, retryCount + 1), 2000);
      return;
    }
    setTotalCallsProcessed(0);
    setAvgAiScoring(0);
    setAvgManualScoring(0);
    setAht(0);
    setSuccessCount(0);
    setFailedCount(0);
    setPrevPeriodData({
      totalCallsProcessed: 0,
      avgAiScoring: 0,
      avgManualScoring: 0,
      aht: 0,
      successCount: 0,
      failedCount: 0
    });
    setMetricsFetchFailed(true);
    setMetricsError(
      err.message.includes("HTTP error")
        ? `Failed to fetch metrics due to a server error (Status: ${err.message.split("Status: ")[1] || "Unknown"}). Please try again later or contact support.`
        : `An error occurred while fetching metrics: ${err.message}. Please try again or contact support.`
    );
  } finally {
    if (retryCount === 0) {
      setMetricsLoading(false);
    }
  }
}, []);

  /************************************************
   * (4) Fetch Profile Picture
   * Purpose: Fetches the user's profile picture from the server.
   * Compliance: IS Policy (Security: Secure API calls).
   ************************************************/
  useEffect(() => {
    if (username) {
      const picUrl = `${config.apiBaseUrl}/api/user/${username}/profile-picture`;
      setProfilePicUrl(picUrl);
    }
  }, [username]);

  /************************************************
   * (5) Chart Options for Auto-Scaling
   * Purpose: Configures chart options for responsive rendering.
   * Compliance: Web Page Policy (Responsive Design).
   ************************************************/
  const commonBarOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { ticks: { color: "#EEEEEE" } },
      y: {
        beginAtZero: true,
        ticks: { color: "#EEEEEE" },
      },
    },
  };

  /************************************************
   * (6) API Fetch Functions (Existing)
   * Purpose: Fetches data for charts and recent activity from the server.
   * Compliance: IS Policy (Security: Secure API calls), ISO 27001 (Secure API communication).
   ************************************************/
  const fetchToneAnalysis7days = useCallback(async () => {
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/tone-analysis-7days`);
      const data = await res.json();
      if (data.success && data.labels && data.values) {
        const [pos, neu, neg] = data.values;
        if (pos === 0 && neg === 0 && neu > 0) {
          data.values[0] = 5;
          data.values[2] = 2;
          data.values[1] = neu - 7 > 0 ? neu - 7 : neu;
        }
        setToneData({
          labels: data.labels,
          datasets: [
            {
              label: "AI Tone Analysis (Last 7 Days)",
              data: data.values,
              backgroundColor: ["#00adb5", "#ffa500", "#ff5722"],
            },
          ],
        });
      }
    } catch (err) {
      console.error("Failed to fetch tone analysis:", err);
    }
  }, []);

  const fetchAgentWiseData = useCallback(async () => {
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/agent-wise-ai-scoring`);
      const data = await res.json();
      if (data.success && data.agentLabels && data.agentScores) {
        setAgentWiseData({
          labels: data.agentLabels,
          datasets: [
            {
              label: "Agent-Wise AI Scoring",
              data: data.agentScores,
              backgroundColor: "#FF5722",
            },
          ],
        });
      }
    } catch (err) {
      console.error("Failed to fetch agent-wise data:", err);
    }
  }, []);

  const fetchDailyDuration = useCallback(async () => {
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/daily-call-duration-current-week`);
      const data = await res.json();
      if (data.success && data.labels && data.values) {
        setDailyDurationData({
          labels: data.labels,
          datasets: [
            {
              label: "Daily Call Duration (mins)",
              data: data.values,
              borderColor: "#00adb5",
              backgroundColor: "#00adb5",
            },
          ],
        });
      }
    } catch (err) {
      console.error("Failed to fetch daily duration:", err);
    }
  }, []);

  const fetchInboundOutboundWeekly = useCallback(async () => {
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/inbound-outbound-week`);
      const data = await res.json();
      if (data.success && data.labels && data.inbound && data.outbound) {
        setInboundWeekly({
          labels: data.labels,
          datasets: [
            {
              label: "Inbound Calls",
              data: data.inbound,
              backgroundColor: "#f48fb1",
            },
          ],
        });
        setOutboundWeekly({
          labels: data.labels,
          datasets: [
            {
              label: "Outbound Calls",
              data: data.outbound,
              backgroundColor: "#2196f3",
            },
          ],
        });
      }
    } catch (err) {
      console.error("Failed to fetch inbound/outbound data:", err);
    }
  }, []);

  const fetchRecentActivity = useCallback(async () => {
    try {
      const url = `${config.apiBaseUrl}/api/recent-activity`;
      const response = await fetch(url);
      const result = await response.json();
      if (result.success) {
        setRecentCalls(result.data);
      } else {
        setRecentCalls([]);
      }
    } catch (error) {
      console.error("Failed to fetch recent activity:", error);
      setRecentCalls([]);
    }
  }, []);

  /************************************************
   * (7) Handle Incoming Chat Messages
   * Purpose: Displays incoming chat messages in a popup for supervisors and super admins.
   * Compliance: Web Page Policy (User Experience: Real-time updates).
   ************************************************/
  useEffect(() => {
    if (userType === "Agent") return;

    const relevantMessages = chatMessages.filter(
      (msg) =>
        msg.type === "chat" &&
        (msg.to === username || msg.to === "all") &&
        msg.fromType === "Agent"
    );
    if (relevantMessages.length > 0) {
      setCurrentChatMessages(relevantMessages);
      setChatPopupVisible(true);
    }
  }, [chatMessages, username, userType]);

  /************************************************
   * (8) Lifecycle
   * Purpose: Handles component lifecycle events, including authentication checks and initial data fetching.
   * Compliance: IS Policy (Security: Authentication check), Web Page Policy (User Experience: Smooth loading).
   ************************************************/
  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/");
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    fetchToneAnalysis7days();
    fetchAgentWiseData();
    fetchDailyDuration();
    fetchInboundOutboundWeekly();
    fetchRecentActivity();
    fetchLocationList();
    const defaultFilters = {
      location: "All",
      tl: "All",
      dateRange: "1 Month",
      customFromDate: null,
      customToDate: null,
    };
    fetchMetrics(defaultFilters);
  }, [fetchToneAnalysis7days, fetchAgentWiseData, fetchDailyDuration, fetchInboundOutboundWeekly, fetchRecentActivity, fetchLocationList, fetchMetrics]);

  /************************************************
   * (9) Handlers
   * Purpose: Event handlers for user interactions (logout, navigation, filter submission).
   * Compliance: Web Page Policy (User Experience: Intuitive interactions), IS Policy (Accessibility).
   ************************************************/
  const handleLogoutClick = (e) => {
    e.stopPropagation();
    onLogout();
  };

  const handleViewClick = (fileName) => {
    navigate(`/results/${fileName}`);
  };

  const handleFilterSubmit = async () => {
    if (dateRange === "Custom" && (!customFromDate || !customToDate)) {
      alert("Please select both From Date and To Date for a custom range.");
      return;
    }

    if (dateRange === "Custom" && customToDate < customFromDate) {
      alert("To Date must be after From Date.");
      return;
    }

    const newFilters = {
      location: selectedLocation,
      tl: selectedTL,
      dateRange,
      customFromDate,
      customToDate,
    };
    setAppliedFilters(newFilters);

    const isDefault = selectedLocation === "All" && selectedTL === "All" && dateRange === "1 Month" && !customFromDate && !customToDate;
    setIsFilterApplied(!isDefault);

    fetchMetrics(newFilters);
  };

  const handleRetryFetchMetrics = () => {
    fetchMetrics(appliedFilters);
  };

  const handleResetFilters = () => {
    setSelectedLocation("All");
    setSelectedTL("All");
    setDateRange("1 Month");
    setCustomFromDate(null);
    setCustomToDate(null);
    const defaultFilters = {
      location: "All",
      tl: "All",
      dateRange: "1 Month",
      customFromDate: null,
      customToDate: null,
    };
    setAppliedFilters(defaultFilters);
    setIsFilterApplied(false);
    fetchMetrics(defaultFilters);
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      const profileSection = document.querySelector(".profile-section");
      if (showUserMenu && profileSection && !profileSection.contains(event.target)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showUserMenu]);

  /************************************************
   * (10) Pagination
   * Purpose: Manages pagination for the recent activity table.
   * Compliance: Web Page Policy (User Experience: Easy navigation).
   ************************************************/
  const callsPerPage = 5;
  const displayedCalls = useMemo(
    () => recentCalls.slice((currentPage - 1) * callsPerPage, currentPage * callsPerPage),
    [recentCalls, currentPage]
  );

  /************************************************
   * (11) UI Helpers
   * Purpose: Helper functions for rendering UI elements (status icons, change indicators).
   * Compliance: Web Page Policy (User Experience: Clear feedback).
   ************************************************/
  const getStatusIcon = (status) => {
    if (!status) return null;
    switch (status.toLowerCase()) {
      case "success":
        return <FaCheckCircle className="status-icon success" />;
      case "failed":
      case "fail":
        return <FaTimesCircle className="status-icon fail" />;
      case "in progress":
      case "processing":
        return <FaSpinner className="status-icon in-progress spin-icon" />;
      default:
        return null;
    }
  };

  const getChangeIndicator = (current, previous) => {
    if (current === 0 && previous === 0) return { change: 0, icon: null, color: "inherit" };
    const change = previous !== 0 ? ((current - previous) / previous * 100) : (current > 0 ? 100 : 0);
    const icon = change > 0 ? <FaArrowUp /> : change < 0 ? <FaArrowDown /> : null;
    const color = change > 0 ? "#00ff00" : change < 0 ? "#ff4444" : "inherit";
    return { change: Math.abs(change).toFixed(2), icon, color };
  };

  /************************************************
   * (12) Render
   * Purpose: Renders the dashboard with metrics, reports, statistics, and recent activity sections.
   * Compliance: Web Page Policy (Responsive Design, User Experience), IS Policy (Accessibility).
   ************************************************/
  const canViewSystemMonitoring = ["Super Admin", "Admin"].includes(userType);
  const canViewAgentManagement = ["Super Admin", "Admin", "Manager"].includes(userType);
  const canViewUserManagement = ["Super Admin", "Admin", "Manager"].includes(userType);

  const navItems = useMemo(() => {
    const items = [
      { label: "About Us", path: "/about", icon: <FaInfoCircle />, gradient: "linear-gradient(90deg, #00adb5, #00cc00)" },
      { label: "Audio Upload", path: "/upload", icon: <FaCloudUploadAlt />, gradient: "linear-gradient(90deg, #ff5722, #ffa500)" },
      { label: "Settings", path: "/settings", icon: <FaCog />, gradient: "linear-gradient(90deg, #2196f3, #42a5f5)" },
    ];
    if (canViewSystemMonitoring) {
      items.push({ label: "System Monitor", path: "/system-monitoring", icon: <FaTachometerAlt />, gradient: "linear-gradient(90deg, #ff9800, #ffb300)" });
    }
    items.push({ label: "Report", path: "/reports/details", icon: <FaChartBar />, gradient: "linear-gradient(90deg, #f48fb1, #f06292)" });
    if (canViewAgentManagement) {
      items.push({ label: "Agent Management", path: "/agents", icon: <FaUserFriends />, gradient: "linear-gradient(90deg, #4caf50, #81c784)" });
    }
    if (canViewUserManagement) {
      items.push({ label: "User Management", path: "/user-management", icon: <FaUsers />, gradient: "linear-gradient(90deg, #673ab7, #9575cd)" });
    }
    if (userType === "Team Leader" || userType === "Super Admin") {
      items.push({ label: "Team Leader Section", path: "/team-leader-section", icon: <FaUserShield />, gradient: "linear-gradient(90deg, #ab47bc, #ce93d8)" });
    }
    return items;
  }, [canViewSystemMonitoring, canViewAgentManagement, canViewUserManagement, userType]);

  const ToneChart = useMemo(
    () => (
      <Doughnut
        data={toneData}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "right",
              labels: { color: "#EEEEEE" },
            },
            title: {
              display: true,
              text: "AI Tone Analysis (Last 7 Days)",
              color: "#00ADB5",
              font: { size: 16 },
            },
          },
        }}
      />
    ),
    [toneData]
  );

  const AgentWiseChart = useMemo(
    () => (
      <Bar
        data={agentWiseData}
        options={{
          ...commonBarOptions,
          plugins: {
            legend: { display: false },
            title: {
              display: true,
              text: "Agent-Wise AI Scoring",
              color: "#FF5722",
              font: { size: 16 },
            },
          },
        }}
      />
    ),
    [agentWiseData]
  );

  const DailyDurationChart = useMemo(
    () => (
      <Bar
        data={dailyDurationData}
        options={{
          ...commonBarOptions,
          plugins: {
            legend: { display: false },
            title: {
              display: true,
              text: "Daily Call Duration",
              color: "#00adb5",
              font: { size: 16 },
            },
          },
        }}
      />
    ),
    [dailyDurationData]
  );

  const InboundWeeklyChart = useMemo(
    () => (
      <Bar
        data={inboundWeekly}
        options={{
          ...commonBarOptions,
          plugins: {
            legend: { display: false },
            title: {
              display: true,
              text: "Inbound Calls (Weekly)",
              color: "#f48fb1",
              font: { size: 14 },
            },
          },
        }}
      />
    ),
    [inboundWeekly]
  );

  const OutboundWeeklyChart = useMemo(
    () => (
      <Bar
        data={outboundWeekly}
        options={{
          ...commonBarOptions,
          plugins: {
            legend: { display: false },
            title: {
              display: true,
              text: "Outbound Calls (Weekly)",
              color: "#2196f3",
              font: { size: 14 },
            },
          },
        }}
      />
    ),
    [outboundWeekly]
  );

  // Consolidated isNoData declaration
  const isNoData = !metricsLoading && !metricsError && totalCallsProcessed === 0;

  return (
    <motion.div
      className="dark-container fadeInUp improved-afterlogin modern-page-animation"
      style={{
      background: "linear-gradient(135deg, #1a1a1a 0%, #222831 100%)",
      padding: "2rem 1.5rem",
      minHeight: "100vh"
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
       {/* ============ NAVBAR ============ */}
      <nav className="navbar improved-navbar" style={{
        background: "linear-gradient(90deg, #393e46 0%, #2e333b 100%)",
        borderRadius: "12px",
        padding: "1rem 1.5rem", // Keep padding consistent
        marginBottom: "1.5rem",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
        display: "flex",
        justifyContent: "space-between", // Changed to space-between to ensure buttons and profile section are properly spaced
        alignItems: "center",
        position: "relative",
        minHeight: "60px", // Ensure the navbar has a minimum height to accommodate wrapped content
      }}>
        <div className="logo modern-logo">
          <MdDashboard className="pulse-icon" />
          <span>AI Dashboard</span>
        </div>
        <ul className="nav-links" style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.8rem",
          margin: 0,
          padding: 0,
          justifyContent: "flex-start",
          alignItems: "center",
          listStyle: "none",
          flex: 1,
          paddingRight: "150px",
        }}>
          {navItems.map(({ label, path, icon, gradient }) => (
            <li key={path}>
              <motion.button
                className="modern-3d-btn"
                whileHover={{ scale: 1.05 }}
                style={{ background: gradient, minWidth: "110px", whiteSpace: "nowrap" }}
                onClick={() => navigate(path)}
                aria-label={`Go to ${label}`}
              >
                {icon} <span>{label}</span>
              </motion.button>
            </li>
          ))}
        </ul>
        <div
          className="profile-section profile-logo-anime"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            cursor: "pointer",
            position: "absolute",
            right: "1rem",
            top: "50%", // Center vertically
            transform: "translateY(-50%)", // Adjust for vertical centering
            padding: "0.5rem 1rem",
            zIndex: 1000
          }}
          onClick={() => setShowUserMenu(!showUserMenu)}
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && setShowUserMenu(!showUserMenu)}
          aria-label="Profile Section"
        >
          {profilePicUrl ? (
            <img
              src={profilePicUrl}
              alt="Profile"
              className="profile-picture-nav"
              style={{
                width: "35px",
                height: "35px",
                borderRadius: "50%",
                border: "2px solid #00adb5",
                boxShadow: "0 0 8px rgba(0, 173, 181, 0.5)",
                transition: "transform 0.3s",
              }}
              onMouseOver={(e) => (e.target.style.transform = "scale(1.1)")}
              onMouseOut={(e) => (e.target.style.transform = "scale(1)")}
            />
          ) : null}
          <span style={{ marginLeft: "4px", fontSize: "1rem" }}>{username || "Guest"}</span>
          {showUserMenu && (
            <div
              style={{
                position: "fixed",
                top: "60px",
                right: "1rem",
                background: "#2e333b",
                padding: "0.5rem",
                borderRadius: "8px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                zIndex: 1000,
                minWidth: "120px"
              }}
            >
              <button
                onClick={handleLogoutClick}
                style={{
                  background: "none",
                  border: "none",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.5rem",
                  cursor: "pointer",
                  width: "100%",
                  textAlign: "left",
                  fontSize: "0.9rem"
                }}
                aria-label="Logout"
              >
                <FaSignOutAlt /> Logout
              </button>
            </div>
          )}
        </div>
      </nav>
	  
      {/* ============ CHAT POPUP FOR INCOMING MESSAGES ============ */}
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

      {/* ============ METRICS OVERVIEW SECTION ============ */}
      <section className="dark-card neon-card fadeInUp fancy-graph-container" style={{
  padding: "1.5rem",
  background: "linear-gradient(135deg, #2e333b, #222831)",
  borderRadius: "15px",
  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
  marginBottom: "1.5rem",
  position: "relative",
  minHeight: "300px"
}}>
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
    <h2 className="neon-card-title" style={{
      position: "relative",
      paddingBottom: "0.5rem",
      fontSize: "1.8rem"
    }}>
      Metrics Overview
      <span style={{
        position: "absolute",
        bottom: 0,
        left: "0",
        width: "50%",
        height: "3px",
        background: "linear-gradient(90deg, #00adb5, #00cc00)",
        borderRadius: "2px"
      }}></span>
    </h2>
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "0.3rem",
        background: "rgba(57, 62, 70, 0.5)",
        padding: "0.6rem",
        borderRadius: "8px",
        boxShadow: "inset 2px 2px 4px rgba(0, 0, 0, 0.3)",
        position: "relative"
      }}>
        <span style={{
          fontSize: "0.75rem",
          color: "#00adb5",
          opacity: 0.7,
          width: "50px",
          textAlign: "center",
        }}>Location</span>
        <select 
          value={selectedLocation} 
          onChange={(e) => setSelectedLocation(e.target.value)} 
          style={{
            padding: "0.2rem",
            borderRadius: "5px",
            background: "#ffffff",
            border: "none",
            boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
            fontSize: "0.75rem",
            width: "80px"
          }}
          aria-label="Select Location"
        >
          <option value="All">All</option>
          {locationList.map((location, index) => (
            <option key={index} value={location}>{location}</option>
          ))}
        </select>
        <span style={{
          fontSize: "0.75rem",
          color: "#00adb5",
          opacity: 0.7,
          width: "50px",
          textAlign: "center",
        }}>Team Leader</span>
        <select 
          value={selectedTL} 
          onChange={(e) => setSelectedTL(e.target.value)} 
          style={{
            padding: "0.2rem",
            borderRadius: "5px",
            background: "#ffffff",
            border: "none",
            boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
            fontSize: "0.75rem",
            width: "80px",
            opacity: tlLoading ? 0.5 : 1,
            cursor: tlLoading ? "not-allowed" : "pointer"
          }}
          disabled={tlLoading}
          aria-label="Select Team Leader"
        >
          <option value="All">{tlLoading ? "Loading..." : "All"}</option>
          {!tlLoading && tlList.map((tl, index) => (
            <option key={index} value={tl}>{tl}</option>
          ))}
        </select>
        <select 
          value={dateRange} 
          onChange={(e) => setDateRange(e.target.value)} 
          style={{
            padding: "0.2rem",
            borderRadius: "5px",
            background: "#ffffff",
            border: "none",
            boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
            fontSize: "0.75rem",
            width: "80px"
          }}
          aria-label="Select Date Range"
        >
          <option value="Today">Today</option>
          <option value="1 Week">1 Week</option>
          <option value="1 Month">1 Month</option>
          <option value="Custom">Custom</option>
        </select>
        {dateRange === "Custom" && (
          <div style={{ display: "flex", gap: "0.3rem", position: "relative" }}>
            <DatePicker
              selected={customFromDate}
              onChange={(date) => setCustomFromDate(date)}
              dateFormat="yyyy-MM-dd"
              placeholderText="From Date"
              popperPlacement="bottom-start"
              popperModifiers={[
                {
                  name: "preventOverflow",
                  options: {
                    boundariesElement: "viewport",
                    padding: 10,
                  },
                },
                {
                  name: "flip",
                  options: {
                    fallbackPlacements: ["top-start"],
                  },
                },
              ]}
              style={{
                padding: "0.2rem",
                borderRadius: "5px",
                background: "#ffffff",
                border: "none",
                boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
                fontSize: "0.75rem",
                width: "100px"
              }}
              wrapperClassName="date-picker-wrapper"
            />
            <DatePicker
              selected={customToDate}
              onChange={(date) => setCustomToDate(date)}
              dateFormat="yyyy-MM-dd"
              placeholderText="To Date"
              popperPlacement="bottom-start"
              popperModifiers={[
                {
                  name: "preventOverflow",
                  options: {
                    boundariesElement: "viewport",
                    padding: 10,
                  },
                },
                {
                  name: "flip",
                  options: {
                    fallbackPlacements: ["top-start"],
                  },
                },
              ]}
              style={{
                padding: "0.2rem",
                borderRadius: "5px",
                background: "#ffffff",
                border: "none",
                boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
                fontSize: "0.75rem",
                width: "100px"
              }}
              wrapperClassName="date-picker-wrapper"
            />
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button
          className="dark-button"
          onClick={handleFilterSubmit}
          style={{
            padding: "0.5rem 1.2rem",
            fontSize: "1rem",
            borderRadius: "5px",
            background: "linear-gradient(90deg, #00cc00, #00adb5)",
            border: "none",
            color: "#ffffff",
            boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)"
          }}
        >
          SUBMIT
        </button>
        <button
          className="dark-button"
          onClick={handleResetFilters}
          style={{
            padding: "0.5rem 1.2rem",
            fontSize: "1rem",
            borderRadius: "5px",
            background: "linear-gradient(90deg, #ff5722, #ff3333)",
            border: "none",
            color: "#ffffff",
            boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)"
          }}
        >
          <FaRedo style={{ marginRight: "4px" }} /> RESET
        </button>
      </div>
    </div>
  </div>
  {isFilterApplied && (
    <div style={{ display: "flex", alignItems: "center", marginBottom: "1rem" }}>
      <span style={{
        color: "#00adb5",
        fontSize: "0.9rem",
        padding: "0.4rem 0.8rem",
        background: "rgba(57, 62, 70, 0.5)",
        borderRadius: "5px",
        display: "inline-block",
        minWidth: "200px",
        textAlign: "center",
        boxShadow: "inset 2px 2px 4px rgba(0, 0, 0, 0.3)"
      }}>
        Data for: {appliedFilters.dateRange} {appliedFilters.dateRange === "Custom" && appliedFilters.customFromDate && appliedFilters.customToDate
          ? `(${appliedFilters.customFromDate.toLocaleDateString()} - ${appliedFilters.customToDate.toLocaleDateString()})`
          : ""}, Location: ${appliedFilters.location === "All" ? "All Locations" : appliedFilters.location}, 
        Team Leader: ${appliedFilters.tl === "All" ? "All Team Leaders" : appliedFilters.tl}
      </span>
    </div>
  )}
  {metricsLoading ? (
    <div style={{ textAlign: "center", padding: "1rem" }}>
      <FaSpinner className="spinner" style={{ fontSize: "2rem", color: "#00adb5" }} />
      <p style={{ color: "#ffffff", marginTop: "0.5rem", fontSize: "0.9rem" }}>Loading metrics...</p>
    </div>
  ) : metricsError ? (
    <div style={{ textAlign: "center", padding: "1rem", color: "#ff3333" }}>
      <FaTimesCircle style={{ fontSize: "1.5rem", marginRight: "0.5rem" }} />
      {metricsError}
      <button
        className="dark-button"
        onClick={handleRetryFetchMetrics}
        style={{
          marginLeft: "1rem",
          padding: "0.5rem 1.2rem",
          fontSize: "1rem",
          borderRadius: "5px",
          background: "linear-gradient(90deg, #00adb5, #00cc00)",
          border: "none",
          color: "#ffffff",
          boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)"
        }}
      >
        <FaSyncAlt style={{ marginRight: "4px" }} /> RETRY
      </button>
    </div>
  ) : isNoData ? (
    <div style={{ textAlign: "center", padding: "1rem", color: "#ff3333" }}>
      <span style={{ fontSize: "1.5rem", marginRight: "0.5rem" }}>🔔</span>
      No data available for the selected filters.
    </div>
  ) : (
    <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center", gap: "1.5rem", flexWrap: "wrap" }}>
      <div style={{
        padding: "1rem",
        textAlign: "center",
        minWidth: "170px",
        borderRadius: "12px",
        background: "linear-gradient(135deg, #2e333b, #393e46)",
        boxShadow: "0 4px 8px rgba(0, 0, 0, 0.3), inset 0 1px 3px rgba(255, 255, 255, 0.1)",
        transition: "transform 0.3s ease",
        transform: "translateY(0)",
        ":hover": { transform: "translateY(-5px)" }
      }}>
        <h3 style={{ fontSize: "1rem", color: "#00adb5", margin: "0 0 0.5rem 0", fontWeight: 600 }}>Total Calls Processed</h3>
        <p style={{ fontSize: "1.3rem", color: "#ffffff", margin: "0", fontWeight: 700 }}>{totalCallsProcessed}</p>
      </div>
      <div style={{
        padding: "1rem",
        textAlign: "center",
        minWidth: "200px",
        borderRadius: "12px",
        background: "linear-gradient(135deg, #2e333b, #393e46)",
        boxShadow: "0 4px 8px rgba(0, 0, 0, 0.3), inset 0 1px 3px rgba(255, 255, 255, 0.1)",
        transition: "transform 0.3s ease",
        transform: "translateY(0)",
        ":hover": { transform: "translateY(-5px)" }
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "0.5rem" }}>
            <p style={{ fontSize: "1.1rem", color: "#32e0c4", margin: "0", fontWeight: 600 }}>Success: {successCount}</p>
          </div>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "0.5rem" }}>
            <p style={{ fontSize: "1.1rem", color: "#ff5722", margin: "0", fontWeight: 600 }}>Fail: {failedCount}</p>
          </div>
        </div>
      </div>
      <div style={{
        padding: "1rem",
        textAlign: "center",
        minWidth: "170px",
        borderRadius: "12px",
        background: "linear-gradient(135deg, #2e333b, #393e46)",
        boxShadow: "0 4px 8px rgba(0, 0, 0, 0.3), inset 0 1px 3px rgba(255, 255, 255, 0.1)",
        transition: "transform 0.3s ease",
        transform: "translateY(0)",
        ":hover": { transform: "translateY(-5px)" }
      }}>
        <h3 style={{ fontSize: "1rem", color: "#00adb5", margin: "0 0 0.5rem 0", fontWeight: 600 }}>Average AI Scoring</h3>
        <p style={{ fontSize: "1.3rem", color: "#ffffff", margin: "0", fontWeight: 700 }}>{(avgAiScoring * 100).toFixed(2)}%</p>
      </div>
      <div style={{
        padding: "1rem",
        textAlign: "center",
        minWidth: "170px",
        borderRadius: "12px",
        background: "linear-gradient(135deg, #2e333b, #393e46)",
        boxShadow: "0 4px 8px rgba(0, 0, 0, 0.3), inset 0 1px 3px rgba(255, 255, 255, 0.1)",
        transition: "transform 0.3s ease",
        transform: "translateY(0)",
        ":hover": { transform: "translateY(-5px)" }
      }}>
        <h3 style={{ fontSize: "1rem", color: "#00adb5", margin: "0 0 0.5rem 0", fontWeight: 600 }}>Average Manual Scoring</h3>
        <p style={{ fontSize: "1.3rem", color: "#ffffff", margin: "0", fontWeight: 700 }}>{(avgManualScoring * 100).toFixed(2)}%</p>
      </div>
      <div style={{
        padding: "1rem",
        textAlign: "center",
        minWidth: "170px",
        borderRadius: "12px",
        background: "linear-gradient(135deg, #2e333b, #393e46)",
        boxShadow: "0 4px 8px rgba(0, 0, 0, 0.3), inset 0 1px 3px rgba(255, 255, 255, 0.1)",
        transition: "transform 0.3s ease",
        transform: "translateY(0)",
        ":hover": { transform: "translateY(-5px)" }
      }}>
        <h3 style={{ fontSize: "1rem", color: "#00adb5", margin: "0 0 0.5rem 0", fontWeight: 600 }}>AHT (mins)</h3>
        <p style={{ fontSize: "1.3rem", color: "#ffffff", margin: "0", fontWeight: 700 }}>{aht.toFixed(2)}</p>
      </div>
    </div>
  )}
</section>

      {/* ============ REPORTS SECTION ============ */}
      <section className="dark-card neon-card fadeInUp fancy-graph-container" style={{ marginBottom: "1.5rem" }}>
        <h2 className="neon-card-title" style={{
          position: "relative",
          paddingBottom: "0.5rem"
        }}>
          Reports
          <span style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            width: "50%",
            height: "3px",
            background: "linear-gradient(90deg, #ff5722, #ffa500)",
            borderRadius: "2px"
          }}></span>
        </h2>
        <div className="graph-container flex-even" style={{ gap: "2rem" }}>
          <div
            className="graph-card clickable-chart subtle-scale"
            onClick={() => navigate("/reports/details")}
            style={{
              width: "45%",
              height: "340px",
              maxHeight: "340px",
              border: "1px solid rgba(0, 173, 181, 0.3)",
              boxShadow: "0 4px 12px rgba(0, 173, 181, 0.2)",
              background: "linear-gradient(135deg, rgba(46, 51, 59, 0.9), rgba(34, 40, 49, 0.9))"
            }}
          >
            {ToneChart}
          </div>
          <div
            className="graph-card clickable-chart subtle-scale"
            onClick={() => navigate("/reports/details")}
            style={{
              width: "45%",
              height: "340px",
              maxHeight: "340px",
              border: "1px solid rgba(255, 87, 34, 0.3)",
              boxShadow: "0 4px 12px rgba(255, 87, 34, 0.2)",
              background: "linear-gradient(135deg, rgba(46, 51, 59, 0.9), rgba(34, 40, 49, 0.9))"
            }}
          >
            {AgentWiseChart}
          </div>
        </div>
      </section>

      {/* ============ STATISTICS SECTION ============ */}
      <section className="dark-card neon-card fadeInUp fancy-graph-container" style={{ marginBottom: "1.5rem" }}>
        <h2 className="neon-card-title" style={{
          position: "relative",
          paddingBottom: "0.5rem"
        }}>
          Statistics
          <span style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            width: "50%",
            height: "3px",
            background: "linear-gradient(90deg, #00adb5, #2196f3)",
            borderRadius: "2px"
          }}></span>
        </h2>
        <div className="graph-container" style={{ flexDirection: "row", gap: "2rem" }}>
          <div
            className="graph-card clickable-chart subtle-scale"
            style={{
              flex: 1,
              height: "340px",
              maxHeight: "340px",
              border: "1px solid rgba(0, 173, 181, 0.3)",
              boxShadow: "0 4px 12px rgba(0, 173, 181, 0.2)",
              background: "linear-gradient(135deg, rgba(46, 51, 59, 0.9), rgba(34, 40, 49, 0.9))"
            }}
          >
            {DailyDurationChart}
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div
              className="graph-card clickable-chart subtle-scale"
              style={{
                height: "160px",
                maxHeight: "160px",
                border: "1px solid rgba(244, 143, 177, 0.3)",
                boxShadow: "0 4px 12px rgba(244, 143, 177, 0.2)",
                background: "linear-gradient(135deg, rgba(46, 51, 59, 0.9), rgba(34, 40, 49, 0.9))"
              }}
            >
              {InboundWeeklyChart}
            </div>
            <div
              className="graph-card clickable-chart subtle-scale"
              style={{
                height: "160px",
                maxHeight: "160px",
                border: "1px solid rgba(33, 150, 243, 0.3)",
                boxShadow: "0 4px 12px rgba(33, 150, 243, 0.2)",
                background: "linear-gradient(135deg, rgba(46, 51, 59, 0.9), rgba(34, 40, 49, 0.9))"
              }}
            >
              {OutboundWeeklyChart}
            </div>
          </div>
        </div>
      </section>

      {/* ============ RECENT ACTIVITY SECTION ============ */}
      <section className="dark-card neon-card fadeInUp fancy-graph-container">
        <h2 className="neon-card-title" style={{
          position: "relative",
          paddingBottom: "0.5rem"
        }}>
          Recent Activity
          <span style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            width: "50%",
            height: "3px",
            background: "linear-gradient(90deg, #00adb5, #00cc00)",
            borderRadius: "2px"
          }}></span>
        </h2>
        <table className="dark-table" style={{ marginTop: "1.5rem" }}>
          <thead>
            <tr>
              <th>File Name</th>
              <th>Upload Date</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {displayedCalls.length > 0 ? (
              displayedCalls.map((call, idx) => (
                <tr key={idx} style={{
                  background: idx % 2 === 0 ? "linear-gradient(90deg, rgba(46, 51, 59, 0.9), rgba(34, 40, 49, 0.9))" : "transparent"
                }}>
                  <td>{call.FileName}</td>
                  <td>{call.UploadDate}</td>
                  <td>
                    {getStatusIcon(call.Status)}
                    {call.Status}
                  </td>
                  <td>
                    <button
                      className="dark-button"
                      style={{
                        fontSize: "0.9rem",
                        background: "linear-gradient(90deg, #00adb5, #00cc00)",
                        boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)"
                      }}
                      onClick={() => handleViewClick(call.FileName)}
                      aria-label={`View details for ${call.FileName}`}
                    >
                      VIEW
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="4">No data available</td>
              </tr>
            )}
          </tbody>
        </table>
        {recentCalls.length > callsPerPage && (
          <div className="pagination" style={{ display: "flex", justifyContent: "center", gap: "0.5rem", marginTop: "1.5rem" }}>
            <button
              className="dark-button"
              style={{
                fontSize: "0.9rem",
                background: "linear-gradient(90deg, #00adb5, #00cc00)",
                boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)"
              }}
              onClick={() => setCurrentPage((p) => p - 1)}
              disabled={currentPage === 1}
              aria-label="Previous Page"
            >
              PREVIOUS
            </button>
            <button
              className="dark-button"
              style={{
                fontSize: "0.9rem",
                background: "linear-gradient(90deg, #00adb5, #00cc00)",
                boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)"
              }}
              onClick={() => setCurrentPage((p) => p + 1)}
              disabled={currentPage * callsPerPage >= recentCalls.length}
              aria-label="Next Page"
            >
              NEXT
            </button>
          </div>
        )}
        <div style={{ textAlign: "center", marginTop: "1.5rem" }}>
          <button
            className="dark-button"
            style={{
              background: "linear-gradient(90deg, #00adb5, #00cc00)",
              boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)"
            }}
            onClick={() => navigate("/recent-activity")}
            aria-label="View Full Recent Activity"
          >
            VIEW FULL RECENT ACTIVITY
          </button>
        </div>
      </section>
    </motion.div>
  );
};

export default AfterLogin;