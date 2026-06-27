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
import { Button, Spinner } from './ui';
import PageSection from './ui/PageSection';
import ChartPanel from './ui/ChartPanel';
import {
  baseChartOptions,
  lineDataset,
  doughnutColors,
  readChartPalette,
} from '../theme/chartTheme';

const noScaleOptions = () =>
  baseChartOptions({ scales: {} });

const EnhancedStatisticsPage = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  const memoizedLineData = useMemo(() => ({
    labels: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    datasets: [lineDataset('Daily Call Duration (mins)', [30, 45, 60, 40, 70, 80, 50], 0)],
  }), []);

  const memoizedBarData = useMemo(() => {
    const colors = doughnutColors(3);
    return {
      labels: ['Inbound', 'Outbound', 'Missed'],
      datasets: [{
        label: 'Call Distribution',
        data: [120, 80, 20],
        backgroundColor: colors,
        borderColor: colors,
        borderRadius: 6,
        borderSkipped: false,
      }],
    };
  }, []);

  const memoizedPieData = useMemo(() => ({
    labels: ['English', 'Hindi', 'Bengali'],
    datasets: [{ data: [55, 30, 15], backgroundColor: doughnutColors(3) }],
  }), []);

  const memoizedRadarData = useMemo(() => {
    const p = readChartPalette();
    return {
      labels: ['Resolution Time', 'Customer Satisfaction', 'Tone Score', 'Accuracy'],
      datasets: [{
        label: 'Agent A Performance',
        data: [75, 85, 90, 80],
        backgroundColor: p.accentSoft,
        borderColor: p.accent,
        pointBackgroundColor: p.accent,
      }],
    };
  }, []);

  const memoizedDoughnutData = useMemo(() => ({
    labels: ['Resolved', 'Escalated', 'Pending'],
    datasets: [{ data: [65, 20, 15], backgroundColor: doughnutColors(3) }],
  }), []);

  const memoizedAdditionalBarData = useMemo(() => {
    const colors = doughnutColors(3);
    return {
      labels: ['Morning', 'Afternoon', 'Evening'],
      datasets: [{
        label: 'Call Volume by Time',
        data: [50, 100, 70],
        backgroundColor: colors,
        borderColor: colors,
        borderRadius: 6,
        borderSkipped: false,
      }],
    };
  }, []);

  const memoizedAdditionalLineData = useMemo(() => ({
    labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
    datasets: [lineDataset('Weekly Call Resolution Time (mins)', [150, 200, 180, 220], 5)],
  }), []);

  const handleNavigation = (path) => {
    console.log(`Navigating to ${path} at ${new Date().toISOString()}`);
    navigate(path);
  };

  return (
    <div className="app-page reports-page">
      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-6)' }}>
          <Spinner aria-label="Loading charts" />
        </div>
      ) : (
        <PageSection title="Statistics Overview">
          <div className="ui-chart-grid">
            <ChartPanel title="Daily Call Duration">
              <Line
                data={memoizedLineData}
                options={baseChartOptions()}
                aria-label="Line chart showing daily call duration in minutes"
              />
            </ChartPanel>

            <ChartPanel title="Call Distribution">
              <Bar
                data={memoizedBarData}
                options={baseChartOptions()}
                aria-label="Bar chart showing call distribution by type"
              />
            </ChartPanel>

            <ChartPanel title="Language Preferences">
              <Pie
                data={memoizedPieData}
                options={noScaleOptions()}
                aria-label="Pie chart showing language preferences"
              />
            </ChartPanel>

            <ChartPanel title="Agent Performance Metrics">
              <Radar
                data={memoizedRadarData}
                options={noScaleOptions()}
                aria-label="Radar chart showing agent performance metrics"
              />
            </ChartPanel>

            <ChartPanel title="Call Resolution Status">
              <Doughnut
                data={memoizedDoughnutData}
                options={noScaleOptions()}
                aria-label="Doughnut chart showing call resolution status"
              />
            </ChartPanel>

            <ChartPanel title="Call Volume by Time">
              <Bar
                data={memoizedAdditionalBarData}
                options={baseChartOptions()}
                aria-label="Bar chart showing call volume by time of day"
              />
            </ChartPanel>

            <ChartPanel title="Weekly Call Resolution Time">
              <Line
                data={memoizedAdditionalLineData}
                options={baseChartOptions()}
                aria-label="Line chart showing weekly call resolution time in minutes"
              />
            </ChartPanel>
          </div>
        </PageSection>
      )}
    </div>
  );
};

export default React.memo(EnhancedStatisticsPage);
