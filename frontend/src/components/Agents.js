/**
 * File: Agents.js
 * Purpose: Page for managing agents — list, search, edit, deactivate.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { LuUserPlus } from 'react-icons/lu';
import './management-pages.css';
import config from "../utils/envConfig";
import { Card, Button, Input, Select, Label, Modal, UserAvatar } from './ui';

const debounce = (func, delay) => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
};

function normalizeAgent(raw) {
  if (!raw) return null;
  const type = (raw.agent_type || raw.Agent_Type || 'inbound').toString().toLowerCase();
  return {
    agent_id: raw.agent_id ?? raw.Agent_ID ?? raw.AgentId ?? '',
    agent_name: raw.agent_name ?? raw.Agent_Name ?? '',
    agent_mobile: raw.agent_mobile ?? raw.Agent_Mobile ?? '',
    agent_email: raw.agent_email ?? raw.Agent_Email ?? '',
    supervisor: raw.supervisor ?? raw.Supervisor ?? '',
    agent_type: type,
    manager: raw.manager ?? raw.Manager ?? '',
    auditor: raw.auditor ?? raw.Auditor ?? '',
    notes: raw.notes ?? raw.Notes ?? '',
    agent_location: raw.agent_location ?? raw.Agent_Location ?? '',
  };
}

const Agents = () => {
  const navigate = useNavigate();
  const [agents, setAgents] = useState([]);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [dropdownManagers, setDropdownManagers] = useState([]);
  const [dropdownTeamLeaders, setDropdownTeamLeaders] = useState([]);
  const [dropdownAuditors, setDropdownAuditors] = useState([]);
  const [dropdownLocations, setDropdownLocations] = useState([]);

  const fetchAllAgents = useCallback(async () => {
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/agents`);
      if (!res.ok) throw new Error('Failed to fetch agents');
      const data = await res.json();
      setAgents(Array.isArray(data) ? data.map(normalizeAgent) : []);
      setError('');
    } catch (err) {
      console.error('Error fetching agents:', err.message);
      setError('Failed to fetch agents');
    }
  }, []);

  const searchAgents = async (query) => {
    try {
      const res = await fetch(
        `${config.apiBaseUrl}/api/agents/search?q=${encodeURIComponent(query)}`
      );
      if (!res.ok) throw new Error('Search request failed');
      const data = await res.json();
      setAgents(Array.isArray(data) ? data.map(normalizeAgent) : []);
      setError('');
    } catch (err) {
      console.error('Error searching agents:', err.message);
      setError('Failed to search agents');
    }
  };

  const debouncedSearch = debounce((query) => {
    if (query.trim() === '') {
      fetchAllAgents();
    } else {
      searchAgents(query.trim());
    }
  }, 300);

  useEffect(() => {
    fetchAllAgents();
  }, [fetchAllAgents]);

  useEffect(() => {
    const loadDropdowns = async () => {
      try {
        const [mgrRes, tlRes, audRes, locRes] = await Promise.all([
          fetch(`${config.apiBaseUrl}/api/dropdown/managers`).then(r => r.json()),
          fetch(`${config.apiBaseUrl}/api/dropdown/team-leaders`).then(r => r.json()),
          fetch(`${config.apiBaseUrl}/api/dropdown/auditors`).then(r => r.json()),
          fetch(`${config.apiBaseUrl}/api/dropdown/locations`).then(r => r.json()),
        ]);
        if (mgrRes.success) setDropdownManagers(mgrRes.managers || []);
        if (tlRes.success) setDropdownTeamLeaders(tlRes.teamLeaders || []);
        if (audRes.success) setDropdownAuditors(audRes.auditors || []);
        if (locRes.success) setDropdownLocations(locRes.locations || []);
      } catch (err) {
        console.error('Error loading dropdowns:', err.message);
      }
    };
    loadDropdowns();
  }, []);

  const handleSearchChange = (e) => {
    const query = e.target.value;
    setSearchQuery(query);
    debouncedSearch(query);
  };

  const handleEdit = (agent) => {
    setSelectedAgent(normalizeAgent(agent));
    setSaveError('');
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedAgent(null);
    setSaveError('');
  };

  const handleSave = async () => {
    if (!selectedAgent?.agent_id) {
      setSaveError('Agent ID is missing — cannot save.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch(
        `${config.apiBaseUrl}/api/agents/${encodeURIComponent(selectedAgent.agent_id)}`,
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
            agent_location: selectedAgent.agent_location,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || data.message || 'Failed to update agent');
      }
      closeModal();
      if (searchQuery.trim() === '') {
        fetchAllAgents();
      } else {
        searchAgents(searchQuery.trim());
      }
    } catch (err) {
      console.error('Error updating agent:', err.message);
      setSaveError(err.message || 'Failed to update agent');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async () => {
    if (!selectedAgent?.agent_id) return;
    if (!window.confirm('Are you sure you want to deactivate this agent?')) return;

    try {
      const res = await fetch(
        `${config.apiBaseUrl}/api/agents/${encodeURIComponent(selectedAgent.agent_id)}/deactivate`,
        { method: 'PUT' }
      );
      if (!res.ok) throw new Error('Failed to deactivate agent');
      closeModal();
      if (searchQuery.trim() === '') {
        fetchAllAgents();
      } else {
        searchAgents(searchQuery.trim());
      }
    } catch (err) {
      console.error('Error deactivating agent:', err.message);
      setSaveError(err.message || 'Failed to deactivate agent');
    }
  };

  const handleDelete = async (agentId) => {
    if (!agentId || !window.confirm('Are you sure you want to delete this agent?')) return;
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/agents/${encodeURIComponent(agentId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete agent');
      setAgents((prev) => prev.filter((a) => a.agent_id !== agentId));
    } catch (err) {
      console.error('Error deleting agent:', err.message);
      setError('Failed to delete agent');
    }
  };

  return (
    <div className="app-page reports-page mgmt-page">
      {error && (
        <div className="auth-alert auth-alert--error">{error}</div>
      )}

      <section className="reports-section mgmt-page__head">
        <div className="mgmt-page__head-row">
          <div className="reports-section__head">
            <h2>Agents</h2>
            <p>Manage call-center agents — search, edit, deactivate, or add new records.</p>
          </div>
          <div className="mgmt-toolbar__actions">
            <Button variant="secondary" size="sm" onClick={() => navigate('/help-agents')}>
              Help
            </Button>
            <Button variant="primary" onClick={() => navigate('/add-agent')}>
              <LuUserPlus aria-hidden="true" /> Add agent
            </Button>
          </div>
        </div>
      </section>

      <div className="mgmt-toolbar">
        <Input
          type="text"
          placeholder="Search by agent name or ID…"
          value={searchQuery}
          onChange={handleSearchChange}
          aria-label="Search agents"
        />
      </div>

      <Card className="mgmt-table-card">
        <div className="mgmt-table-wrap">
          <table className="ui-table">
            <thead>
              <tr>
                <th>Agent ID</th>
                <th>Name</th>
                <th>Email</th>
                <th>Mobile</th>
                <th>Supervisor</th>
                <th>Role</th>
                <th>Location</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {agents.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                    No agents found
                  </td>
                </tr>
              ) : (
                agents.map((agent) => (
                  <tr key={agent.agent_id || agent.agent_name}>
                    <td>{agent.agent_id}</td>
                    <td>
                      <span className="mgmt-user-cell">
                        <UserAvatar username={agent.agent_name} size="sm" alt="" />
                        <span>{agent.agent_name}</span>
                      </span>
                    </td>
                    <td>{agent.agent_email}</td>
                    <td>{agent.agent_mobile}</td>
                    <td>{agent.supervisor}</td>
                    <td style={{ textTransform: 'capitalize' }}>{agent.agent_type || '—'}</td>
                    <td>{agent.agent_location || '—'}</td>
                    <td>
                      <Button variant="primary" size="sm" onClick={() => handleEdit(agent)} style={{ marginRight: '0.35rem' }}>
                        Edit
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => handleDelete(agent.agent_id)}>
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={isModalOpen && !!selectedAgent} onClose={closeModal} maxWidth="640px">
        <h2 style={{ margin: '0 0 var(--space-3)', color: 'var(--text-strong)', fontFamily: 'var(--font-display)' }}>
          Edit Agent
        </h2>
        {saveError && (
          <div className="auth-alert auth-alert--error" style={{ marginBottom: 'var(--space-3)' }}>
            {saveError}
          </div>
        )}
        {selectedAgent && (
          <>
            <div className="mgmt-modal-grid">
              <div>
                <Label>Agent ID</Label>
                <Input type="text" value={selectedAgent.agent_id} disabled />
              </div>
              <div>
                <Label>Name</Label>
                <Input
                  type="text"
                  value={selectedAgent.agent_name}
                  onChange={(e) => setSelectedAgent({ ...selectedAgent, agent_name: e.target.value })}
                />
              </div>
              <div>
                <Label>Mobile</Label>
                <Input
                  type="text"
                  value={selectedAgent.agent_mobile}
                  onChange={(e) => setSelectedAgent({ ...selectedAgent, agent_mobile: e.target.value })}
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  type="text"
                  value={selectedAgent.agent_email}
                  onChange={(e) => setSelectedAgent({ ...selectedAgent, agent_email: e.target.value })}
                />
              </div>
              <div>
                <Label>Supervisor (Team Leader)</Label>
                <Select
                  value={selectedAgent.supervisor}
                  onChange={(e) => setSelectedAgent({ ...selectedAgent, supervisor: e.target.value })}
                >
                  <option value="">-- Select --</option>
                  {dropdownTeamLeaders.map(tl => (
                    <option key={tl.UserID || tl.Username} value={tl.Username}>{tl.Username}</option>
                  ))}
                  {selectedAgent.supervisor && !dropdownTeamLeaders.find(tl => tl.Username === selectedAgent.supervisor) && (
                    <option value={selectedAgent.supervisor}>{selectedAgent.supervisor}</option>
                  )}
                </Select>
              </div>
              <div>
                <Label>Type</Label>
                <Select
                  value={selectedAgent.agent_type || 'inbound'}
                  onChange={(e) => setSelectedAgent({ ...selectedAgent, agent_type: e.target.value })}
                >
                  <option value="inbound">Inbound</option>
                  <option value="outbound">Outbound</option>
                </Select>
              </div>
              <div>
                <Label>Manager</Label>
                <Select
                  value={selectedAgent.manager}
                  onChange={(e) => setSelectedAgent({ ...selectedAgent, manager: e.target.value })}
                >
                  <option value="">-- Select --</option>
                  {dropdownManagers.map(m => (
                    <option key={m.UserID || m.Username} value={m.Username}>{m.Username}</option>
                  ))}
                  {selectedAgent.manager && !dropdownManagers.find(m => m.Username === selectedAgent.manager) && (
                    <option value={selectedAgent.manager}>{selectedAgent.manager}</option>
                  )}
                </Select>
              </div>
              <div>
                <Label>Auditor</Label>
                <Select
                  value={selectedAgent.auditor}
                  onChange={(e) => setSelectedAgent({ ...selectedAgent, auditor: e.target.value })}
                >
                  <option value="">-- Select --</option>
                  {dropdownAuditors.map(a => (
                    <option key={a.UserID || a.Username} value={a.Username}>{a.Username}</option>
                  ))}
                  {selectedAgent.auditor && !dropdownAuditors.find(a => a.Username === selectedAgent.auditor) && (
                    <option value={selectedAgent.auditor}>{selectedAgent.auditor}</option>
                  )}
                </Select>
              </div>
              <div>
                <Label>Location</Label>
                <Select
                  value={selectedAgent.agent_location}
                  onChange={(e) => setSelectedAgent({ ...selectedAgent, agent_location: e.target.value })}
                >
                  <option value="">-- Select --</option>
                  {dropdownLocations.map(loc => (
                    <option key={loc.LocationID || loc.LocationName} value={loc.LocationName}>{loc.LocationName}</option>
                  ))}
                  {selectedAgent.agent_location && !dropdownLocations.find(l => l.LocationName === selectedAgent.agent_location) && (
                    <option value={selectedAgent.agent_location}>{selectedAgent.agent_location}</option>
                  )}
                </Select>
              </div>
              <div className="mgmt-field--full">
                <Label>Notes</Label>
                <textarea
                  className="ui-textarea"
                  rows={3}
                  value={selectedAgent.notes}
                  onChange={(e) => setSelectedAgent({ ...selectedAgent, notes: e.target.value })}
                />
              </div>
            </div>
            <div className="mgmt-modal-actions">
              <Button variant="secondary" onClick={closeModal}>Cancel</Button>
              <Button variant="danger" onClick={handleDeactivate}>Deactivate</Button>
              <Button variant="primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
};

export default Agents;
