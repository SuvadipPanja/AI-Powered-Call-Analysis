/**
 * File: Agents.js
 * Purpose: Page for managing agents, including listing, searching, editing, and deactivating agents.
 * Author: $Panja
 * Creation Date: 2024-12-27
 * Signature Check: Do not modify this code without verifying the signature logic.
 * Updated: 2025-04-26
 * Summary of Changes:
 *  - Aligned UI with AfterLogin.js (gradient buttons, neon effects, dark theme).
 *  - Moved navbar buttons to the right, updated Dashboard icon to FaHome.
 *  - Implemented automatic search with debounce and reset on clear.
 *  - Fixed modal centering, increased modal size for better visibility, and ensured it opens directly in the viewport center.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './AfterLogin.css';
import config from "../utils/envConfig"; // Environment configuration for API URLs
import {
  FaHeadset,
  FaUserPlus,
  FaQuestionCircle,
  FaHome,
  FaTimesCircle,
} from "react-icons/fa";

// Debounce function to delay search API calls
const debounce = (func, delay) => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
};

const Agents = () => {
  /***************************************
   * 1) CODE INTEGRITY CHECK
   * Purpose: Ensures the code has not been tampered with.
   * Compliance: IS Policy (Security), Code Audit Policy.
   ***************************************/
  const signature = '$Panja';
  const verifySignature = (sig) => {
    if (sig !== '$Panja') {
      throw new Error('Signature mismatch: Code integrity compromised');
    }
  };
  verifySignature(signature);

  /***************************************
   * 2) MAIN LOGIC & FETCH
   * Purpose: Manages the state and API calls for agent management.
   * Compliance: IS Policy (Security: Secure API calls), ISO 27001 (Secure API communication).
   ***************************************/
  const navigate = useNavigate();
  const [agents, setAgents] = useState([]);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalPosition, setModalPosition] = useState({ top: 0, left: 0 });

  // Fetch all agents
  const fetchAllAgents = async () => {
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/agents`);
      if (!res.ok) {
        throw new Error('Failed to fetch agents');
      }
      const data = await res.json();
      setAgents(data);
    } catch (err) {
      console.error('Error fetching agents:', err.message);
      setError('Failed to fetch agents');
    }
  };

  // Search agents by name or ID
  const searchAgents = async (query) => {
    try {
      const res = await fetch(
        `${config.apiBaseUrl}/api/agents/search?q=${encodeURIComponent(query)}`
      );
      if (!res.ok) {
        throw new Error('Search request failed');
      }
      const data = await res.json();
      setAgents(data);
    } catch (err) {
      console.error('Error searching agents:', err.message);
      setError('Failed to search agents');
    }
  };

  // Debounced search function
  const debouncedSearch = debounce((query) => {
    if (query.trim() === '') {
      fetchAllAgents();
    } else {
      searchAgents(query.trim());
    }
  }, 300);

  // On mount, fetch all agents
  useEffect(() => {
    fetchAllAgents();
  }, []);

  // Recalculate modal position when the modal opens or the viewport changes
  useEffect(() => {
    if (isModalOpen) {
      const updateModalPosition = () => {
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;
        const scrollY = window.scrollY || window.pageYOffset;
        const scrollX = window.scrollX || window.pageXOffset;
        const top = (viewportHeight / 2) + scrollY;
        const left = (viewportWidth / 2) + scrollX;
        setModalPosition({ top, left });
      };

      updateModalPosition();
      window.addEventListener('resize', updateModalPosition);
      window.addEventListener('scroll', updateModalPosition);

      return () => {
        window.removeEventListener('resize', updateModalPosition);
        window.removeEventListener('scroll', updateModalPosition);
      };
    }
  }, [isModalOpen]);

  // Handle search input changes and trigger search automatically
  const handleSearchChange = (e) => {
    const query = e.target.value;
    setSearchQuery(query);
    debouncedSearch(query);
  };

  // Edit agent - open modal directly in the center
  const handleEdit = (agent) => {
    setSelectedAgent(agent);

    // Calculate the center of the current viewport
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const scrollY = window.scrollY || window.pageYOffset;
    const scrollX = window.scrollX || window.pageXOffset;
    const top = (viewportHeight / 2) + scrollY;
    const left = (viewportWidth / 2) + scrollX;

    // Set position before opening the modal to avoid initial jump
    setModalPosition({ top, left });
    setIsModalOpen(true);
  };

  // Save agent
  const handleSave = async () => {
    if (!selectedAgent) return;
    try {
      const res = await fetch(
        `${config.apiBaseUrl}/api/agents/${selectedAgent.agent_id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent_name: selectedAgent.agent_name,
            agent_mobile: selectedAgent.agent_mobile,
            agent_email: selectedAgent.agent_email,
            supervisor: selectedAgent.supervisor,
            agent_type: selectedAgent.agent_type,
            manager: selectedAgent.manager,
            auditor: selectedAgent.auditor,
            notes: selectedAgent.notes,
            agent_location: selectedAgent.agent_location
          }),
        }
      );
      if (!res.ok) {
        throw new Error('Failed to update agent');
      }
      alert('Agent updated successfully');
      setIsModalOpen(false);
      setSelectedAgent(null);

      // Refresh results
      if (searchQuery.trim() === '') {
        fetchAllAgents();
      } else {
        searchAgents(searchQuery.trim());
      }
    } catch (err) {
      console.error('Error updating agent:', err.message);
      alert('Failed to update agent');
    }
  };

  // Deactivate agent
  const handleDeactivate = async () => {
    if (!selectedAgent) return;
    if (!window.confirm('Are you sure you want to deactivate this agent?')) return;

    try {
      const res = await fetch(
        `${config.apiBaseUrl}/api/agents/${selectedAgent.agent_id}/deactivate`,
        {
          method: 'PUT'
        }
      );
      if (!res.ok) {
        throw new Error('Failed to deactivate agent');
      }
      alert('Agent deactivated successfully');
      setIsModalOpen(false);
      setSelectedAgent(null);

      // Refresh results
      if (searchQuery.trim() === '') {
        fetchAllAgents();
      } else {
        searchAgents(searchQuery.trim());
      }
    } catch (err) {
      console.error('Error deactivating agent:', err.message);
      alert('Failed to deactivate agent');
    }
  };

  // Delete agent
  const handleDelete = async (agentId) => {
    if (!window.confirm('Are you sure you want to delete this agent?')) return;
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/agents/${agentId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        throw new Error('Failed to delete agent');
      }
      alert('Agent deleted successfully');
      setAgents((prev) => prev.filter((a) => a.agent_id !== agentId));
    } catch (err) {
      console.error('Error deleting agent:', err.message);
      alert('Failed to delete agent');
    }
  };

  return (
    <div className="dark-container fadeInUp improved-afterlogin modern-page-animation" style={{
      background: "linear-gradient(135deg, #1a1a1a 0%, #222831 100%)",
      padding: "2rem 1.5rem",
      minHeight: "100vh"
    }}>
      {/* ============ NAVBAR ============ */}
      <nav className="navbar improved-navbar" style={{
        background: "linear-gradient(90deg, #393e46 0%, #2e333b 100%)",
        borderRadius: "12px",
        padding: "1rem 1.5rem",
        marginBottom: "1.5rem",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
        display: "flex",
        alignItems: "center"
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.5rem 1rem"
        }}>
          <FaHeadset style={{ color: "#00adb5", fontSize: "1.5rem" }} />
          <span style={{ fontSize: "1rem", color: "#EEEEEE" }}>Agent Management</span>
        </div>
        <ul className="nav-links" style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.8rem",
          margin: 0,
          padding: 0,
          justifyContent: "flex-end",
          alignItems: "center",
          listStyle: "none",
          flex: 1
        }}>
          <li>
            <button
              onClick={() => navigate('/')}
              className="dark-button"
              style={{
                background: "linear-gradient(90deg, #00adb5, #00cc00)",
                border: "none",
                color: "#FFFFFF",
                fontSize: "0.9rem",
                fontWeight: 500,
                padding: "0.5rem 1rem",
                borderRadius: "6px",
                cursor: "pointer",
                transition: "transform 0.3s, background 0.3s",
                boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                display: "flex",
                alignItems: "center",
                gap: "0.3rem",
                minWidth: "110px",
                whiteSpace: "nowrap"
              }}
              onMouseOver={(e) => {
                e.target.style.transform = "scale(1.05)";
                e.target.style.background = "linear-gradient(90deg, #00cc00, #00adb5)";
              }}
              onMouseOut={(e) => {
                e.target.style.transform = "scale(1)";
                e.target.style.background = "linear-gradient(90deg, #00adb5, #00cc00)";
              }}
              aria-label="Go to Dashboard"
            >
              <FaHome /> Dashboard
            </button>
          </li>
          <li>
            <button
              onClick={() => navigate('/add-agent')}
              className="dark-button"
              style={{
                background: "linear-gradient(90deg, #ff5722, #ffa500)",
                border: "none",
                color: "#FFFFFF",
                fontSize: "0.9rem",
                fontWeight: 500,
                padding: "0.5rem 1rem",
                borderRadius: "6px",
                cursor: "pointer",
                transition: "transform 0.3s, background 0.3s",
                boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                display: "flex",
                alignItems: "center",
                gap: "0.3rem",
                minWidth: "110px",
                whiteSpace: "nowrap"
              }}
              onMouseOver={(e) => {
                e.target.style.transform = "scale(1.05)";
                e.target.style.background = "linear-gradient(90deg, #ffa500, #ff5722)";
              }}
              onMouseOut={(e) => {
                e.target.style.transform = "scale(1)";
                e.target.style.background = "linear-gradient(90deg, #ff5722, #ffa500)";
              }}
              aria-label="Add Agent"
            >
              <FaUserPlus /> Add Agent
            </button>
          </li>
          <li>
            <button
              onClick={() => navigate('/help-agents')}
              className="dark-button"
              style={{
                background: "linear-gradient(90deg, #2196f3, #42a5f5)",
                border: "none",
                color: "#FFFFFF",
                fontSize: "0.9rem",
                fontWeight: 500,
                padding: "0.5rem 1rem",
                borderRadius: "6px",
                cursor: "pointer",
                transition: "transform 0.3s, background 0.3s",
                boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                display: "flex",
                alignItems: "center",
                gap: "0.3rem",
                minWidth: "110px",
                whiteSpace: "nowrap"
              }}
              onMouseOver={(e) => {
                e.target.style.transform = "scale(1.05)";
                e.target.style.background = "linear-gradient(90deg, #42a5f5, #2196f3)";
              }}
              onMouseOut={(e) => {
                e.target.style.transform = "scale(1)";
                e.target.style.background = "linear-gradient(90deg, #2196f3, #42a5f5)";
              }}
              aria-label="Help"
            >
              <FaQuestionCircle /> Help
            </button>
          </li>
        </ul>
      </nav>

      {/* ============ PAGE TITLE ============ */}
      <h1 className="neon-card-title" style={{
        position: "relative",
        paddingBottom: "0.5rem",
        fontSize: "1.8rem",
        textAlign: "center",
        color: "#00adb5",
        textShadow: "0 0 8px rgba(0, 173, 181, 0.7)"
      }}>
        Agent Management
        <span style={{
          position: "absolute",
          bottom: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: "50%",
          height: "3px",
          background: "linear-gradient(90deg, #00adb5, #00cc00)",
          borderRadius: "2px"
        }}></span>
      </h1>
      {error && <p className="error-message" style={{
        color: "#ff5722",
        background: "rgba(255, 87, 34, 0.15)",
        padding: "0.8rem",
        borderRadius: "8px",
        marginBottom: "1rem",
        textAlign: "center"
      }}>{error}</p>}

      {/* ============ SEARCH BOX ============ */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: "2rem" }}>
        <input
          type="text"
          placeholder="Search by Agent Name or Agent ID"
          value={searchQuery}
          onChange={handleSearchChange}
          className="dark-input"
          style={{
            width: "350px",
            padding: "0.8rem 1.2rem",
            borderRadius: "8px",
            background: "#2e333b",
            border: "1px solid #444",
            color: "#EEEEEE",
            fontSize: "1rem",
            boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)"
          }}
        />
      </div>

      {/* ============ TABLE ============ */}
      <section className="dark-card neon-card fadeInUp fancy-graph-container">
        <table className="dark-table" style={{ marginTop: "1rem" }}>
          <thead>
            <tr>
              <th>Agent ID</th>
              <th>Name</th>
              <th>Email</th>
              <th>Mobile</th>
              <th>Supervisor</th>
              <th>Role</th>
              <th>Auditor</th>
              <th>Location</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent.agent_id} style={{
                background: "linear-gradient(90deg, rgba(46, 51, 59, 0.9), rgba(34, 40, 49, 0.9))"
              }}>
                <td>{agent.agent_id}</td>
                <td>{agent.agent_name}</td>
                <td>{agent.agent_email}</td>
                <td>{agent.agent_mobile}</td>
                <td>{agent.supervisor}</td>
                <td>{agent.agent_type || 'Unknown'}</td>
                <td>{agent.auditor || ''}</td>
                <td>{agent.agent_location || ''}</td>
                <td>
                  <button
                    className="dark-button"
                    onClick={() => handleEdit(agent)}
                    style={{
                      background: "linear-gradient(90deg, #00adb5, #00cc00)",
                      marginRight: "0.5rem",
                      fontSize: "0.9rem"
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="dark-button"
                    onClick={() => handleDelete(agent.agent_id)}
                    style={{
                      background: "linear-gradient(90deg, #ff5722, #ff3333)"
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ============ EDIT MODAL ============ */}
      {isModalOpen && selectedAgent && (
        <div className="modal-overlay" style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          background: "rgba(0, 0, 0, 0.7)",
          zIndex: 1000
        }}>
          <div className="modal-content" style={{
            background: "#2e333b",
            padding: "2rem",
            borderRadius: "15px",
            boxShadow: "0 8px 20px rgba(0, 173, 181, 0.6), 0 0 15px rgba(0, 173, 181, 0.3)",
            border: "2px solid rgba(0, 173, 181, 0.4)",
            width: "600px",
            maxWidth: "95%",
            position: "fixed",
            top: `${modalPosition.top}px`,
            left: `${modalPosition.left}px`,
            transform: "translate(-50%, -50%)",
            animation: "fadeIn 0.3s ease-in-out"
          }}>
            <h2 style={{
              color: "#EEEEEE",
              fontSize: "1.5rem",
              marginBottom: "1.5rem",
              textAlign: "center",
              textShadow: "0 0 5px rgba(0, 173, 181, 0.5)"
            }}>Edit Agent</h2>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: "1.2rem",
              marginBottom: "1.5rem"
            }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <label style={{ color: "#EEEEEE", fontSize: "1rem" }}>Name:</label>
                <input
                  type="text"
                  value={selectedAgent.agent_name || ''}
                  onChange={(e) =>
                    setSelectedAgent({
                      ...selectedAgent,
                      agent_name: e.target.value,
                    })
                  }
                  className="dark-input"
                  style={{
                    background: "#393e46",
                    border: "1px solid #444",
                    borderRadius: "6px",
                    color: "#FFFFFF",
                    padding: "0.5rem 0.8rem",
                    fontSize: "1rem"
                  }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <label style={{ color: "#EEEEEE", fontSize: "1rem" }}>Mobile:</label>
                <input
                  type="text"
                  value={selectedAgent.agent_mobile || ''}
                  onChange={(e) =>
                    setSelectedAgent({
                      ...selectedAgent,
                      agent_mobile: e.target.value,
                    })
                  }
                  className="dark-input"
                  style={{
                    background: "#393e46",
                    border: "1px solid #444",
                    borderRadius: "6px",
                    color: "#FFFFFF",
                    padding: "0.5rem 0.8rem",
                    fontSize: "1rem"
                  }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <label style={{ color: "#EEEEEE", fontSize: "1rem" }}>Email:</label>
                <input
                  type="text"
                  value={selectedAgent.agent_email || ''}
                  onChange={(e) =>
                    setSelectedAgent({
                      ...selectedAgent,
                      agent_email: e.target.value,
                    })
                  }
                  className="dark-input"
                  style={{
                    background: "#393e46",
                    border: "1px solid #444",
                    borderRadius: "6px",
                    color: "#FFFFFF",
                    padding: "0.5rem 0.8rem",
                    fontSize: "1rem"
                  }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <label style={{ color: "#EEEEEE", fontSize: "1rem" }}>Supervisor:</label>
                <input
                  type="text"
                  value={selectedAgent.supervisor || ''}
                  onChange={(e) =>
                    setSelectedAgent({
                      ...selectedAgent,
                      supervisor: e.target.value,
                    })
                  }
                  className="dark-input"
                  style={{
                    background: "#393e46",
                    border: "1px solid #444",
                    borderRadius: "6px",
                    color: "#FFFFFF",
                    padding: "0.5rem 0.8rem",
                    fontSize: "1rem"
                  }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <label style={{ color: "#EEEEEE", fontSize: "1rem" }}>Role:</label>
                <select
                  value={selectedAgent.agent_type || 'inbound'}
                  onChange={(e) =>
                    setSelectedAgent({
                      ...selectedAgent,
                      agent_type: e.target.value,
                    })
                  }
                  className="dark-input"
                  style={{
                    background: "#393e46",
                    border: "1px solid #444",
                    borderRadius: "6px",
                    color: "#FFFFFF",
                    padding: "0.5rem 0.8rem",
                    fontSize: "1rem"
                  }}
                >
                  <option value="inbound">Inbound</option>
                  <option value="outbound">Outbound</option>
                </select>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <label style={{ color: "#EEEEEE", fontSize: "1rem" }}>Manager:</label>
                <input
                  type="text"
                  value={selectedAgent.manager || ''}
                  onChange={(e) =>
                    setSelectedAgent({
                      ...selectedAgent,
                      manager: e.target.value,
                    })
                  }
                  className="dark-input"
                  style={{
                    background: "#393e46",
                    border: "1px solid #444",
                    borderRadius: "6px",
                    color: "#FFFFFF",
                    padding: "0.5rem 0.8rem",
                    fontSize: "1rem"
                  }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <label style={{ color: "#EEEEEE", fontSize: "1rem" }}>Auditor:</label>
                <input
                  type="text"
                  value={selectedAgent.auditor || ''}
                  onChange={(e) =>
                    setSelectedAgent({
                      ...selectedAgent,
                      auditor: e.target.value,
                    })
                  }
                  className="dark-input"
                  style={{
                    background: "#393e46",
                    border: "1px solid #444",
                    borderRadius: "6px",
                    color: "#FFFFFF",
                    padding: "0.5rem 0.8rem",
                    fontSize: "1rem"
                  }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <label style={{ color: "#EEEEEE", fontSize: "1rem" }}>Location:</label>
                <input
                  type="text"
                  value={selectedAgent.agent_location || ''}
                  onChange={(e) =>
                    setSelectedAgent({
                      ...selectedAgent,
                      agent_location: e.target.value,
                    })
                  }
                  className="dark-input"
                  style={{
                    background: "#393e46",
                    border: "1px solid #444",
                    borderRadius: "6px",
                    color: "#FFFFFF",
                    padding: "0.5rem 0.8rem",
                    fontSize: "1rem"
                  }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", gridColumn: "1 / -1" }}>
                <label style={{ color: "#EEEEEE", fontSize: "1rem" }}>Notes:</label>
                <textarea
                  rows={2}
                  value={selectedAgent.notes || ''}
                  onChange={(e) =>
                    setSelectedAgent({
                      ...selectedAgent,
                      notes: e.target.value,
                    })
                  }
                  className="dark-input"
                  style={{
                    background: "#393e46",
                    border: "1px solid #444",
                    borderRadius: "6px",
                    color: "#FFFFFF",
                    padding: "0.5rem 0.8rem",
                    fontSize: "1rem"
                  }}
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
              <button
                className="dark-button"
                onClick={handleSave}
                style={{
                  background: "linear-gradient(90deg, #00adb5, #00cc00)",
                  padding: "0.5rem 1rem",
                  fontSize: "0.9rem"
                }}
              >
                Save
              </button>
              <button
                className="dark-button"
                onClick={handleDeactivate}
                style={{
                  background: "linear-gradient(90deg, #ff5722, #ff3333)",
                  padding: "0.5rem 1rem",
                  fontSize: "0.9rem"
                }}
              >
                Deactivate ID
              </button>
              <button
                className="dark-button"
                onClick={() => {
                  setSelectedAgent(null);
                  setIsModalOpen(false);
                }}
                style={{
                  background: "linear-gradient(90deg, #2196f3, #42a5f5)",
                  padding: "0.5rem 1rem",
                  fontSize: "0.9rem"
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Agents;