/**
 * File: AuditSection.jsx
 * Purpose: Audit view for Auditors — read-only access to call audit queue and scoring data.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import './management-pages.css';
import { Card, Button, Input, Select, Badge } from './ui';
import { getAuditQueue } from '../services/auditService';
import { listLocationsDropdown } from '../services/dropdownsService';
import { useAuth } from '../context/AuthContext';
import useAccessGate from '../hooks/useAccessGate';
import useTenantMode from '../hooks/useTenantMode';
import { tenureBand, TENURE_BANDS } from '../utils/auditTenure';
import { summarizeAuditQueue } from '../utils/auditBifurcation';

function isYes(v) {
  return /^(yes|true|1)$/i.test(String(v || '').trim());
}

function label(value) {
  const text = String(value || '').trim();
  return text || 'Unknown';
}

function normalizeQueueRow(row) {
  // Accept both camelCase API shape and legacy PascalCase.
  return {
    fileName: row.fileName || row.FileName || '',
    agentName: row.agentName || row.AgentName || '',
    location: row.location || row.Location || '',
    callDate: row.callDate || row.UploadDate || row.CallDate || '',
    score: row.score ?? row.Overall_Scoring ?? null,
    hasManualAudit: row.hasManualAudit ?? row.HasManualAudit ?? 0,
    disposition: row.disposition || row.Disposition || '',
    campaign: row.campaign || row.Campaign || '',
    fatalTriggered: row.fatalTriggered || row.FatalTriggered || '',
    redAlert: row.redAlert || row.RedAlert || '',
    collScore: row.collScore ?? row.CollScore ?? null,
    language: row.language || row.AudioLanguage || '',
    supervisor: row.supervisor || row.Supervisor || '',
    agentCreationDate: row.agentCreationDate || row.AgentCreationDate || null,
  };
}

export default function AuditSection() {
  const { username } = useAuth();
  const { hasPage, ready: accessReady } = useAccessGate();
  const { isCollections } = useTenantMode();
  const navigate = useNavigate();
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [locations, setLocations] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [fatalOnly, setFatalOnly] = useState(false);
  const [dispositionFilter, setDispositionFilter] = useState('All');
  const [languageFilter, setLanguageFilter] = useState('All');
  const [tlFilter, setTlFilter] = useState('All');
  const [tenureFilter, setTenureFilter] = useState('All');

  const allowed = accessReady && hasPage('audit');

  const fetchAuditQueue = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAuditQueue(username);
      if (data.success) {
        const rows = data.auditQueue || data.calls || [];
        setCalls(rows.map(normalizeQueueRow));
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
      const locs = await listLocationsDropdown();
      setLocations(Array.isArray(locs) ? locs : []);
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

  const dispositionOptions = useMemo(() => {
    const set = new Set();
    for (const c of calls) {
      if (c.disposition) set.add(c.disposition);
    }
    return [...set].sort();
  }, [calls]);

  const summary = useMemo(() => summarizeAuditQueue(calls), [calls]);

  if (!accessReady) {
    return <div className="app-page reports-page" style={{ paddingTop: '4rem' }} aria-busy="true" />;
  }

  if (!allowed) {
    return (
      <div className="app-page reports-page" style={{ textAlign: 'center', paddingTop: '4rem' }}>
        <h2 style={{ color: 'var(--danger)' }}>Access Denied</h2>
        <p>You do not have permission to view audit data.</p>
        <Button variant="secondary" onClick={() => navigate('/')}>Go to Dashboard</Button>
      </div>
    );
  }

  const filtered = calls.filter((c) => {
    const matchesLocation = selectedLocation === 'All'
      || (c.location || '').toLowerCase() === selectedLocation.toLowerCase();
    const matchesSearch = !searchQuery
      || (c.agentName || '').toLowerCase().includes(searchQuery.toLowerCase())
      || (c.fileName || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFatal = !fatalOnly || isYes(c.fatalTriggered) || isYes(c.redAlert);
    const matchesDisposition = dispositionFilter === 'All'
      || (c.disposition || '') === dispositionFilter;
    const matchesLanguage = languageFilter === 'All' || label(c.language) === languageFilter;
    const matchesTl = tlFilter === 'All' || label(c.supervisor) === tlFilter;
    const matchesTenure = tenureFilter === 'All'
      || tenureBand(c.agentCreationDate, c.callDate) === tenureFilter;
    return matchesLocation && matchesSearch && matchesFatal && matchesDisposition
      && matchesLanguage && matchesTl && matchesTenure;
  });

  const colSpan = isCollections ? 10 : 7;

  return (
    <div className="app-page reports-page mgmt-page">
      {error && <div className="auth-alert auth-alert--error">{error}</div>}

      <section className="reports-section mgmt-page__head">
        <div className="reports-section__head">
          <h2>{isCollections ? 'Collections audit queue' : 'Audit Queue'}</h2>
          <p>
            {isCollections
              ? 'Prioritize fatal / ZTP and disposition outcomes for quality auditing — read-only view.'
              : 'Review calls assigned for quality auditing — read-only view.'}
          </p>
        </div>
      </section>

      <div className="mgmt-toolbar" style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
        <Input
          type="text"
          placeholder="Search by agent or filename…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ flex: 1, minWidth: '200px' }}
        />
        <Select
          value={selectedLocation}
          onChange={(e) => setSelectedLocation(e.target.value)}
          style={{ minWidth: '160px' }}
        >
          <option value="All">All Locations</option>
          {locations.map((loc) => (
            <option key={loc.LocationID || loc.LocationName} value={loc.LocationName}>
              {loc.LocationName}
            </option>
          ))}
        </Select>
        {isCollections && (
          <>
            <Select
              value={dispositionFilter}
              onChange={(e) => setDispositionFilter(e.target.value)}
              style={{ minWidth: '180px' }}
            >
              <option value="All">All dispositions</option>
              {dispositionOptions.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </Select>
            <Select
              value={languageFilter}
              onChange={(e) => setLanguageFilter(e.target.value)}
              aria-label="Language"
              style={{ minWidth: '160px' }}
            >
              <option value="All">All languages</option>
              {summary.byLanguage.map((row) => (
                <option key={row.name} value={row.name}>{row.name}</option>
              ))}
            </Select>
            <Select
              value={tlFilter}
              onChange={(e) => setTlFilter(e.target.value)}
              aria-label="TL"
              style={{ minWidth: '160px' }}
            >
              <option value="All">All TLs</option>
              {summary.byTl.map((row) => (
                <option key={row.name} value={row.name}>{row.name}</option>
              ))}
            </Select>
            <Select
              value={tenureFilter}
              onChange={(e) => setTenureFilter(e.target.value)}
              aria-label="Tenure"
              style={{ minWidth: '160px' }}
            >
              <option value="All">All tenure</option>
              {TENURE_BANDS.map((band) => (
                <option key={band} value={band}>{band}</option>
              ))}
            </Select>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
              <input
                type="checkbox"
                checked={fatalOnly}
                onChange={(e) => setFatalOnly(e.target.checked)}
              />
              Fatal / Red alert only
            </label>
          </>
        )}
      </div>

      {isCollections && (
        <div className="mgmt-bifurcation" aria-label="Audit bifurcations">
          <BifurcationTable
            title="Language-wise"
            rows={summary.byLanguage}
            onSelect={(name) => setLanguageFilter(name)}
          />
          <BifurcationTable
            title="TL-wise"
            rows={summary.byTl}
            onSelect={(name) => setTlFilter(name)}
          />
          <BifurcationTable
            title="Tenure-wise"
            rows={summary.byTenure}
            onSelect={(name) => setTenureFilter(name)}
          />
        </div>
      )}

      <Card className="mgmt-table-card">
        <div className="mgmt-table-wrap ui-table-wrap ui-table-wrap--stack">
          <table className="ui-table ui-table--stack-sm">
            <thead>
              <tr>
                <th>File</th>
                <th>Agent</th>
                <th className="ui-table__col--hide-sm">Location</th>
                <th>Date</th>
                <th>Score</th>
                {isCollections && <th>Disposition</th>}
                {isCollections && <th className="ui-table__col--hide-sm">Campaign</th>}
                {isCollections && <th>Fatal</th>}
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={colSpan} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No audit items found</td>
                </tr>
              ) : (
                filtered.map((call, i) => {
                  const score = call.collScore != null && isCollections
                    ? Number(call.collScore)
                    : (call.score != null ? Number(call.score) : null);
                  const fatal = isYes(call.fatalTriggered) || isYes(call.redAlert);
                  return (
                    <tr key={call.fileName || i}>
                      <td data-label="File" style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {call.fileName || '—'}
                      </td>
                      <td data-label="Agent">{call.agentName || '—'}</td>
                      <td className="ui-table__col--hide-sm" data-label="Location">{call.location || '—'}</td>
                      <td data-label="Date">{call.callDate || '—'}</td>
                      <td data-label="Score">
                        {score != null && !Number.isNaN(score) ? (
                          <Badge variant={score >= 85 ? 'success' : score >= 80 ? 'warning' : 'error'}>
                            {Number(score).toFixed(1)}%
                          </Badge>
                        ) : '—'}
                      </td>
                      {isCollections && (
                        <td data-label="Disposition">{call.disposition || '—'}</td>
                      )}
                      {isCollections && (
                        <td className="ui-table__col--hide-sm" data-label="Campaign">{call.campaign || '—'}</td>
                      )}
                      {isCollections && (
                        <td data-label="Fatal">
                          {fatal ? <Badge variant="error">Yes</Badge> : '—'}
                        </td>
                      )}
                      <td data-label="Status">
                        {call.hasManualAudit ? <Badge variant="success">Audited</Badge> : <Badge variant="muted">Pending</Badge>}
                      </td>
                      <td className="ui-table__cell--actions" data-label="Actions">
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => navigate(`/results/${encodeURIComponent(call.fileName)}`)}
                        >
                          View
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function BifurcationTable({ title, rows, onSelect }) {
  return (
    <Card>
      <table className="ui-table" aria-label={`${title} bifurcation`}>
        <thead>
          <tr>
            <th scope="col">{title}</th>
            <th scope="col">Calls</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <td>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`View ${row.name} calls`}
                  onClick={() => onSelect(row.name)}
                >
                  {row.name}
                </Button>
              </td>
              <td>{row.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
