/**
 * File: ResultPage.jsx
 * Purpose: Displays audio details, transcript, and various analytics graphs for a specific audio file.
 * Developed by: $Panja - AI Call Analysis System
 * Creation Date: 2025-03-28
 * Signature Check: Do not modify this code without verifying the signature logic.
 * Compliance:
 *  - IS Policy Standards:
 *    - Security: Signature integrity check, secure API calls using environment variables.
 *    - Accessibility: ARIA labels for interactive elements, keyboard navigation support.
 *    - Performance: Efficient state management, optimized API calls, and lazy-loaded components.
 *    - Maintainability: Detailed comments, modular structure, and environment variable usage.
 *    - Code Audit: Signature check, comprehensive documentation, and logging without sensitive data exposure.
 *  - ISO Policy:
 *    - ISO 27001 (Information Security Management): Secure API calls, logging without sensitive data exposure, environment variable usage.
 *    - ISO 9001 (Quality Management): High-quality code with detailed comments, error handling, and maintainable structure.
 *  - Web Page Policy:
 *    - Responsive Design: CSS ensures the layout is responsive with flexbox.
 *    - User Experience: Improved navigation, consistent styling, enhanced visual appeal with animations and subtle effects.
 *    - Security: No sensitive data exposed in logs, secure API communication.
 * Updated: 2025-04-06
 * Changes:
 *  - Used the same logic but refreshed the UI with a modern dark theme
 *  - Tab buttons have been made bigger to match the dashboard's style
 *  - Moved summary from Scoring section to a new Summary tab in Transcript section
 *  - Made Transcript and Summary tab buttons smaller to maximize content space
 *  - Fixed TypeError by ensuring regions are added only after WaveSurfer is ready
 *  - Updated Transcript section to show "Transcript" as title with "Summary" button beside it
 *  - Enhanced WaveSurfer error handling to prevent TypeError
 *  - Made "Transcript" title a toggle button to switch back from summary view
 *  - Updated to fetch summary from new /api/summary/:audioFileName endpoint
 *  - Ensured Scoring section does not display summary by using updated /api/custom-scoring-details/:audioFileName
 */

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import DOMPurify from 'dompurify'; // For sanitizing HTML content
import config from "../utils/envConfig"; // Environment configuration for API URLs

// WaveSurfer for audio visualization
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugin/wavesurfer.regions.min.js';

// React Icons (some updated to new icons for a fresh look)
import {
  FaFileAudio,
  FaCalendarAlt,
  FaUser,
  FaPhone,
  FaHome,
  FaMicrophoneAlt,
  FaDownload,
  FaLanguage,
  FaInfoCircle,
} from 'react-icons/fa';

// Chart.js components
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line, Doughnut } from 'react-chartjs-2';

// Chart.js annotation plugin for enhanced graph features
import annotationPlugin from 'chartjs-plugin-annotation';

// Gauge component for Script Compliance
import GaugeChart from 'react-gauge-chart';

// Register Chart.js components/plugins
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  annotationPlugin
);

/**
 * Utility Function: Convert seconds to formatted time (mm:ss or hh:mm:ss)
 * @param {number} totalSec - Total seconds
 * @returns {string} - Formatted time string
 */
function formatTimeSec(totalSec) {
  if (isNaN(totalSec)) return '0s';
  const sec = Math.floor(totalSec);
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const secs = sec % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(
      secs
    ).padStart(2, '0')} sec`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')} sec`;
}

/**
 * Main Component: ResultPage
 */
