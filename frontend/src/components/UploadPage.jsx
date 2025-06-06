import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './AfterLogin.css'; // Custom CSS for styling
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css'; // Date picker styles
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css'; // Toastify
import { useNavigate } from 'react-router-dom';
import config from "../utils/envConfig"; // Import environment config

// Icons
import {
  FaFileAudio,
  FaCalendarAlt,
  FaUser,
  FaUserTag,
  FaHome,
  FaQuestionCircle,
} from 'react-icons/fa';

/**
 * Author: $Panja
 * Creation Date: 2024-12-27
 * Signature Check: Do not modify this code without verifying the signature logic.
 * Description: UploadPage component for uploading audio files and monitoring their processing status.
 * Compliance: Aligns with ISO/IEC 27001 for secure data handling and error management.
 */

// -- BEGIN SIGNATURE CHECK --
const requiredSignature = '$Panja';

function verifySignature() {
  if (!requiredSignature || requiredSignature.trim() !== '$Panja') {
    alert("Author signature mismatch. Please contact 'panja.suvadip@gmail.com'");
    throw new Error('Author signature mismatch');
  }
}
verifySignature();
// -- END SIGNATURE CHECK --

const UploadPage = () => {
  // --------------------------------------------------
  // State Declarations
  // --------------------------------------------------
  const [audioFile, setAudioFile] = useState(null);
  const fileInputRef = useRef(null);
  const [callType, setCallType] = useState('inbound');
  const [selectedDate, setSelectedDate] = useState(null);

  // Agent selection
  const [agentsList, setAgentsList] = useState([]);
  const [typedAgent, setTypedAgent] = useState('');
  const [agent, setAgent] = useState('');
  const [showAgentDropdown, setShowAgentDropdown] = useState(false);

  // Loading / Processing
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentFileName, setCurrentFileName] = useState('');

  // Success Modal
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [hasShownSuccessToast, setHasShownSuccessToast] = useState(false);

  // Failure Modal
  const [showFailureModal, setShowFailureModal] = useState(false);

  // Rotating Messages
  const [currentMessage, setCurrentMessage] = useState('');
  const messages = [
    "Please wait, your audio is being processed... 🎧",
    "Our platform supports 101 languages seamlessly! 🌍",
    "Stay tuned, we're analyzing your audio! ⏳",
    "Gain real-time insights with our AI technology! 📊",
    "Thank you for your patience, we're almost done! ✨"
  ];

  // Ref for agent dropdown
  const agentDropdownRef = useRef(null);

  // For navigation
  const navigate = useNavigate();

  // --------------------------------------------------
  // Rotate Messages During Processing
  // --------------------------------------------------
  useEffect(() => {
    if (!isProcessing) {
      setCurrentMessage('');
      return;
    }

    let messageIndex = 0;
    setCurrentMessage(messages[messageIndex]);

    const interval = setInterval(() => {
      messageIndex = (messageIndex + 1) % messages.length;
      setCurrentMessage(messages[messageIndex]);
    }, 25000); // 25 seconds

    return () => clearInterval(interval);
  }, [isProcessing]);

  // --------------------------------------------------
  // Fetch Agents by callType
  // --------------------------------------------------
  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const response = await axios.get(
          `${config.apiBaseUrl}/api/agents/${callType}`,
          {
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
        setAgentsList(response.data || []);
      } catch (error) {
        console.error('Error fetching agents:', error.message);
        toast.error('Failed to fetch agents. Please try again later.', {
          position: 'top-center',
          autoClose: 3000,
          theme: 'dark',
        });
      }
    };
    fetchAgents();
  }, [callType]);

  // --------------------------------------------------
  // Poll for AI Processing Status
  // --------------------------------------------------
  useEffect(() => {
    if (!currentFileName) return;

    let interval;

    const pollStatus = async () => {
      try {
        const res = await axios.get(
          `${config.apiBaseUrl}/api/audio-status/${currentFileName}`,
          {
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
        const { status } = res.data;
        if (!status) return;

        if (status === 'In Progress') {
          return;
        } else if (status === 'Success') {
          clearInterval(interval);
          setIsProcessing(false);
          if (!hasShownSuccessToast) {
            toast.success('Processing complete! Click to view results.', {
              position: 'top-center',
              autoClose: 3000,
              theme: 'colored',
            });
            setHasShownSuccessToast(true);
          }
          setShowSuccessModal(true);
        } else if (status === 'Fail') {
          clearInterval(interval);
          setIsProcessing(false);
          setShowFailureModal(true);
        }
      } catch (error) {
        console.error('Error polling status:', error.message);
        clearInterval(interval);
        setIsProcessing(false);
        toast.error('Failed to fetch status. Processing may have failed.', {
          position: 'top-center',
          autoClose: 3000,
          theme: 'dark',
        });
      }
    };

    interval = setInterval(pollStatus, 2000);
    return () => clearInterval(interval);
  }, [currentFileName, hasShownSuccessToast]);

  // --------------------------------------------------
  // Close Agent Dropdown if click outside
  // --------------------------------------------------
  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (
        agentDropdownRef.current &&
        !agentDropdownRef.current.contains(event.target)
      ) {
        setShowAgentDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // --------------------------------------------------
  // Handle File Selection with Validation
  // --------------------------------------------------
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
      toast.error('File size exceeds 15 MB. Please select a smaller file.', {
        position: 'top-center',
        autoClose: 3000,
        theme: 'dark',
      });
      return;
    }

    if (!file.type.startsWith('audio/')) {
      toast.error('Please select a valid audio file.', {
        position: 'top-center',
        autoClose: 3000,
        theme: 'dark',
      });
      return;
    }

    setAudioFile(file);
  };

  // --------------------------------------------------
  // Reset Form
  // --------------------------------------------------
  const resetForm = () => {
    setAudioFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setCallType('inbound');
    setSelectedDate(null);
    setTypedAgent('');
    setAgent('');
  };

  // --------------------------------------------------
  // Submit Upload with Validation
  // --------------------------------------------------
  const handleSubmit = async () => {
    if (!audioFile || !agent || !selectedDate) {
      toast.error('Please fill all the fields to proceed!', {
        position: 'top-center',
        autoClose: 3000,
        theme: 'dark',
      });
      return;
    }

    setIsLoading(true);

    const adjustedDate = new Date(
      selectedDate.getTime() - selectedDate.getTimezoneOffset() * 60000
    );

    const formData = new FormData();
    formData.append('audioFile', audioFile);
    formData.append('agent', agent);
    formData.append('callType', callType);
    formData.append('date', adjustedDate.toISOString().split('T')[0]);

    try {
      const response = await axios.post(
        `${config.apiBaseUrl}/upload-audio`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );
      if (response.data.success) {
        toast.success('Upload successful!', {
          position: 'top-center',
          autoClose: 2000,
          theme: 'colored',
        });

        resetForm();

        try {
          const latestAudio = await axios.get(
            `${config.apiBaseUrl}/api/latest-audio`,
            {
              headers: {
                'Content-Type': 'application/json',
              },
            }
          );
          if (latestAudio.data.success) {
            const { AudioFileName } = latestAudio.data.data;
            setCurrentFileName(AudioFileName);
            setIsProcessing(true);
            setHasShownSuccessToast(false);
          } else {
            toast.error('Failed to fetch the latest audio details.', {
              position: 'top-center',
              autoClose: 3000,
              theme: 'dark',
            });
          }
        } catch (err) {
          console.error('Error fetching latest audio:', err.message);
          toast.error('Unable to retrieve latest audio info.', {
            position: 'top-center',
            autoClose: 3000,
            theme: 'dark',
          });
        }
      } else {
        toast.error(`Upload failed: ${response.data.message}`, {
          position: 'top-center',
          autoClose: 3000,
          theme: 'dark',
        });
      }
    } catch (error) {
      console.error('Error during upload:', error.message);
      toast.error('An error occurred. Please try again.', {
        position: 'top-center',
        autoClose: 3000,
        theme: 'dark',
      });
    } finally {
      setIsLoading(false);
    }
  };

  // --------------------------------------------------
  // Agent Filter
  // --------------------------------------------------
  const filteredAgents = (() => {
    if (!typedAgent.trim()) return agentsList;
    const lower = typedAgent.toLowerCase();
    return agentsList.filter((item) => {
      const nameMatch = item.agent_name?.toLowerCase().includes(lower);
      const idMatch = item.agent_id?.toString().toLowerCase().includes(lower);
      return nameMatch || idMatch;
    });
  })();

  // Handle agent selection on Enter key
  const handleAgentKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredAgents.length === 1) {
        const single = filteredAgents[0];
        setAgent(single.agent_name);
        setTypedAgent(single.agent_name);
        setShowAgentDropdown(false);
      } else if (filteredAgents.length === 0) {
        toast.error('No agent found for that input.', {
          position: 'top-center',
          autoClose: 2000,
          theme: 'dark',
        });
      }
    }
  };

  const handleAgentClick = (item) => {
    setAgent(item.agent_name);
    setTypedAgent(item.agent_name);
    setShowAgentDropdown(false);
  };

  // --------------------------------------------------
  // Modal Handlers
  // --------------------------------------------------
  const handleViewResults = () => {
    navigate(`/results/${currentFileName}`);
  };

  const handleBackToUpload = () => {
    setShowSuccessModal(false);
    setShowFailureModal(false);
    setCurrentFileName('');
    setIsProcessing(false);
  };

  // --------------------------------------------------
  // Render
  // --------------------------------------------------
  return (
    <div className="dark-container">
      <style>
        {`
          .dark-container {
            background: #222831;
            min-height: 100vh;
            position: relative;
            overflow: hidden;
          }

          .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.85);
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 1000;
          }

          .dark-card {
            background: #393E46;
            border: 1px solid rgba(0, 212, 255, 0.2);
            box-shadow: 0 0 10px rgba(0, 212, 255, 0.1);
          }

          .navbar {
            background: #393E46;
            border: 1px solid rgba(0, 212, 255, 0.2);
          }

          .nav-links button {
            background: #FF4500;
            color: #FFFFFF;
            border: none;
            padding: 0.5rem 1rem;
            border-radius: 8px;
            transition: transform 0.2s;
          }

          .nav-links button:hover {
            transform: scale(1.05);
          }

          label, input, .upload-input, .agent-autocomplete {
            color: #00D4FF !important;
            font-family: 'Inter', sans-serif !important;
            font-weight: 500 !important;
          }

          .dark-button {
            background: #FF4500;
            border: none;
            transition: transform 0.2s;
          }

          .dark-button:hover {
            transform: scale(1.05);
          }

          .vortex-animation {
            width: 200px;
            height: 200px;
            position: relative;
            transform-style: preserve-3d;
            animation: rotate-3d 15s linear infinite;
          }

          @keyframes rotate-3d {
            0% { transform: rotateX(0deg) rotateY(0deg); }
            100% { transform: rotateX(360deg) rotateY(360deg); }
          }

          .vortex-core {
            position: absolute;
            top: 50%;
            left: 50%;
            width: 60px;
            height: 60px;
            background: radial-gradient(circle, #00D4FF, #FFFFFF);
            border-radius: 50%;
            transform: translate(-50%, -50%);
            animation: pulse-core 2s ease-in-out infinite;
            box-shadow: 0 0 30px #00D4FF;
          }

          @keyframes pulse-core {
            0% { transform: translate(-50%, -50%) scale(1); opacity: 0.7; }
            50% { transform: translate(-50%, -50%) scale(1.2); opacity: 1; }
            100% { transform: translate(-50%, -50%) scale(1); opacity: 0.7; }
          }

          .vortex-swirl::before,
          .vortex-swirl::after {
            content: '';
            position: absolute;
            width: 200px;
            height: 200px;
            border-radius: 50%;
            border: 3px solid transparent;
            border-top-color: #FF4500;
            border-right-color: #00D4FF;
            animation: swirl 3s linear infinite;
          }

          .vortex-swirl::after {
            animation-delay: 1.5s;
            border-top-color: #00D4FF;
            border-right-color: #FF4500;
          }

          @keyframes swirl {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }

          .vortex-particle {
            position: absolute;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #FFFFFF;
            box-shadow: 0 0 10px #00D4FF;
            animation: particle-orbit 5s infinite linear;
          }

          .vortex-particle:nth-child(1) { animation-delay: 0s; }
          .vortex-particle:nth-child(2) { animation-delay: 1s; }
          .vortex-particle:nth-child(3) { animation-delay: 2s; }
          .vortex-particle:nth-child(4) { animation-delay: 3s; }

          @keyframes particle-orbit {
            0% { transform: rotate(0deg) translateX(80px) rotate(0deg); opacity: 1; }
            50% { opacity: 0.5; }
            100% { transform: rotate(360deg) translateX(80px) rotate(-360deg); opacity: 1; }
          }

          .message-text {
            color: #FFFFFF;
            font-size: 1.8rem;
            font-weight: 700;
            text-shadow: 0 0 10px #00D4FF;
            animation: slide-up 2s ease-in-out;
            font-family: 'Inter', sans-serif;
            margin-top: 2rem;
          }

          @keyframes slide-up {
            0% { transform: translateY(30px); opacity: 0; }
            10% { transform: translateY(0); opacity: 1; }
            90% { transform: translateY(0); opacity: 1; }
            100% { transform: translateY(-30px); opacity: 0; }
          }

          .success-animation {
            position: relative;
            background: #393E46;
            border: 1px solid rgba(0, 212, 255, 0.2);
            padding: 2rem;
            border-radius: 20px;
            animation: fade-in 1s ease-out;
            max-width: 600px;
            width: 90%;
            text-align: center;
          }

          @keyframes fade-in {
            0% { opacity: 0; }
            100% { opacity: 1; }
          }

          .success-text {
            color: #FFFFFF;
            font-size: 2rem;
            font-weight: 700;
            text-shadow: 0 0 10px #00D4FF;
            font-family: 'Inter', sans-serif;
          }

          .failure-animation {
            animation: glitch 0.5s ease-in-out;
            position: relative;
            background: #393E46;
            border: 1px solid rgba(0, 212, 255, 0.2);
            padding: 2rem;
            border-radius: 20px;
            max-width: 600px;
            width: 90%;
          }

          @keyframes glitch {
            0% { transform: translate(0); opacity: 1; }
            20% { transform: translate(-5px, 0); opacity: 0.8; }
            40% { transform: translate(5px, 0); opacity: 0.9; }
            60% { transform: translate(-3px, 0); opacity: 0.8; }
            80% { transform: translate(3px, 0); opacity: 0.9; }
            100% { transform: translate(0); opacity: 1; }
          }

          .failure-text {
            color: #FF4500;
            font-size: 2rem;
            font-weight: 700;
            text-shadow: 0 0 10px #FF4500;
            font-family: 'Inter', sans-serif;
          }

          .modern-button {
            padding: 0.8rem 1.5rem;
            border: none;
            border-radius: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
            font-family: 'Inter', sans-serif;
            position: relative;
            overflow: hidden;
          }

          .modern-button:hover {
            transform: translateY(-3px);
            box-shadow: 0 6px 12px rgba(0, 0, 0, 0.4);
          }

          .modern-button::after {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
            transition: 0.5s;
          }

          .modern-button:hover::after {
            left: 100%;
          }

          .reupload-button {
            background: #FF4500;
            color: #FFFFFF;
            animation: pulse-button 2s infinite;
          }

          @keyframes pulse-button {
            0% { box-shadow: 0 0 0 0 rgba(255, 69, 0, 0.7); }
            70% { box-shadow: 0 0 0 10px rgba(255, 69, 0, 0); }
            100% { box-shadow: 0 0 0 0 rgba(255, 69, 0, 0); }
          }
        `}
      </style>

      {/* TOP BAR */}
      <div
        className="navbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '1rem 2rem',
          borderRadius: '8px',
          marginBottom: '1rem',
          position: 'relative',
        }}
      >
        <h2
          style={{
            color: '#FFD700',
            fontSize: '1.8rem',
            fontWeight: 'bold',
            margin: '0 auto',
            fontFamily: 'Inter, sans-serif',
          }}
        >
          AI-Driven Call Analytics Platform
        </h2>

        <div
          style={{
            position: 'absolute',
            right: '2rem',
            display: 'flex',
            gap: '1rem',
          }}
          className="nav-links"
        >
          <button
            className="modern-3d-btn"
            onClick={() => navigate('./AfterLogin.js')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
            }}
            aria-label="Go to Dashboard"
          >
            <FaHome style={{ marginRight: '0.3rem' }} /> Dashboard
          </button>
          <button
            className="modern-3d-btn"
            onClick={() => navigate('/help')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
            }}
            aria-label="Go to Help"
          >
            <FaQuestionCircle style={{ marginRight: '0.3rem' }} /> Help
          </button>
        </div>
      </div>

      {/* Processing Animation */}
      {isProcessing && !showSuccessModal && !showFailureModal && (
        <div className="modal-overlay">
          <div className="vortex-animation">
            <div className="vortex-core"></div>
            <div className="vortex-swirl"></div>
            <div className="vortex-particle" style={{ transform: 'rotate(0deg) translateX(80px)' }}></div>
            <div className="vortex-particle" style={{ transform: 'rotate(90deg) translateX(80px)' }}></div>
            <div className="vortex-particle" style={{ transform: 'rotate(180deg) translateX(80px)' }}></div>
            <div className="vortex-particle" style={{ transform: 'rotate(270deg) translateX(80px)' }}></div>
          </div>
          <h3 className="message-text">{currentMessage}</h3>
        </div>
      )}

      {/* Success Animation */}
      {showSuccessModal && (
        <div className="modal-overlay">
          <div className="success-animation">
            <h2 className="success-text">
              Your audio has been successfully processed 😊
            </h2>
            <p style={{ margin: '1rem 0', color: '#FFFFFF', fontFamily: 'Inter, sans-serif' }}>
              Ready to view your results!
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
              <button
                className="modern-button"
                style={{ background: '#00D4FF', color: '#000' }}
                onClick={handleViewResults}
                aria-label="View Results"
              >
                View Results
              </button>
              <button
                className="modern-button"
                style={{ background: '#FF4500', color: '#FFF' }}
                onClick={handleBackToUpload}
                aria-label="Back to Upload"
              >
                Back to Upload
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Failure Animation */}
      {showFailureModal && (
        <div className="modal-overlay">
          <div className="failure-animation">
            <h2 className="failure-text">
              Oops, something went wrong 😢
            </h2>
            <p style={{ margin: '1rem 0', color: '#FFFFFF', fontFamily: 'Inter, sans-serif' }}>
              Let's try again!
            </p>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button
                className="modern-button reupload-button"
                onClick={handleBackToUpload}
                aria-label="Re-upload Audio"
              >
                Re-upload Audio
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Upload Card */}
      <div
        className="dark-card"
        style={{
          padding: '2rem',
          maxWidth: '500px',
          margin: '0 auto',
          borderRadius: '12px',
        }}
      >
        {isLoading && (
          <p
            style={{
              textAlign: 'center',
              color: '#FFD700',
              fontWeight: 'bold',
              fontFamily: 'Inter, sans-serif',
            }}
          >
            Uploading, please wait...
          </p>
        )}

        {/* File Input */}
        <div style={{ marginBottom: '1.5rem' }}>
          <label
            style={{ display: 'block', marginBottom: '0.5rem' }}
            htmlFor="audio-file"
          >
            <FaFileAudio style={{ marginRight: '0.5rem' }} />
            Upload Audio File
          </label>
          <input
            type="file"
            id="audio-file"
            accept="audio/*"
            ref={fileInputRef}
            onChange={handleFileChange}
            style={{
              width: '100%',
              padding: '1rem',
              borderRadius: '8px',
              background: '#222831',
              border: 'none',
            }}
            aria-required="true"
          />
        </div>

        {/* Date Picker */}
        <div style={{ marginBottom: '1.5rem' }}>
          <label
            style={{ display: 'block', marginBottom: '0.5rem' }}
            htmlFor="call-date"
          >
            <FaCalendarAlt style={{ marginRight: '0.5rem' }} />
            Select Call Date
          </label>
          <DatePicker
            id="call-date"
            selected={selectedDate}
            onChange={(date) => setSelectedDate(date)}
            dateFormat="yyyy-MM-dd"
            placeholderText="Select a date."
            className="upload-input"
            showPopperArrow={false}
            aria-required="true"
            style={{
              width: '100%',
              padding: '1rem',
              borderRadius: '8px',
              background: '#222831',
              border: 'none',
            }}
          />
        </div>

        {/* Call Type */}
        <div style={{ marginBottom: '1.5rem' }}>
          <label
            style={{
              display: 'block',
              marginBottom: '0.5rem',
            }}
          >
            <FaUserTag style={{ marginRight: '0.5rem' }} />
            Call Type
          </label>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <label>
              <input
                type="radio"
                value="inbound"
                checked={callType === 'inbound'}
                onChange={() => setCallType('inbound')}
                style={{ marginRight: '0.5rem' }}
                aria-label="Inbound Call Type"
              />
              Inbound
            </label>
            <label>
              <input
                type="radio"
                value="outbound"
                checked={callType === 'outbound'}
                onChange={() => setCallType('outbound')}
                style={{ marginRight: '0.5rem' }}
                aria-label="Outbound Call Type"
              />
              Outbound
            </label>
          </div>
        </div>

        {/* Agent Selection */}
        <div
          style={{ marginBottom: '1.5rem', position: 'relative' }}
          ref={agentDropdownRef}
        >
          <label
            style={{ display: 'block', marginBottom: '0.5rem' }}
            htmlFor="agent-select"
          >
            <FaUser style={{ marginRight: '0.5rem' }} />
            Select Agent
          </label>
          <input
            id="agent-select"
            type="text"
            placeholder="Type agent name or ID..."
            value={typedAgent}
            onChange={(e) => {
              setTypedAgent(e.target.value);
              setShowAgentDropdown(true);
            }}
            onFocus={() => setShowAgentDropdown(true)}
            onKeyDown={handleAgentKeyDown}
            style={{
              width: '100%',
              padding: '0.8rem',
              borderRadius: '8px',
              background: '#222831',
              border: 'none',
              outline: 'none',
            }}
            className="agent-autocomplete"
            aria-required="true"
            aria-autocomplete="list"
          />

          {showAgentDropdown && (
            <div className="agent-autocomplete-menu">
              {filteredAgents.length > 0 ? (
                filteredAgents.slice(0, 50).map((item, idx) => (
                  <div
                    key={idx}
                    className="agent-autocomplete-item"
                    onClick={() => handleAgentClick(item)}
                    role="option"
                    aria-selected={agent === item.agent_name}
                    style={{ color: '#00D4FF' }}
                  >
                    {item.agent_name}
                    {item.agent_id ? ` (ID: ${item.agent_id})` : ''}
                  </div>
                ))
              ) : (
                <div className="agent-autocomplete-noitem">No agent found.</div>
              )}
            </div>
          )}
        </div>

        {/* Submit Button */}
        <button
          className="dark-button"
          onClick={handleSubmit}
          style={{
            width: '100%',
            padding: '1rem',
            fontSize: '1.2rem',
            color: '#FFF',
            borderRadius: '8px',
            marginTop: '1rem',
          }}
          aria-label="Submit for AI Analysis"
        >
          Submit for AI Analysis
        </button>
      </div>

      <ToastContainer />
    </div>
  );
};

export default UploadPage;