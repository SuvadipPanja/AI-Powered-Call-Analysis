/**
 * Author: $Panja
 * Creation Date: 2024-12-27
 * Modified Date: 2025-03-28
 * Signature Check: Do not modify this code without verifying the signature logic.
 * Compliance: ISO Policy Standards (Security, Accessibility, Performance, Maintainability, Code Audit)
 */

import React, { useState, useMemo, useEffect } from 'react';
import { Line, Bar, Pie, Doughnut, Radar } from 'react-chartjs-2';
import { useNavigate } from 'react-router-dom';
import 'chart.js/auto';
import './AfterLogin.css';

/**
 * Signature Verification for Code Integrity
 */
const signature = "$Panja";
const verifySignature = (sig) => {
  if (sig !== "$Panja") {
    throw new Error("Signature mismatch: Code integrity compromised");
  }
};
verifySignature(signature);

/**
 * Chart Data Constants for Maintainability
 */
const LINE_DATA = {
  labels: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  datasets: [
    {
      label: 'Daily Call Duration (mins)',
      data: [30, 45, 60, 40, 70, 80, 50],
      backgroundColor: 'rgba(75,192,192,0.4)',
      borderColor: 'rgba(75,192,192,1)',
      borderWidth: 2,
    },
  ],
};

const BAR_DATA = {
  labels: ['Inbound', 'Outbound', 'Missed'],
  datasets: [
    {
      label: 'Call Distribution',
      data: [120, 80, 20],
      backgroundColor: ['#FF6384', '#36A2EB', '#FFCE56'],
    },
  ],
};

const PIE_DATA = {
  labels: ['English', 'Hindi', 'Bengali'],
  datasets: [
    {
      data: [55, 30, 15],
      backgroundColor: ['#4BC0C0', '#FF9F40', '#9966FF'],
    },
  ],
};

const RADAR_DATA = {
  labels: ['Resolution Time', 'Customer Satisfaction', 'Tone Score', 'Accuracy'],
  datasets: [
    {
      label: 'Agent A Performance',
      data: [75, 85, 90, 80],
      backgroundColor: 'rgba(179,181,198,0.2)',
      borderColor: 'rgba(179,181,198,1)',
      pointBackgroundColor: 'rgba(179,181,198,1)',
    },
  ],
};

const DOUGHNUT_DATA = {
  labels: ['Resolved', 'Escalated', 'Pending'],
  datasets: [
    {
      data: [65, 20, 15],
      backgroundColor: ['#36A2EB', '#FF6384', '#FFCE56'],
    },
  ],
};

const ADDITIONAL_BAR_DATA = {
  labels: ['Morning', 'Afternoon', 'Evening'],
  datasets: [
    {
      label: 'Call Volume by Time',
      data: [50, 100, 70],
      backgroundColor: ['#98FB98', '#ADD8E6', '#FFB6C1'],
    },
  ],
};

const ADDITIONAL_LINE_DATA = {
  labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
  datasets: [
    {
      label: 'Weekly Call Resolution Time (mins)',
      data: [150, 200, 180, 220],
      borderColor: '#9370DB',
      backgroundColor: 'rgba(147, 112, 219, 0.3)',
      borderWidth: 2,
    },
  ],
};

/**
 * Chart Options for Accessibility and Performance
 */
const chartOptions = {
  plugins: {
    legend: {
      labels: {
        color: '#EEEEEE', // Light text for dark theme
        font: {
          size: 14,
        },
      },
    },
    tooltip: {
      backgroundColor: '#393e46',
      titleColor: '#EEEEEE',
      bodyColor: '#EEEEEE',
    },
  },
  scales: {
    x: {
      ticks: {
        color: '#EEEEEE',
      },
      grid: {
        color: 'rgba(255,255,255,0.1)',
      },
    },
    y: {
      ticks: {
        color: '#EEEEEE',
      },
      grid: {
        color: 'rgba(255,255,255,0.1)',
      },
    },
  },
  maintainAspectRatio: false, // Improve responsiveness
};

/**
 * Main Component
 */
