/**
 * File: SystemMonitoring.jsx
 * Purpose: Displays real-time system performance metrics (CPU, Memory, Disks, GPU) with enhanced UI
 * Creator: $Panja
 * Created Date: March 15, 2025
 * Modified Date: March 29, 2025
 * Description: A secure, responsive, and visually appealing system monitoring dashboard
 *              adhering to ISO/IEC 27001, code audit standards, and web best practices.
 */

import React, { useState, useEffect, useCallback } from 'react';
import GaugeChart from 'react-gauge-chart';
import { CircularProgressbar, buildStyles } from 'react-circular-progressbar';
import 'react-circular-progressbar/dist/styles.css';
import { useNavigate } from 'react-router-dom';

/**
 * Dummy data to show 0% until real data arrives.
 * We only apply this when we explicitly want to show the spinner
 * (first load or manual refresh), not for silent auto-refresh.
 */
const dummySystemData = {
  cpu: {
    currentLoad: 0,
    model: 'N/A',
    cores: 0,
  },
  memory: {
    used: 0,
    total: 0,
    free: 0,
  },
  disks: [],
  gpu: null,
};

const SystemMonitoring = () => {
  const [systemData, setSystemData] = useState(dummySystemData);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  /**
   * Fetch with Spinner (for first load & manual refresh):
   *  - We show spinner, reset to dummy data -> 0%.
   *  - Then fetch real data -> hide spinner.
   */
  const fetchSystemDataWithSpinner = useCallback(async () => {
    try {
      setIsLoading(true);
      setSystemData(dummySystemData); // Show 0% behind spinner
      const response = await fetch('http://localhost:5000/api/system-monitor');
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      const data = await response.json();
      if (data.success) {
        setSystemData(data);
      }
    } catch (error) {
      console.error('Error (with spinner) fetching system data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Silent fetch (for auto-refresh in background):
   *  - No spinner, no reset to 0%. It just updates data smoothly.
   */
  const fetchSystemDataSilent = useCallback(async () => {
    try {
      const response = await fetch('http://localhost:5000/api/system-monitor');
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      const data = await response.json();
      if (data.success) {
        setSystemData(data);
      }
    } catch (error) {
      console.error('Error (silent) fetching system data:', error);
    }
  }, []);

  // On mount, do a "spinner" fetch, and set up silent auto-refresh every 15s.
  useEffect(() => {
    fetchSystemDataWithSpinner();

    const interval = setInterval(() => {
      if (document.hasFocus()) {
        fetchSystemDataSilent();
      }
    }, 15000); // 15 seconds

    return () => clearInterval(interval);
  }, [fetchSystemDataWithSpinner, fetchSystemDataSilent]);

  // Manual refresh (with spinner)
  const handleManualRefresh = () => {
    fetchSystemDataWithSpinner();
  };

  // Log navigation actions for audit purposes
  const handleNavigation = (path) => {
    console.log(`Navigating to ${path} at ${new Date().toISOString()}`);
    navigate(path);
  };

  // Calculate usage percentages
  const cpuLoadPercent = systemData.cpu.currentLoad / 100;
  const memoryUsedPercent = systemData.memory.total
    ? systemData.memory.used / systemData.memory.total
    : 0;
  const gpuLoadPercent = systemData.gpu
    ? systemData.gpu.load / 100
    : 0;

  return (
    <>
      {/*
        -----------------------------------------
        Inline CSS: All styles in one place
        -----------------------------------------
      */}
      <style>
        {`
          /* Reset + Body Background */
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            background-color: #222831;
            color: #EEE;
            font-family: 'Poppins', sans-serif;
          }

          /* Container around entire page */
          .sysmon-container {
            background: #0a0a0a;
            padding: 2rem;
            min-height: 100vh;
            border: 2px solid #00adb5;
            border-radius: 12px;
            box-shadow: 0 0 25px rgba(0, 173, 181, 0.3);
            position: relative; /* so spinner overlay can cover it */
          }

          /* The top bar with logo, title, dashboard button, and refresh button */
          .sysmon-top-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 1.5rem;
            background: #1a1a1a;
            padding: 0.5rem 1rem;
            border-radius: 8px;
            border: 1px solid #00adb5;
            box-shadow: 0 0 10px rgba(0, 173, 181, 0.2);
          }
          .sysmon-title {
            font-size: 1.4rem;
            font-weight: 600;
            color: #fff;
            text-shadow: none;
          }
          .sysmon-refresh-button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background: #00adb5;
            color: #fff;
            border: none;
            border-radius: 50%;
            width: 32px;
            height: 32px;
            font-size: 1rem;
            cursor: pointer;
            transition: background 0.2s, transform 0.2s;
            margin-left: 0.5rem;
          }
          .sysmon-refresh-button:hover {
            background: #00d1ce;
            transform: scale(1.1);
          }
          .sysmon-refresh-icon {
            font-size: 1rem;
          }
          .sysmon-dashboard-button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background: #00adb5;
            color: #fff;
            border: none;
            border-radius: 8px;
            padding: 0.5rem 1rem;
            font-size: 1rem;
            cursor: pointer;
            transition: background 0.2s, transform 0.2s;
          }
          .sysmon-dashboard-button:hover {
            background: #00d1ce;
            transform: scale(1.02);
          }
          .logo {
            font-size: 1.3rem;
            color: #00ADB5;
          }

          /* Loading overlay (spinner) */
          .modal-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(10,10,10,0.95);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 999;
          }
          .modal-content {
            background: #1a1a1a;
            padding: 2rem;
            border-radius: 15px;
            box-shadow: 0 0 20px rgba(0, 173, 181, 0.4);
            text-align: center;
          }
          .spinner {
            width: 50px;
            height: 50px;
            border: 5px solid #00adb5;
            border-top: 5px solid #ffd700;
            border-radius: 50%;
            margin: 0 auto 1rem auto;
            animation: spin 1.2s linear infinite;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          .waiting-note {
            font-size: 1rem;
            color: #eee;
          }

          /* The main metric area (grid) */
          .dashboard-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 2rem;
          }

          /* Metric Card */
          .sysmon-metric-card {
            background: #1a1a1a;
            border: 2px solid #00adb5;
            border-radius: 15px;
            padding: 1.5rem;
            text-align: center;
            box-shadow: 0 0 15px rgba(0, 173, 181, 0.2);
            transition: transform 0.3s, box-shadow 0.3s;
          }
          .sysmon-metric-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 0 25px rgba(0, 173, 181, 0.4);
          }
          .sysmon-neon-card-title {
            font-size: 1.5rem;
            color: #ffd700;
            text-shadow: 0 0 8px rgba(255, 215, 0, 0.7);
            margin-bottom: 1rem;
          }
          .sysmon-metric-detail {
            font-size: 0.9rem;
            color: #cfcfcf;
            margin-top: 0.5rem;
            line-height: 1.4;
          }

          /* Disk usage container */
          .sysmon-disk-container {
            display: flex;
            flex-direction: column;
            align-items: center;
          }
          .sysmon-disk-list {
            max-height: 400px;
            overflow-y: auto;
            width: 100%;
            display: flex;
            flex-direction: column;
            gap: 1rem;
          }
          .sysmon-disk-item {
            display: flex;
            align-items: center;
            gap: 1rem;
            background: #2e333b;
            padding: 0.5rem 1rem;
            border-radius: 10px;
            box-shadow: 0 0 10px rgba(0, 173, 181, 0.1);
          }
          .sysmon-disk-graph {
            width: 80px;
            height: 80px;
          }
          .sysmon-disk-list::-webkit-scrollbar {
            width: 6px;
          }
          .sysmon-disk-list::-webkit-scrollbar-track {
            background: #121212;
          }
          .sysmon-disk-list::-webkit-scrollbar-thumb {
            background: #00adb5;
            border-radius: 3px;
          }
          .sysmon-disk-list::-webkit-scrollbar-thumb:hover {
            background: #0097a7;
          }

          /* Fade in animation for dashboard */
          .fadeIn {
            animation: fadeInAnim 0.8s forwards;
            opacity: 0;
          }
          @keyframes fadeInAnim {
            to {
              opacity: 1;
            }
          }

          /* Hover scale effect for the card */
          .subtle-scale {
            transition: transform 0.3s ease, box-shadow 0.3s ease;
          }
          .subtle-scale:hover {
            transform: scale(1.02);
            box-shadow: 0 8px 16px rgba(0, 173, 181, 0.2);
          }
        `}
      </style>

      {/* Outer Container */}
      <div className="sysmon-container">
        {/* Top Bar */}
        <div className="sysmon-top-bar">
          {/* Logo */}
          <div className="logo">Call Center Analytics</div>
          {/* Title */}
          <h1 className="sysmon-title">System Monitoring</h1>
          {/* Dashboard and Refresh Buttons */}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <button
              className="sysmon-dashboard-button"
              onClick={() => handleNavigation('/afterlogin')}
              aria-label="Go to Dashboard"
            >
              Dashboard
            </button>
            <button
              className="sysmon-refresh-button"
              onClick={handleManualRefresh}
              aria-label="Refresh System Data"
            >
              <span className="sysmon-refresh-icon">⟳</span>
            </button>
          </div>
        </div>

        {/* Spinner overlay: only if isLoading */}
        {isLoading && (
          <div className="modal-overlay">
            <div className="modal-content">
              <div className="spinner"></div>
              <p className="waiting-note">Fetching System Data...</p>
            </div>
          </div>
        )}

        {/* Metrics Grid */}
        <section
          className="dashboard-grid fadeIn"
          style={{ opacity: isLoading ? 0.4 : 1 }}
        >
          {/* CPU Load */}
          <article className="sysmon-metric-card subtle-scale">
            <h2 className="sysmon-neon-card-title">CPU Load</h2>
            <GaugeChart
              id="cpu-gauge"
              nrOfLevels={40}
              colors={['#00adb5', '#ffd700', '#ff5722']}
              arcWidth={0.35}
              percent={cpuLoadPercent}
              textColor="#eeeeee"
              needleColor="#ffd700"
              formatTextValue={() => `${(cpuLoadPercent * 100).toFixed(1)}%`}
              animationDuration={1500}
              animate={true}
            />
            <p className="sysmon-metric-detail">
              Current: {(cpuLoadPercent * 100).toFixed(1)}% |
              Model: {systemData.cpu.model} |
              Cores: {systemData.cpu.cores}
            </p>
          </article>

          {/* Memory Usage */}
          <article className="sysmon-metric-card subtle-scale">
            <h2 className="sysmon-neon-card-title">Memory Usage</h2>
            <GaugeChart
              id="memory-gauge"
              nrOfLevels={40}
              colors={['#00adb5', '#ffd700', '#ff5722']}
              arcWidth={0.35}
              percent={memoryUsedPercent}
              textColor="#eeeeee"
              needleColor="#ffd700"
              formatTextValue={() => `${(memoryUsedPercent * 100).toFixed(1)}%`}
              animationDuration={1500}
              animate={true}
            />
            <p className="sysmon-metric-detail">
              Used: {systemData.memory.used} GB / {systemData.memory.total} GB |
              Free: {systemData.memory.free} GB
            </p>
          </article>

          {/* Disk Usage */}
          <article className="sysmon-metric-card subtle-scale sysmon-disk-container">
            <h2 className="sysmon-neon-card-title">Disk Usage</h2>
            <div className="sysmon-disk-list">
              {systemData.disks.map((disk, index) => (
                <div key={index} className="sysmon-disk-item">
                  <div className="sysmon-disk-graph">
                    <CircularProgressbar
                      value={disk.use}
                      text={`${disk.use.toFixed(1)}%`}
                      styles={buildStyles({
                        pathColor:
                          disk.use > 80 ? '#ff5722' : '#00adb5',
                        textColor: '#eeeeee',
                        trailColor: '#2e333b',
                        pathTransitionDuration: 1.5,
                      })}
                    />
                  </div>
                  <p className="sysmon-metric-detail">
                    {disk.fs} | Used: {disk.used} GB / {disk.size} GB |
                    Free: {disk.size - disk.used} GB
                  </p>
                </div>
              ))}
            </div>
          </article>

          {/* GPU Load (if available) */}
          {systemData.gpu && (
            <article className="sysmon-metric-card subtle-scale">
              <h2 className="sysmon-neon-card-title">GPU Load</h2>
              <GaugeChart
                id="gpu-gauge"
                nrOfLevels={40}
                colors={['#00adb5', '#ffd700', '#ff5722']}
                arcWidth={0.35}
                percent={gpuLoadPercent}
                textColor="#eeeeee"
                needleColor="#ffd700"
                formatTextValue={() =>
                  `${(gpuLoadPercent * 100).toFixed(1)}%`
                }
                animationDuration={1500}
                animate={true}
              />
              <p className="sysmon-metric-detail">
                Model: {systemData.gpu.model} |
                VRAM: {systemData.gpu.vram} MB
              </p>
            </article>
          )}
        </section>
      </div>
    </>
  );
};

export default SystemMonitoring;