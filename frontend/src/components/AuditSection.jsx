/**
 * File: AuditSection.jsx
 * Purpose: Audit view for Auditors — read-only access to call audit queue and scoring data.
 * Author: $Panja
 * Creation Date: 2025-06-17
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import config from '../utils/envConfig';
import './management-pages.css';
import { Card, Button, Input, Select, Badge } from './ui';
import { useAuth } from '../context/AuthContext';

export default function AuditSection() {
  const { username, userType } = useAuth();
  const navigate = useNavigate();
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [locations, setLocations] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  const allowed = ['Auditor', 'Super Admin', 'Admin'].includes(userType);

  const fetchAuditQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/audit-queue/${encodeURIComponent(username)}`);
      const data = await res.json();
      if (data.success) {
        setCalls(data.calls || []);
      } else {
        setCalls([]);
      }
    } catch {
      setError('Failed to load audit queue');
    } finally {
      setLoading(false);
    }
  }, [username]);

  const fetchLocations = useCallback(async () => {
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/dropdown/locations`);
      const data = await res.json();
      if (data.success) setLocations(data.locations || []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (allowed) {
      fetchAuditQueue();
      fetchLocations();
    }
  }, [allowed, fetchAuditQueue, fetchLocations]);

  if (!allowed) {
    return (
      <div className="app-page reports-page" style={{ textAlign: 'center', paddingTop: '4rem' }}>
        <h2 style={{ color: 'var(--danger)' }}>Access Denied</h2>
        <p>You do not have permission to view audit data.</p>
        <Button variant="secondary" onClick={() => navigate('/')}>Go to Dashboard</Button>
      </div>
    );
  }

  const filtered = calls.filter(c => {
    const matchesLocation = selectedLocation === 'All' || (c.Location || '').toLowerCase() === selectedLocation.toLowerCase();
    const matchesSearch = !searchQuery || (c.AgentName || '').toLowerCase().includes(searchQuery.toLowerCase())
      || (c.FileName || '').toLowerCase().includes(searchQuery.toLowerCase());
    return matchesLocation && matchesSearch;
  });

  return (
    <div className="app-page reports-page mgmt-page">
      {error && <div className="auth-alert auth-alert--error">{error}</div>}

      <section className="reports-section mgmt-page__head">
        <div className="reports-section__head">
          <h2>Audit Queue</h2>
          <p>Review calls assigned for quality auditing — read-only view.</p>
        </div>
      </section>

      <div className="mgmt-toolbar" style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <Input
          type="text"
          placeholder="Search by agent or filename…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{ flex: 1, minWidth: '200px' }}
        />
        <Select
          value={selectedLocation}
          onChange={e => setSelectedLocation(e.target.value)}
          style={{ minWidth: '160px' }}
        >
          <option value="All">All Locations</option>
          {locations.map(loc => (
            <option key={loc.LocationID || loc.LocationName} value={loc.LocationName}>{loc.LocationName}</option>
          ))}
        </Select>
      </div>

      <Card className="mgmt-table-card">
        <div className="mgmt-table-wrap">
          <table className="ui-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Agent</th>
                <th>Location</th>
                <th>Date</th>
                <th>Score</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No audit items found</td>
                </tr>
              ) : (
                filtered.map((call, i) => (
                  <tr key={call.FileName || i}>
                    <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{call.FileName || '—'}</td>
                    <td>{call.AgentName || '—'}</td>
                    <td>{call.Location || '—'}</td>
                    <td>{call.UploadDate || '—'}</td>
                    <td>
                      {call.Overall_Scoring != null ? (
                        <Badge variant={call.Overall_Scoring >= 80 ? 'success' : call.Overall_Scoring >= 50 ? 'warning' : 'error'}>
                          {call.Overall_Scoring}%
                        </Badge>
                      ) : '—'}
                    </td>
                    <td>{call.Status || '—'}</td>
                    <td>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => navigate(`/results/${encodeURIComponent(call.FileName)}`)}
                      >
                        View
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