const ResultPage = () => {
  /***************************************
   * 1) CODE INTEGRITY CHECK
   ***************************************/
  const signature = "$Panja";
  const verifySignature = (sig) => {
    if (sig !== "$Panja") {
      throw new Error("Signature mismatch: Code integrity compromised.");
    }
  };
  verifySignature(signature);

  /***************************************
   * 2) STATE AND NAVIGATION
   ***************************************/
  const { filename } = useParams();
  const navigate = useNavigate();

  // Audio & Transcript
  const [audioDetails, setAudioDetails] = useState({});
  const [transcription, setTranscription] = useState('Loading...');
  const [summary, setSummary] = useState('Loading...'); // State for summary

  // WaveSurfer references
  const waveformRef = useRef(null);
  const [waveSurfer, setWaveSurfer] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isWaveformReady, setIsWaveformReady] = useState(false); // Track waveform readiness

  // Tabs & Analysis Data
  const [activeTab, setActiveTab] = useState('none');
  const [transcriptTab, setTranscriptTab] = useState('transcript'); // State for transcript/summary tabs
  const [toneAnalysis, setToneAnalysis] = useState(null);
  const [sentimentData, setSentimentData] = useState(null);
  const [aiScoring, setAiScoring] = useState(null);
  const [manualScoring, setManualScoring] = useState(null);
  const [manualScoresInput, setManualScoresInput] = useState({});
  const [loadingScoring, setLoadingScoring] = useState(false);
  const [scoreError, setScoreError] = useState(null);

  // Script Compliance
  const [scriptCompliance, setScriptCompliance] = useState(null);

  /***************************************
   * 3) FETCH SCRIPT COMPLIANCE
   ***************************************/
  const handleFetchScriptCompliance = async () => {
    try {
      const response = await axios.get(`${config.apiBaseUrl}/api/script-compliance/${filename}`);
      if (response.data.success) {
        setScriptCompliance(response.data.scriptCompliance);
      } else {
        console.warn('ScriptCompliance not found:', response.data.message);
        setScriptCompliance(null);
      }
    } catch (err) {
      console.error('Error fetching ScriptCompliance:', err);
      setScriptCompliance(null);
    }
  };

  /***************************************
   * 4) FETCH AUDIO & AI PROCESSING DETAILS
   ***************************************/
  useEffect(() => {
    const fetchAudioAI = async () => {
      try {
        // Audio Upload Details
        const uploadResp = await axios.get(
          `${config.apiBaseUrl}/api/audio-upload-details/${filename}`
        );
        let uploadData = {};
        if (uploadResp.data.success) {
          uploadData = uploadResp.data.audioUploadDetails;
        }

        // AI Processing Details
        const aiResp = await axios.get(
          `${config.apiBaseUrl}/api/ai-processing-details/${filename}`
        );
        let aiData = {};
        if (aiResp.data.success) {
          aiData = aiResp.data.aiProcessingDetails;
        }

        // Merge data
        const merged = {
          AudioFileName: uploadData.AudioFileName,
          AgentName: uploadData.AgentName,
          CallType: uploadData.CallType,
          UploadDate: uploadData.UploadDate,
          Status: uploadData.Status,
          AudioLanguage: aiData.AudioLanguage,
          AudioDuration: aiData.AudioDuration,
        };
        setAudioDetails(merged);
      } catch (err) {
        console.error('Error fetching audio details:', err);
      }
    };
    fetchAudioAI();
  }, [filename]);

  /***************************************
   * 5) FETCH TRANSCRIPT AND SUMMARY
   ***************************************/
  useEffect(() => {
    const fetchTranscript = async () => {
      try {
        const resp = await axios.get(
          `${config.apiBaseUrl}/api/translate-output/${filename}`
        );
        if (resp.data.success) {
          const rawText = resp.data.translateOutput || '';
          setTranscription(formatTranscript(rawText));
        } else {
          setTranscription('No transcription found.');
        }
      } catch (err) {
        console.error('Error fetching transcript:', err);
        setTranscription('Error loading transcript.');
      }
    };

    const fetchSummary = async () => {
      try {
        const resp = await axios.get(
          `${config.apiBaseUrl}/api/summary/${filename}`
        );
        if (resp.data.success) {
          setSummary(resp.data.summary || 'No summary available.');
        } else {
          setSummary('No summary found.');
        }
      } catch (err) {
        console.error('Error fetching summary:', err);
        setSummary('Error loading summary.');
      }
    };

    fetchTranscript();
    fetchSummary();
  }, [filename]);

  /**
   * formatTranscript()
   */
  const formatTranscript = (raw) =>
    DOMPurify.sanitize(
      raw
        .split('\n')
        .map((line) => {
          if (line.startsWith('Agent')) {
            return `<span style='color: #4FC3F7;'>${line}</span>`;
          } else if (line.startsWith('Customer')) {
            return `<span style='color: #81C784;'>${line}</span>`;
          }
          return line;
        })
        .join('<br>')
    );

  /***************************************
   * 6) WAVESURFER INITIALIZATION
   ***************************************/
  useEffect(() => {
    if (!audioDetails.AudioFileName || !waveformRef.current) return; // Ensure waveformRef.current exists

    const ws = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: '#B0BEC5',
      progressColor: '#4FC3F7',
      cursorColor: '#4FC3F7',
      cursorWidth: 2,
      height: 80,
      responsive: true,
      partialRender: true,
      normalize: true,
      barWidth: 2,
      splitChannels: false,
      crossOrigin: 'anonymous',
      plugins: [
        RegionsPlugin.create({
          regions: [],
          dragSelection: false,
        }),
      ],
    });

    ws.load(`${config.apiBaseUrl}/audio/${audioDetails.AudioFileName}`);

    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));
    ws.on('finish', () => setIsPlaying(false));
    ws.on('error', (e) => {
      console.error('WaveSurfer error:', e);
    });
    ws.on('ready', () => {
      setIsWaveformReady(true); // Set flag when waveform is ready
    });

    setWaveSurfer(ws);

    return () => {
      ws.destroy();
      setWaveSurfer(null);
      setIsWaveformReady(false); // Reset flag on cleanup
    };
  }, [audioDetails.AudioFileName]);

  /**
   * handlePlayPause()
   */
  const handlePlayPause = () => {
    waveSurfer?.playPause();
  };

  /**
   * handleDownload()
   */
  const handleDownload = () => {
    if (!audioDetails.AudioFileName) return;
    const fileURL = `${config.apiBaseUrl}/audio/${audioDetails.AudioFileName}`;
    const link = document.createElement('a');
    link.href = fileURL;
    link.setAttribute('download', audioDetails.AudioFileName);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  /***************************************
   * 7) TONE ANALYSIS + WAVESURFER REGIONS
   ***************************************/
  useEffect(() => {
    if (!toneAnalysis || !waveSurfer || !isWaveformReady || !waveformRef.current) return; // Ensure all conditions are met

    try {
      waveSurfer.clearRegions();

      const createRegions = () => {
        const regions = [];
        ['Agent', 'Customer'].forEach((speaker) => {
          const speakerData = toneAnalysis?.results[speaker];
          if (!speakerData) return;
          Object.keys(speakerData).forEach((key) => {
            const segment = speakerData[key];
            const energy = calculateEnergy(segment.tone_distribution);
            if (energy > 700) {
              regions.push({
                start: segment.start,
                end: segment.end,
                color: 'rgba(239, 83, 80, 0.3)',
                drag: false,
                resize: false,
              });
            }
          });
        });
        regions.forEach((region) => {
          try {
            waveSurfer.addRegion(region);
          } catch (regionError) {
            console.error('Error adding region:', regionError);
          }
        });
      };

      createRegions();
    } catch (error) {
      console.error('Error in regions useEffect:', error);
    }
  }, [toneAnalysis, waveSurfer, isWaveformReady]);

  const fetchToneAnalysis = async () => {
    try {
      const resp = await axios.get(`${config.apiBaseUrl}/api/tone-analysis/${filename}`);
      if (resp.data.success) {
        setToneAnalysis(resp.data.toneAnalysis);
      } else {
        console.error('Tone analysis not found:', resp.data.message);
      }
    } catch (err) {
      console.error('Error fetching tone analysis:', err);
    }
  };

  function parseToneLabel(label) {
    const matches = label.match(/(\d+(?:\.\d+)?)/g);
    if (!matches || matches.length === 0) return label;
    if (matches.length >= 2) {
      const start = parseFloat(matches[0]);
      const end = parseFloat(matches[1]);
      return `${formatTimeSec(start)} - ${formatTimeSec(end)}`;
    }
    const val = parseFloat(matches[0]);
    return formatTimeSec(val);
  }

  function calculateEnergy(distribution) {
    const { High = 0, Medium = 0, Low = 0 } = distribution;
    return High * 3 + Medium * 2 + Low * 1;
  }

  function getYAxisMax(dataVals) {
    const maxVal = Math.max(...dataVals, 0);
    return Math.ceil(maxVal / 100) * 100 + 100;
  }

  /***************************************
   * 8) TONE CHARTS (Agent/Customer/Combined)
   ***************************************/
  const renderAgentToneChart = () => {
    if (!toneAnalysis?.results?.Agent) return <p>No Agent Tone Data.</p>;

    const agentObj = toneAnalysis.results.Agent;
    const labels = Object.keys(agentObj).map(parseToneLabel);
    const dataVals = Object.keys(agentObj).map(
      (k) => calculateEnergy(agentObj[k].tone_distribution)
    );
    const yMax = getYAxisMax(dataVals);

    // quartiles
    const sortedVals = [...dataVals].sort((a, b) => a - b);
    const q3 = sortedVals[Math.floor(sortedVals.length * 0.75)] || 0;
    const median = sortedVals[Math.floor(sortedVals.length * 0.5)] || 0;

    const data = {
      labels,
      datasets: [
        {
          label: 'Agent Tone Energy',
          data: dataVals,
          borderColor: dataVals.map((val) =>
            val > 700 ? 'rgba(239, 83, 80, 1)' : 'rgba(79, 195, 247, 1)'
          ),
          backgroundColor: 'rgba(79, 195, 247, 0.2)',
          fill: true,
          tension: 0.4,
          pointRadius: 3,
        },
      ],
    };

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { color: '#B0BEC5' } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const val = ctx.parsed.y;
              if (val > 700) return `${ctx.dataset.label}: ${val} (High)`;
              if (val < 300) return `${ctx.dataset.label}: ${val} (Low)`;
              return `${ctx.dataset.label}: ${val} (Medium)`;
            },
          },
        },
        annotation: {
          annotations: {
            lowTone: {
              type: 'box',
              yMin: 0,
              yMax: 300,
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
            },
            midTone: {
              type: 'box',
              yMin: 300,
              yMax: 700,
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
            },
            highTone: {
              type: 'box',
              yMin: 700,
              yMax: yMax,
              backgroundColor: 'rgba(239, 83, 80, 0.05)',
            },
            q3: {
              type: 'line',
              yMin: q3,
              yMax: q3,
              borderColor: 'rgba(239, 83, 80, 0.7)',
              borderWidth: 2,
              label: {
                content: 'Q3',
                enabled: true,
                color: '#B0BEC5',
              },
            },
            median: {
              type: 'line',
              yMin: median,
              yMax: median,
              borderColor: 'rgba(239, 83, 80, 0.5)',
              borderWidth: 2,
              label: {
                content: 'Median',
                enabled: true,
                color: '#B0BEC5',
              },
            },
          },
        },
      },
      scales: {
        y: {
          min: 0,
          max: yMax,
          ticks: { color: '#B0BEC5', stepSize: 100 },
          grid: { color: 'rgba(255, 255, 255, 0.1)', drawBorder: false },
        },
        x: {
          ticks: { color: '#B0BEC5' },
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
        },
      },
    };

    return (
      <div className="resultpage-chart-container">
        <Line data={data} options={options} />
      </div>
    );
  };

  const renderCustomerToneChart = () => {
    if (!toneAnalysis?.results?.Customer) return <p>No Customer Tone Data.</p>;

    const custObj = toneAnalysis.results.Customer;
    const labels = Object.keys(custObj).map(parseToneLabel);
    const dataVals = Object.keys(custObj).map(
      (k) => calculateEnergy(custObj[k].tone_distribution)
    );
    const yMax = getYAxisMax(dataVals);

    // quartiles
    const sortedVals = [...dataVals].sort((a, b) => a - b);
    const q3 = sortedVals[Math.floor(sortedVals.length * 0.75)] || 0;
    const median = sortedVals[Math.floor(sortedVals.length * 0.5)] || 0;

    const data = {
      labels,
      datasets: [
        {
          label: 'Customer Tone Energy',
          data: dataVals,
          borderColor: dataVals.map((val) =>
            val > 700 ? 'rgba(239, 83, 80, 1)' : 'rgba(129, 199, 132, 1)'
          ),
          backgroundColor: 'rgba(129, 199, 132, 0.2)',
          fill: true,
          tension: 0.4,
          pointRadius: 3,
        },
      ],
    };

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { color: '#B0BEC5' } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const val = ctx.parsed.y;
              if (val > 700) return `${ctx.dataset.label}: ${val} (High)`;
              if (val < 300) return `${ctx.dataset.label}: ${val} (Low)`;
              return `${ctx.dataset.label}: ${val} (Medium)`;
            },
          },
        },
        annotation: {
          annotations: {
            lowTone: {
              type: 'box',
              yMin: 0,
              yMax: 300,
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
            },
            midTone: {
              type: 'box',
              yMin: 300,
              yMax: 700,
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
            },
            highTone: {
              type: 'box',
              yMin: 700,
              yMax: yMax,
              backgroundColor: 'rgba(239, 83, 80, 0.05)',
            },
            q3: {
              type: 'line',
              yMin: q3,
              yMax: q3,
              borderColor: 'rgba(239, 83, 80, 0.7)',
              borderWidth: 2,
            },
            median: {
              type: 'line',
              yMin: median,
              yMax: median,
              borderColor: 'rgba(239, 83, 80, 0.5)',
              borderWidth: 2,
            },
          },
        },
      },
      scales: {
        y: {
          min: 0,
          max: yMax,
          ticks: { color: '#B0BEC5', stepSize: 100 },
          grid: { color: 'rgba(255, 255, 255, 0.1)', drawBorder: false },
        },
        x: {
          ticks: { color: '#B0BEC5' },
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
        },
      },
    };

    return (
      <div className="resultpage-chart-container">
        <Line data={data} options={options} />
      </div>
    );
  };

  const renderCombinedToneChart = () => {
    if (!toneAnalysis?.results?.Agent || !toneAnalysis?.results?.Customer) {
      return <p>No Combined Tone Data.</p>;
    }

    const agentObj = toneAnalysis.results.Agent;
    const custObj = toneAnalysis.results.Customer;
    const labels = Object.keys(agentObj).map(parseToneLabel);
    const agentDataVals = Object.keys(agentObj).map(
      (k) => calculateEnergy(agentObj[k].tone_distribution)
    );
    const custDataVals = Object.keys(custObj).map(
      (k) => calculateEnergy(custObj[k].tone_distribution)
    );
    const combinedMax = Math.max(...agentDataVals, ...custDataVals, 0);
    const yMax = Math.ceil(combinedMax / 100) * 100 + 100;

    // quartiles for agent
    const sortedAgentVals = [...agentDataVals].sort((a, b) => a - b);
    const q3_agent = sortedAgentVals[Math.floor(sortedAgentVals.length * 0.75)] || 0;
    const median_agent = sortedAgentVals[Math.floor(sortedAgentVals.length * 0.5)] || 0;

    // quartiles for customer
    const sortedCustVals = [...custDataVals].sort((a, b) => a - b);
    const q3_cust = sortedCustVals[Math.floor(sortedCustVals.length * 0.75)] || 0;
    const median_cust = sortedCustVals[Math.floor(sortedCustVals.length * 0.5)] || 0;

    const data = {
      labels,
      datasets: [
        {
          label: 'Agent Energy',
          data: agentDataVals,
          borderColor: agentDataVals.map((val) =>
            val > 700 ? 'rgba(239, 83, 80, 1)' : 'rgba(79, 195, 247, 1)'
          ),
          backgroundColor: 'rgba(79, 195, 247, 0.2)',
          fill: true,
          tension: 0.4,
          pointRadius: 3,
        },
        {
          label: 'Customer Energy',
          data: custDataVals,
          borderColor: custDataVals.map((val) =>
            val > 700 ? 'rgba(239, 83, 80, 1)' : 'rgba(129, 199, 132, 1)'
          ),
          backgroundColor: 'rgba(129, 199, 132, 0.2)',
          fill: true,
          tension: 0.4,
          pointRadius: 3,
        },
      ],
    };

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { color: '#B0BEC5' } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const val = ctx.parsed.y;
              if (val > 700) return `${ctx.dataset.label}: ${val} (High)`;
              if (val < 300) return `${ctx.dataset.label}: ${val} (Low)`;
              return `${ctx.dataset.label}: ${val} (Medium)`;
            },
          },
        },
        annotation: {
          annotations: {
            lowTone: {
              type: 'box',
              yMin: 0,
              yMax: 300,
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
            },
            midTone: {
              type: 'box',
              yMin: 300,
              yMax: 700,
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
            },
            highTone: {
              type: 'box',
              yMin: 700,
              yMax: yMax,
              backgroundColor: 'rgba(239, 83, 80, 0.05)',
            },
            q3_agent: {
              type: 'line',
              yMin: q3_agent,
              yMax: q3_agent,
              borderColor: 'rgba(239, 83, 80, 0.7)',
              borderWidth: 2,
            },
            median_agent: {
              type: 'line',
              yMin: median_agent,
              yMax: median_agent,
              borderColor: 'rgba(239, 83, 80, 0.5)',
              borderWidth: 2,
            },
            q3_cust: {
              type: 'line',
              yMin: q3_cust,
              yMax: q3_cust,
              borderColor: 'rgba(129, 199, 132, 0.7)',
              borderWidth: 2,
            },
            median_cust: {
              type: 'line',
              yMin: median_cust,
              yMax: median_cust,
              borderColor: 'rgba(129, 199, 132, 0.5)',
              borderWidth: 2,
            },
          },
        },
      },
      scales: {
        y: {
          min: 0,
          max: yMax,
          ticks: { color: '#B0BEC5', stepSize: 100 },
          grid: { color: 'rgba(255, 255, 255, 0.1)', drawBorder: false },
        },
        x: {
          ticks: { color: '#B0BEC5' },
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
        },
      },
    };

    return (
      <div className="resultpage-chart-container">
        <Line data={data} options={options} />
      </div>
    );
  };

  /***************************************
   * 9) SENTIMENT ANALYSIS
   ***************************************/
  const fetchSentiment = async () => {
    try {
      const resp = await axios.get(`${config.apiBaseUrl}/api/sentiment/${filename}`);
      if (resp.data.success) {
        setSentimentData(resp.data.sentiment);
      } else {
        console.warn('No sentiment data found:', resp.data.message);
      }
    } catch (err) {
      console.error('Error fetching sentiment:', err);
    }
  };

  const renderSentimentDonuts = () => {
    if (!sentimentData) return <p>No Sentiment data available.</p>;

    let agentDist = { neutral: 0, positive: 0, negative: 0 };
    let custDist = { neutral: 0, positive: 0, negative: 0 };

    const aSent = sentimentData.agent_sentiment || 'Neutral';
    const cSent = sentimentData.customer_sentiment || 'Neutral';

    // Set 100% to whichever is relevant
    if (aSent.toLowerCase() === 'positive') agentDist.positive = 100;
    else if (aSent.toLowerCase() === 'negative') agentDist.negative = 100;
    else agentDist.neutral = 100;

    if (cSent.toLowerCase() === 'positive') custDist.positive = 100;
    else if (cSent.toLowerCase() === 'negative') custDist.negative = 100;
    else custDist.neutral = 100;

    const agentData = {
      labels: ['Neutral', 'Positive', 'Negative'],
      datasets: [
        {
          data: [agentDist.neutral, agentDist.positive, agentDist.negative],
          backgroundColor: ['#B0BEC5', '#81C784', '#EF5350'],
          hoverOffset: 6,
          borderWidth: 1,
          borderColor: '#2E333B',
        },
      ],
    };
    const custData = {
      labels: ['Neutral', 'Positive', 'Negative'],
      datasets: [
        {
          data: [custDist.neutral, custDist.positive, custDist.negative],
          backgroundColor: ['#B0BEC5', '#81C784', '#EF5350'],
          hoverOffset: 6,
          borderWidth: 1,
          borderColor: '#2E333B',
        },
      ],
    };

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#B0BEC5' } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const label = ctx.label || '';
              const value = ctx.parsed;
              return `${label}: ${value}%`;
            },
          },
        },
      },
    };

    return (
      <div className="resultpage-sentiment-container">
        {/* Customer sentiment */}
        <div className="resultpage-sentiment-card">
          <h4 className="resultpage-sentiment-title">
            Customer Sentiment
          </h4>
          <div className="resultpage-sentiment-chart">
            <Doughnut data={custData} options={options} />
          </div>
        </div>

        {/* Agent sentiment */}
        <div className="resultpage-sentiment-card">
          <h4 className="resultpage-sentiment-title">
            Agent Sentiment
          </h4>
          <div className="resultpage-sentiment-chart">
            <Doughnut data={agentData} options={options} />
          </div>
        </div>
      </div>
    );
  };

  /***************************************
   * 10) AI & MANUAL SCORING
   ***************************************/
  const handleFetchScoring = async () => {
    setLoadingScoring(true);
    setScoreError(null);
    try {
      const resp = await axios.get(
        `${config.apiBaseUrl}/api/custom-scoring-details/${filename}`
      );
      if (resp.data.success) {
        setAiScoring(resp.data.aiScoring || {});
        setManualScoring(resp.data.manualScoring || {});
      } else {
        setScoreError(resp.data.message || 'Scoring data not found.');
      }
    } catch (err) {
      console.error('Error fetching scoring data:', err);
      setScoreError('Server error fetching scoring data.');
    } finally {
      setLoadingScoring(false);
    }
  };

  const handleSubmitManualScores = async () => {
    let lines = [];
    const allParams = new Set([
      ...Object.keys(aiScoring || {}),
      ...Object.keys(manualScoring || {}),
    ]);
    allParams.delete('Overall Scoring');

    allParams.forEach((param) => {
      const inputVal = manualScoresInput[param];
      const dbVal = manualScoring[param];
      const finalVal = inputVal || dbVal || '';
      if (finalVal) {
        lines.push(`${param}: ${finalVal}`);
      }
    });

    if (!lines.length) {
      alert('No manual scores entered.');
      return;
    }

    const finalStr = lines.join('\n');

    try {
      const resp = await axios.post(
        `${config.apiBaseUrl}/api/manual-scoring/${filename}`,
        { manualScoring: finalStr }
      );
      if (resp.data.success) {
        alert('Manual scoring saved!');
        handleFetchScoring();
      } else {
        alert(`Error: ${resp.data.message}`);
      }
    } catch (err) {
      console.error('Error saving manual scores:', err);
      alert('Server error saving manual scores.');
    }
  };

  function computeManualOverall(manualObj) {
    if (manualObj['Overall Scoring']) return manualObj['Overall Scoring'];
    let sum = 0;
    let count = 0;
    for (const [param, val] of Object.entries(manualObj)) {
      if (param !== 'Overall Scoring' && val) {
        const numeric = parseFloat(val.replace('%', '')) || 0;
        sum += numeric;
        count++;
      }
    }
    if (!count) return '';
    return (sum / count).toFixed(2) + '%';
  }

  /***************************************
   * 11) Specialized Inputs
   ***************************************/
  const renderManualInput = (param, localVal) => {
    const handleChange = (newVal) => {
      setManualScoresInput((prev) => ({
        ...prev,
        [param]: newVal,
      }));
    };

    // 1) Rude Behavior => Yes/No
    if (param === 'Rude Behavior') {
      return (
        <select
          className="resultpage-dark-input"
          value={localVal || ''}
          onChange={(e) => handleChange(e.target.value)}
        >
          <option value="">--Select--</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
        </select>
      );
    }

    // 2) Call Type => dropdown
    if (param === 'Call Type') {
      return (
        <select
          className="resultpage-dark-input resultpage-call-type-select"
          value={localVal || ''}
          onChange={(e) => handleChange(e.target.value)}
        >
          <option value="">--Select--</option>
          <option value="Complaint">Complaint</option>
          <option value="Inquiry">Inquiry</option>
          <option value="Transaction Issue">Transaction Issue</option>
          <option value="Account Info Update">Account Info Update</option>
          <option value="Card Activation">Card Activation</option>
        </select>
      );
    }

    // 3) Lead Classification
    if (param === 'Lead Classification') {
      const isLeadSelected = (localVal || '').startsWith('Lead');
      const subVal = localVal?.includes('(Cold lead)')
        ? 'Cold lead'
        : localVal?.includes('(Hot lead)')
        ? 'Hot lead'
        : '';

      const handleSubLeadChange = (subChoice) => {
        handleChange(`Lead (${subChoice})`);
      };

      return (
        <div className="resultpage-lead-classification-container">
          <select
            className="resultpage-dark-input resultpage-lead-select"
            value={isLeadSelected ? 'Lead' : localVal || ''}
            onChange={(e) => handleChange(e.target.value)}
          >
            <option value="">--Select--</option>
            <option value="Not a Lead">Not a Lead</option>
            <option value="Lead">Lead</option>
          </select>
          {isLeadSelected && (
            <select
              className="resultpage-dark-input resultpage-sub-lead-select"
              value={subVal || 'Hot lead'}
              onChange={(e) => handleSubLeadChange(e.target.value)}
            >
              <option value="Hot lead">Hot lead</option>
              <option value="Cold lead">Cold lead</option>
            </select>
          )}
        </div>
      );
    }

    // 4) Resolution Status
    if (param === 'Resolution Status') {
      return (
        <select
          className="resultpage-dark-input resultpage-resolution-select"
          value={localVal || ''}
          onChange={(e) => handleChange(e.target.value)}
        >
          <option value="">--Select--</option>
          <option value="Resolved">Resolved</option>
          <option value="Unresolved">Unresolved</option>
          <option value="Escalated">Escalated</option>
          <option value="Pending Callback">Pending Callback</option>
        </select>
      );
    }

    // 5) Feedback => text area
    if (param === 'Feedback') {
      return (
        <textarea
          className="resultpage-dark-input resultpage-feedback-textarea"
          placeholder="Enter feedback here..."
          value={localVal || ''}
          onChange={(e) => handleChange(e.target.value)}
        />
      );
    }

    // Default => normal text input (e.g. numeric or %)
    return (
      <input
        type="text"
        placeholder="e.g. 70%"
        className="resultpage-dark-input resultpage-numeric-input"
        value={localVal || ''}
        onChange={(e) => handleChange(e.target.value)}
      />
    );
  };

  const renderCallScoring = () => {
    if (loadingScoring) return <p>Loading scoring data...</p>;
    if (scoreError) return <p className="resultpage-error-message">{scoreError}</p>;
    if (!aiScoring) return <p>No scoring data loaded yet.</p>;

    const aiOverall = aiScoring['Overall Scoring'] || 'N/A';
    const finalManualOverall = computeManualOverall(manualScoring);
    const aiEntries = Object.entries(aiScoring).filter(
      ([k]) => k !== 'Overall Scoring'
    );

    return (
      <div className="resultpage-scoring-card">
        <h3 className="resultpage-scoring-title">AI Overall Score: {aiOverall}</h3>
        <p className="resultpage-scoring-subtitle">
          Manual Overall Score: {finalManualOverall}
        </p>
        <table className="resultpage-dark-table">
          <thead>
            <tr>
              <th>Parameter</th>
              <th>AI Score</th>
              <th>Manual Score</th>
            </tr>
          </thead>
          <tbody>
            {aiEntries.map(([param, aiVal]) => {
              const dbVal = manualScoring[param] || '';
              const localVal = manualScoresInput[param] || dbVal;

              return (
                <tr key={param}>
                  <td>{param}</td>
                  <td>{aiVal}</td>
                  <td>{renderManualInput(param, localVal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button
          className="resultpage-dark-button"
          onClick={handleSubmitManualScores}
          aria-label="Submit Manual Scores"
          style={{ marginTop: '1rem', display: 'block', marginLeft: 'auto', marginRight: 'auto' }}
        >
          Submit Manual Scores
        </button>
      </div>
    );
  };

  /***************************************
   * 12) SCRIPT COMPLIANCE GAUGE
   ***************************************/
  const renderScriptCompliance = () => {
    if (scriptCompliance === null) {
      return (
        <p className="resultpage-script-compliance-message">
          Script Compliance data not loaded yet.
        </p>
      );
    }
    const numericVal = parseFloat(scriptCompliance) || 0;
    const fraction = numericVal / 100;

    return (
      <div className="resultpage-script-compliance-card">
        <h3 className="resultpage-script-compliance-title">Script Compliance</h3>
        <div className="resultpage-gauge-container">
          <GaugeChart
            id="script-gauge"
            nrOfLevels={20}
            colors={['#EF5350', '#FFB300', '#81C784']}
            arcWidth={0.3}
            percent={fraction > 1 ? 1 : fraction}
            needleColor="#B0BEC5"
            textColor="#B0BEC5"
          />
        </div>
        <p className="resultpage-script-compliance-value">
          Current Script Compliance:{' '}
          <span>{numericVal.toFixed(2)}%</span>
        </p>
      </div>
    );
  };

  /***************************************
   * 13) RENDER
   ***************************************/
  return (
    <div className="resultpage-container">
      {/* Top Bar */}
      <div className="resultpage-top-bar">
        <h1 className="resultpage-title">
          Call Analysis Dashboard
        </h1>
        <button
          className="resultpage-dashboard-button"
          onClick={() => navigate('/afterlogin')}
          aria-label="Go to Dashboard"
        >
          <FaHome className="resultpage-button-icon" />
          Dashboard
        </button>
      </div>

      {/* Main Content */}
      <div className="resultpage-content">
        {/* Header Section */}
        <div className="resultpage-header">
          <h2 className="resultpage-subtitle">
            Gain Deep Insights from Your Audio Calls via Advanced AI
          </h2>
        </div>

        {/* Transcript + Audio Details */}
        <div className="resultpage-main-content">
          {/* Transcript Card with Summary Button */}
          <div className="resultpage-transcript-card">
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem' }}>
              <button
                className={`resultpage-small-tab-button ${
                  transcriptTab === 'transcript' ? 'resultpage-active-tab' : ''
                }`}
                onClick={() => setTranscriptTab('transcript')}
                aria-label="Show Transcript"
                style={{ margin: 0 }}
              >
                Transcript
              </button>
              <button
                className={`resultpage-small-tab-button ${
                  transcriptTab === 'summary' ? 'resultpage-active-tab' : ''
                }`}
                onClick={() => setTranscriptTab('summary')}
                aria-label="Show Summary"
                style={{ marginLeft: '1rem' }}
              >
                Summary
              </button>
            </div>
            {transcriptTab === 'transcript' ? (
              <div
                className="resultpage-transcript-content"
                dangerouslySetInnerHTML={{ __html: transcription }}
              />
            ) : (
              <div className="resultpage-transcript-content">
                <p>{summary}</p>
              </div>
            )}
          </div>

          {/* Audio Card */}
          <div className="resultpage-audio-card">
            <h3 className="resultpage-card-title">Audio File Details</h3>
            <ul className="resultpage-audio-details">
              <li>
                <FaFileAudio className="resultpage-icon" />
                <span className="resultpage-label">Audio Name:</span>
                <span className="resultpage-value">
                  {audioDetails.AudioFileName || 'Not Available'}
                </span>
              </li>
              <li>
                <FaCalendarAlt className="resultpage-icon" />
                <span className="resultpage-label">Upload Date:</span>
                <span className="resultpage-value">
                  {audioDetails.UploadDate || 'Not Available'}
                </span>
              </li>
              <li>
                <FaUser className="resultpage-icon" />
                <span className="resultpage-label">Agent:</span>
                <span className="resultpage-value">
                  {audioDetails.AgentName || 'Not Available'}
                </span>
              </li>
              <li>
                <FaPhone className="resultpage-icon" />
                <span className="resultpage-label">Call Type:</span>
                <span className="resultpage-value">
                  {audioDetails.CallType || 'Not Available'}
                </span>
              </li>
              <li>
                <FaLanguage className="resultpage-icon" />
                <span className="resultpage-label">Language:</span>
                <span className="resultpage-value">
                  {audioDetails.AudioLanguage || 'N/A'}
                </span>
              </li>
              <li>
                <FaMicrophoneAlt className="resultpage-icon" />
                <span className="resultpage-label">Duration:</span>
                <span className="resultpage-value">
                  {audioDetails.AudioDuration
                    ? isNaN(audioDetails.AudioDuration)
                      ? audioDetails.AudioDuration
                      : formatTimeSec(audioDetails.AudioDuration)
                    : 'Not Available'}
                </span>
              </li>
              <li>
                <FaInfoCircle className="resultpage-icon" />
                <span className="resultpage-label">Status:</span>
                <span className="resultpage-value">
                  {audioDetails.Status || 'Not Available'}
                </span>
              </li>
            </ul>

            {/* WaveSurfer */}
            <div ref={waveformRef} className="resultpage-waveform" />

            {/* Audio Controls */}
            <div className="resultpage-audio-controls">
              <button
                className="resultpage-action-button resultpage-play-button"
                onClick={handlePlayPause}
                aria-label="Play or Pause Audio"
              >
                {isPlaying ? 'Pause' : 'Play'}
              </button>
              <button
                className="resultpage-action-button resultpage-download-button"
                onClick={handleDownload}
                aria-label="Download Audio"
              >
                <FaDownload className="resultpage-button-icon" />
                Download
              </button>
            </div>
          </div>
        </div>

        {/* Tab Buttons */}
        <div className="resultpage-button-container">
          <button
            className={`resultpage-tab-button ${
              activeTab === 'tone' ? 'resultpage-active-tab' : ''
            }`}
            onClick={() => {
              fetchToneAnalysis();
              setActiveTab(activeTab === 'tone' ? 'none' : 'tone');
            }}
            aria-label="Toggle Tone Analysis"
          >
            Tone Analysis
          </button>
          <button
            className={`resultpage-tab-button ${
              activeTab === 'sentiment' ? 'resultpage-active-tab' : ''
            }`}
            onClick={() => {
              fetchSentiment();
              setActiveTab(activeTab === 'sentiment' ? 'none' : 'sentiment');
            }}
            aria-label="Toggle Sentiment Analysis"
          >
            Sentiment
          </button>
          <button
            className={`resultpage-tab-button ${
              activeTab === 'scoring' ? 'resultpage-active-tab' : ''
            }`}
            onClick={() => {
              handleFetchScoring();
              setActiveTab(activeTab === 'scoring' ? 'none' : 'scoring');
            }}
            aria-label="Toggle Scoring"
          >
            Scoring
          </button>
          <button
            className={`resultpage-tab-button ${
              activeTab === 'script' ? 'resultpage-active-tab' : ''
            }`}
            onClick={() => {
              handleFetchScoring();
              handleFetchScriptCompliance();
              setActiveTab(activeTab === 'script' ? 'none' : 'script');
            }}
            aria-label="Toggle Script Compliance"
          >
            Script Compliance
          </button>
        </div>

        {/* Conditional Tab Content */}
        {activeTab === 'tone' && (
          <div className="resultpage-tab-content">
            {renderAgentToneChart()}
            {renderCustomerToneChart()}
            {renderCombinedToneChart()}
          </div>
        )}
        {activeTab === 'sentiment' && (
          <div className="resultpage-tab-content">
            {renderSentimentDonuts()}
          </div>
        )}
        {activeTab === 'scoring' && (
          <div className="resultpage-tab-content">
            {renderCallScoring()}
          </div>
        )}
        {activeTab === 'script' && (
          <div className="resultpage-tab-content">
            {renderScriptCompliance()}
          </div>
        )}
      </div>
    </div>
  );
};

export default ResultPage;