const EnhancedStatisticsPage = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);

  // Simulate loading for better UX
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  // Memoize chart data to prevent unnecessary re-renders
  const memoizedLineData = useMemo(() => LINE_DATA, []);
  const memoizedBarData = useMemo(() => BAR_DATA, []);
  const memoizedPieData = useMemo(() => PIE_DATA, []);
  const memoizedRadarData = useMemo(() => RADAR_DATA, []);
  const memoizedDoughnutData = useMemo(() => DOUGHNUT_DATA, []);
  const memoizedAdditionalBarData = useMemo(() => ADDITIONAL_BAR_DATA, []);
  const memoizedAdditionalLineData = useMemo(() => ADDITIONAL_LINE_DATA, []);

  // Log navigation actions for audit purposes
  const handleNavigation = (path) => {
    console.log(`Navigating to ${path} at ${new Date().toISOString()}`);
    navigate(path);
  };

  return (
    <div className="dark-container neon-settings-container fadeIn">
      {/* Header with Logo and Dashboard Button */}
      <div className="settings-neon-header">
        <div className="logo">Call Center Analytics</div>
        <div style={{ marginLeft: 'auto' }}>
          <button
            className="dark-button dashboard"
            onClick={() => handleNavigation('/afterlogin')}
            aria-label="Go to Dashboard"
          >
            Dashboard
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="modern-page-animation">
        <p>Explore detailed call statistics and insights with various data representations.</p>

        {isLoading ? (
          <div className="spinner" aria-label="Loading charts"></div>
        ) : (
          <div className="graph-container">
            {/* Daily Call Duration */}
            <div className="graph-card subtle-scale">
              <h3>Daily Call Duration</h3>
              <div style={{ height: '300px' }}>
                <Line
                  data={memoizedLineData}
                  options={chartOptions}
                  aria-label="Line chart showing daily call duration in minutes"
                />
              </div>
            </div>

            {/* Call Distribution */}
            <div className="graph-card subtle-scale">
              <h3>Call Distribution</h3>
              <div style={{ height: '300px' }}>
                <Bar
                  data={memoizedBarData}
                  options={chartOptions}
                  aria-label="Bar chart showing call distribution by type"
                />
              </div>
            </div>

            {/* Language Preferences */}
            <div className="graph-card subtle-scale">
              <h3>Language Preferences</h3>
              <div style={{ height: '300px' }}>
                <Pie
                  data={memoizedPieData}
                  options={chartOptions}
                  aria-label="Pie chart showing language preferences"
                />
              </div>
            </div>

            {/* Agent Performance Metrics */}
            <div className="graph-card subtle-scale">
              <h3>Agent Performance Metrics</h3>
              <div style={{ height: '300px' }}>
                <Radar
                  data={memoizedRadarData}
                  options={chartOptions}
                  aria-label="Radar chart showing agent performance metrics"
                />
              </div>
            </div>

            {/* Call Resolution Status */}
            <div className="graph-card subtle-scale">
              <h3>Call Resolution Status</h3>
              <div style={{ height: '300px' }}>
                <Doughnut
                  data={memoizedDoughnutData}
                  options={chartOptions}
                  aria-label="Doughnut chart showing call resolution status"
                />
              </div>
            </div>

            {/* Call Volume by Time */}
            <div className="graph-card subtle-scale">
              <h3>Call Volume by Time</h3>
              <div style={{ height: '300px' }}>
                <Bar
                  data={memoizedAdditionalBarData}
                  options={chartOptions}
                  aria-label="Bar chart showing call volume by time of day"
                />
              </div>
            </div>

            {/* Weekly Call Resolution Time */}
            <div className="graph-card subtle-scale">
              <h3>Weekly Call Resolution Time</h3>
              <div style={{ height: '300px' }}>
                <Line
                  data={memoizedAdditionalLineData}
                  options={chartOptions}
                  aria-label="Line chart showing weekly call resolution time in minutes"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Optimize with React.memo to prevent unnecessary re-renders
export default React.memo(EnhancedStatisticsPage);