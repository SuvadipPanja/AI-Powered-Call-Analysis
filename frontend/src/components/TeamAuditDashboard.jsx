/**
 * File: TeamAuditDashboard.jsx
 * Purpose: Audit dashboard for Team Leaders, Managers, Admins — shows audit summary stats,
 *          AI vs Manual score comparison, and list of audits with drill-down.
 * Author: $Panja
 * Date: 2025-06-18
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import config from '../utils/envConfig';
import { Card, Button, Input, Select, Badge, Modal, Spinner } from './ui';
import {
  FaClipboardCheck, FaDownload, FaSearch, FaChartLine, FaUsers,
  FaCalendarAlt, FaEye, FaArrowUp, FaArrowDown, FaMinus,
} from 'react-icons/fa';
import { toast } from 'react-toastify';
import './manual-audit.css';
import './management-pages.css';
import { useAuth } from '../context/AuthContext';

const ALLOWED_ROLES = ['Super Admin', 'Admin', 'Manager', 'Team Leader'];

export default function TeamAuditDashboard() {
  const { userType } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({});
  const [perAgent, setPerAgent] = useState([]);
  const [paramAverages, setParamAverages] = useState([]);
  const [audits, setAudits] = useState([]);
  const [auditsLoading, setAuditsLoading] = useState(true);
  const [filterAgent, setFilterAgent] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [locations, setLocations] = useState([]);
  const [detailAudit, setDetailAudit] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const allowed = ALLOWED_ROLES.includes(userType);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await axios.get(`${config.apiBaseUrl}/api/audits/team/summary`);
      if (resp.data.success) {
        setSummary(resp.data.summary || {});
        setPerAgent(resp.data.perAgent || []);
        setParamAverages(resp.data.parameterAverages || []);
      }
    } catch (err) {
      console.error('Failed to load audit summary', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAudits = useCallback(async () => {
    setAuditsLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterAgent) params.set('agent', filterAgent);
      if (filterFrom) params.set('from', filterFrom);
      if (filterTo) params.set('to', filterTo);
      if (filterLocation) params.set('location', filterLocation);
      const resp = await axios.get(`${config.apiBaseUrl}/api/audits/team/list?${params.toString()}`);
      if (resp.data.success) {
        setAudits(resp.data.audits || []);
      }
    } catch (err) {
      console.error('Failed to load audits', err);
    } finally {
      setAuditsLoading(false);
    }
  }, [filterAgent, filterFrom, filterTo, filterLocation]);

  const fetchLocations = useCallback(async () => {
    try {
      const resp = await axios.get(`${config.apiBaseUrl}/api/dropdown/locations`);
      if (resp.data.success) setLocations(resp.data.locations || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (allowed) {
      fetchSummary();
      fetchAudits();
      fetchLocations();
    }
  }, [allowed, fetchSummary, fetchAudits, fetchLocations]);

  const handleExport = async () => {
    try {
      const params = new URLSearchParams();
      if (filterAgent) params.set('agent', filterAgent);
      if (filterFrom) params.set('from', filterFrom);
      if (filterTo) params.set('to', filterTo);
      const resp = await axios.get(`${config.apiBaseUrl}/api/audits/team/export?${params.toString()}`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([resp.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `audit_report_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Audit report downloaded.');
    } catch {
      toast.error('Failed to export audit report.');
    }
  };

  const handleViewDetail = async (audit) => {
    setDetailLoading(true);
    setDetailAudit(null);
    try {
      const resp = await axios.get(`${config.apiBaseUrl}/api/audits/${encodeURIComponent(audit.AudioFileName)}`);
      if (resp.data.success && resp.data.audit) {
        setDetailAudit(resp.data.audit);
      } else {
        toast.warn('Audit details not found.');
      }
    } catch {
      toast.error('Failed to load audit details.');
    } finally {
      setDetailLoading(false);
    }
  };

  if (!allowed) {
    return (
      <div className="app-page reports-page" style={{ textAlign: 'center', paddingTop: '4rem' }}>
        <h2 style={{ color: 'var(--danger)' }}>Access Denied</h2>
        <p>You do not have permission to view the audit dashboard.</p>
        <Button variant="secondary" onClick={() => navigate('/')}>Go to Dashboard</Button>
      </div>
    );
  }

  const fmtScore = (v) => v != null ? `${parseFloat(v).toFixed(1)}%` : '—';

  const deltaIcon = (manual, ai) => {
    if (manual == null || ai == null) return null;
    const diff = manual - ai;
    if (diff > 2) return <FaArrowUp style={{ color: 'var(--success)', marginLeft: 4 }} />;
    if (diff < -2) return <FaArrowDown style={{ color: 'var(--danger)', marginLeft: 4 }} />;
    return <FaMinus style={{ color: 'var(--text-muted)', marginLeft: 4 }} />;
  };

  const deltaClass = (manual, ai) => {
    if (manual == null || ai == null) return 'neutral';
    const diff = manual - ai;
    if (diff > 2) return 'positive';
    if (diff < -2) return 'negative';
    return 'neutral';
  };

  return (
    <div className="app-page reports-page mgmt-page team-audit-dash">
      <section className="reports-section mgmt-page__head">
        <div className="reports-section__head">
          <h2><FaClipboardCheck style={{ marginRight: 8 }} />Audit Dashboard</h2>
          <p>Review manual audit metrics, AI vs Manual score comparisons, and detailed audit records.</p>
        </div>
      </section>

      {/* Summary Stats */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spinner /> Loading summary...</div>
      ) : (
        <div className="team-audit-dash__stats">
          <div className="team-audit-dash__stat-card">
            <div className="team-audit-dash__stat-value">{summary.totalAudits || 0}</div>
            <div className="team-audit-dash__stat-label">Total Audits</div>
          </div>
          <div className="team-audit-dash__stat-card">
            <div className="team-audit-dash__stat-value">{summary.auditsThisWeek || 0}</div>
            <div className="team-audit-dash__stat-label">This Week</div>
          </div>
          <div className="team-audit-dash__stat-card">
            <div className="team-audit-dash__stat-value">{summary.auditsThisMonth || 0}</div>
            <div className="team-audit-dash__stat-label">This Month</div>
          </div>
          <div className="team-audit-dash__stat-card">
            <div className="team-audit-dash__stat-value">{summary.uniqueAgents || 0}</div>
            <div className="team-audit-dash__stat-label">Agents Audited</div>
          </div>
          <div className="team-audit-dash__stat-card">
            <div className="team-audit-dash__stat-value" style={{ color: 'var(--success)' }}>
              {fmtScore(summary.avgManualScore)}
            </div>
            <div className="team-audit-dash__stat-label">Avg Manual Score</div>
          </div>
          <div className="team-audit-dash__stat-card">
            <div className="team-audit-dash__stat-value">
              {fmtScore(summary.avgAIScore)}
            </div>
            <div className="team-audit-dash__stat-label">Avg AI Score</div>
          </div>
        </div>
      )}

      {/* Parameter Averages — AI vs Manual */}
      {paramAverages.length > 0 && (
        <div className="team-audit-dash__param-table">
          <h3><FaChartLine style={{ marginRight: 6 }} /> AI vs Manual — Per Parameter</h3>
          <Card className="mgmt-table-card">
            <div className="mgmt-table-wrap">
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Parameter</th>
                    <th>Avg AI Score</th>
                    <th>Avg Manual Score</th>
                    <th>Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {paramAverages.map(pa => {
                    const diff = (pa.avgManual != null && pa.avgAI != null)
                      ? (pa.avgManual - pa.avgAI).toFixed(1) : null;
                    return (
                      <tr key={pa.ParameterName}>
                        <td style={{ fontWeight: 600 }}>{pa.ParameterName}</td>
                        <td>{fmtScore(pa.avgAI)}</td>
                        <td>{fmtScore(pa.avgManual)}</td>
                        <td>
                          {diff != null && (
                            <span className={`team-audit-dash__delta team-audit-dash__delta--${deltaClass(pa.avgManual, pa.avgAI)}`}>
                              {diff > 0 ? '+' : ''}{diff}
                              {deltaIcon(pa.avgManual, pa.avgAI)}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="team-audit-dash__filters" style={{ marginTop: 24 }}>
        <Input
          type="text"
          placeholder="Filter by agent name..."
          value={filterAgent}
          onChange={e => setFilterAgent(e.target.value)}
          style={{ flex: 1, minWidth: 180 }}
        />
        <Input
          type="date"
          value={filterFrom}
          onChange={e => setFilterFrom(e.target.value)}
          style={{ width: 160 }}
        />
        <Input
          type="date"
          value={filterTo}
          onChange={e => setFilterTo(e.target.value)}
          style={{ width: 160 }}
        />
        <Select
          value={filterLocation}
          onChange={e => setFilterLocation(e.target.value)}
          style={{ minWidth: 160 }}
        >
          <option value="">All Locations</option>
          {locations.map(loc => (
            <option key={loc.LocationID || loc.LocationName} value={loc.LocationName}>{loc.LocationName}</option>
          ))}
        </Select>
        <Button variant="secondary" onClick={fetchAudits}>
          <FaSearch style={{ marginRight: 4 }} /> Search
        </Button>
        <Button variant="secondary" onClick={handleExport}>
          <FaDownload style={{ marginRight: 4 }} /> Export CSV
        </Button>
      </div>

      {/* Audits Table */}
      <Card className="team-audit-dash__table-card">
        <div className="team-audit-dash__table-wrap">
          <table className="ui-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Agent</th>
                <th>Location</th>
                <th>Auditor</th>
                <th>AI Score</th>
                <th>Manual Score</th>
                <th>Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {auditsLoading ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
                    <Spinner /> Loading audits...
                  </td>
                </tr>
              ) : audits.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
                    No audits found matching your criteria.
                  </td>
                </tr>
              ) : (
                audits.map(audit => (
                  <tr key={audit.AuditID}>
                    <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {audit.AudioFileName || '—'}
                    </td>
                    <td>{audit.AgentName || '—'}</td>
                    <td>{audit.AgentLocation || '—'}</td>
                    <td>{audit.AuditorUsername || '—'}</td>
                    <td>{fmtScore(audit.OverallAIScore)}</td>
                    <td>
                      <Badge variant={
                        audit.OverallManualScore >= 80 ? 'success'
                          : audit.OverallManualScore >= 50 ? 'warning' : 'error'
                      }>
                        {fmtScore(audit.OverallManualScore)}
                      </Badge>
                    </td>
                    <td>{audit.CreatedAt ? new Date(audit.CreatedAt).toLocaleDateString() : '—'}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <Button variant="secondary" size="sm" onClick={() => handleViewDetail(audit)}>
                        <FaEye style={{ marginRight: 3 }} /> Detail
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => navigate(`/results/${encodeURIComponent(audit.AudioFileName)}`)}
                      >
                        View Call
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Detail Modal */}
      <Modal open={!!detailAudit || detailLoading} onClose={() => { setDetailAudit(null); setDetailLoading(false); }} maxWidth="720px">
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spinner /> Loading details...</div>
        ) : detailAudit ? (
          <div style={{ padding: 24 }}>
            <h3 style={{ marginBottom: 16 }}>
              <FaClipboardCheck style={{ marginRight: 8 }} />
              Audit Detail — {detailAudit.AudioFileName}
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16, fontSize: '0.85rem' }}>
              <div><strong>Auditor:</strong> {detailAudit.AuditorUsername}</div>
              <div><strong>Role:</strong> {detailAudit.AuditorRole}</div>
              <div><strong>Agent:</strong> {detailAudit.AgentName || '—'}</div>
              <div><strong>Location:</strong> {detailAudit.AgentLocation || '—'}</div>
              <div><strong>Overall AI:</strong> {fmtScore(detailAudit.OverallAIScore)}</div>
              <div><strong>Overall Manual:</strong> {fmtScore(detailAudit.OverallManualScore)}</div>
              <div><strong>Date:</strong> {detailAudit.CreatedAt ? new Date(detailAudit.CreatedAt).toLocaleString() : '—'}</div>
            </div>

            {detailAudit.scores && detailAudit.scores.length > 0 && (
              <table className="ui-table" style={{ marginBottom: 16 }}>
                <thead>
                  <tr>
                    <th>Parameter</th>
                    <th>AI Score</th>
                    <th>Manual Score</th>
                    <th>Rationale</th>
                  </tr>
                </thead>
                <tbody>
                  {detailAudit.scores.map(s => (
                    <tr key={s.ParameterName}>
                      <td style={{ fontWeight: 600 }}>{s.ParameterName}</td>
                      <td>{s.AIScore != null ? `${parseFloat(s.AIScore).toFixed(0)}%` : '—'}</td>
                      <td>{s.ManualScore != null ? `${parseFloat(s.ManualScore).toFixed(0)}%` : '—'}</td>
                      <td style={{ fontSize: '0.82rem', color: 'var(--text-muted)', maxWidth: 200 }}>{s.Rationale || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {detailAudit.ToneNotes && (
              <div style={{ marginBottom: 12 }}>
                <strong>Tone Notes:</strong>
                <p style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: '0.85rem' }}>{detailAudit.ToneNotes}</p>
              </div>
            )}

            {detailAudit.OverallComments && (
              <div style={{ marginBottom: 12 }}>
                <strong>Overall Comments:</strong>
                <p style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: '0.85rem' }}>{detailAudit.OverallComments}</p>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <Button variant="secondary" onClick={() => setDetailAudit(null)}>Close</Button>
              <Button variant="primary" onClick={() => navigate(`/results/${encodeURIComponent(detailAudit.AudioFileName)}`)}>
                Go to Call
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
