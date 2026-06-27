import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  FaCheckCircle,
  FaTimesCircle,
  FaSpinner,
  FaCloudUploadAlt,
  FaClipboardCheck,
  FaSearch,
  FaTimes,
} from "react-icons/fa";
import config from "../../utils/envConfig";
import { Button, Spinner, Badge, Input, Select } from "../ui";

const DEFAULT_FILTERS = {
  fileName: "",
  date: "",
  agent: "All",
  supervisor: "All",
  auditor: "All",
};

function getStatusIcon(status) {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s === "success") {
    return <FaCheckCircle className="status-icon success" aria-hidden="true" />;
  }
  if (s === "transcribed") {
    return <FaSpinner className="status-icon in-progress spin-icon" style={{ color: "#00D4FF" }} aria-hidden="true" />;
  }
  if (s === "uploaded" || s.includes("stub")) {
    return <FaCloudUploadAlt className="status-icon" style={{ color: "#FFD54F" }} aria-hidden="true" />;
  }
  if (s === "failed" || s === "fail" || s.includes("error")) {
    return <FaTimesCircle className="status-icon fail" aria-hidden="true" />;
  }
  if (s === "in progress" || s === "processing" || s === "pending") {
    return <FaSpinner className="status-icon in-progress spin-icon" aria-hidden="true" />;
  }
  return null;
}

function buildRecentActivityQuery(limit, filters) {
  const params = new URLSearchParams({ limit: String(limit) });
  const q = filters.fileName.trim();
  if (q) params.set("q", q);
  if (filters.date) params.set("date", filters.date);
  if (filters.agent !== "All") params.set("agent", filters.agent);
  if (filters.supervisor !== "All") params.set("supervisor", filters.supervisor);
  if (filters.auditor !== "All") params.set("auditor", filters.auditor);
  return params.toString();
}

function hasActiveFilters(filters) {
  return Boolean(
    filters.fileName.trim()
    || filters.date
    || filters.agent !== "All"
    || filters.supervisor !== "All"
    || filters.auditor !== "All"
  );
}

/**
 * Recent uploads table — shared on Upload page (replaces standalone Recent Activity page).
 */
export default function RecentActivityPanel({
  limit = 50,
  pageSize = 10,
  refreshKey = 0,
  title = "Recent activity",
  subtitle = "Latest uploaded calls and their processing status.",
  className = "",
}) {
  const navigate = useNavigate();
  const [recentCalls, setRecentCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [debouncedFileName, setDebouncedFileName] = useState("");
  const [agentList, setAgentList] = useState([]);
  const [supervisorList, setSupervisorList] = useState([]);
  const [auditorList, setAuditorList] = useState([]);
  const [dropdownsLoading, setDropdownsLoading] = useState(true);
  const [error, setError] = useState(null);
  const fetchSeqRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFileName(filters.fileName), 300);
    return () => clearTimeout(timer);
  }, [filters.fileName]);

  const activeQueryFilters = useMemo(
    () => ({
      fileName: debouncedFileName,
      date: filters.date,
      agent: filters.agent,
      supervisor: filters.supervisor,
      auditor: filters.auditor,
    }),
    [debouncedFileName, filters.date, filters.agent, filters.supervisor, filters.auditor]
  );

  const filtersActive = hasActiveFilters(activeQueryFilters);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setDropdownsLoading(true);
      try {
        const [agentsRes, supervisorsRes, auditorsRes] = await Promise.all([
          fetch(`${config.apiBaseUrl}/api/agents`),
          fetch(`${config.apiBaseUrl}/api/team-leaders`),
          fetch(`${config.apiBaseUrl}/api/dropdown/auditors`),
        ]);
        if (cancelled) return;

        if (agentsRes.ok) {
          const agentsData = await agentsRes.json();
          const names = Array.isArray(agentsData)
            ? [...new Set(agentsData.map((a) => a.agent_name || a.Agent_Name).filter(Boolean))].sort()
            : [];
          setAgentList(names);
        }

        if (supervisorsRes.ok) {
          const supervisorsData = await supervisorsRes.json();
          setSupervisorList(supervisorsData.success ? supervisorsData.teamLeaders || [] : []);
        }

        if (auditorsRes.ok) {
          const auditorsData = await auditorsRes.json();
          const names = (auditorsData.auditors || [])
            .map((a) => a.Username)
            .filter(Boolean)
            .sort();
          setAuditorList(names);
        }
      } catch (error) {
        console.error("Failed to load recent activity filter options:", error);
      } finally {
        if (!cancelled) setDropdownsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const fetchRecent = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const query = buildRecentActivityQuery(limit, activeQueryFilters);
      const response = await fetch(`${config.apiBaseUrl}/api/recent-activity?${query}`, {
        cache: "no-store",
      });
      const result = await response.json();
      if (seq !== fetchSeqRef.current) return;

      if (!response.ok || !result.success) {
        setRecentCalls([]);
        setError(result.message || `Failed to load recent activity (${response.status})`);
        setCurrentPage(1);
        return;
      }

      setRecentCalls(result.data || []);
      setCurrentPage(1);
    } catch (err) {
      if (seq !== fetchSeqRef.current) return;
      console.error("Failed to fetch recent activity:", err);
      setRecentCalls([]);
      setError(err.message || "Failed to load recent activity.");
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false);
    }
  }, [limit, activeQueryFilters]);

  useEffect(() => {
    fetchRecent();
  }, [fetchRecent, refreshKey]);

  const displayedCalls = useMemo(
    () => recentCalls.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [recentCalls, currentPage, pageSize]
  );

  const handleView = (fileName) => navigate(`/results/${encodeURIComponent(fileName)}`);

  const auditLabel = (call) => {
    if (!call.HasManualAudit) return null;
    const who = call.AuditorUsername || "Unknown";
    const role = call.AuditorRole || "";
    const when = call.AuditedAt || "";
    return `${who}${role ? ` (${role})` : ""}${when ? ` · ${when}` : ""}`;
  };

  const updateFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setDebouncedFileName("");
    setError(null);
  };

  const formatUploadDate = (value) => {
    if (!value) return "—";
    return String(value).slice(0, 10);
  };

  const activeChips = useMemo(() => {
    const chips = [];
    if (activeQueryFilters.fileName.trim()) {
      chips.push({ key: "fileName", label: `Audio: ${activeQueryFilters.fileName.trim()}` });
    }
    if (activeQueryFilters.date) {
      chips.push({ key: "date", label: `Date: ${activeQueryFilters.date}` });
    }
    if (activeQueryFilters.agent !== "All") {
      chips.push({ key: "agent", label: `Agent: ${activeQueryFilters.agent}` });
    }
    if (activeQueryFilters.supervisor !== "All") {
      chips.push({ key: "supervisor", label: `Supervisor: ${activeQueryFilters.supervisor}` });
    }
    if (activeQueryFilters.auditor !== "All") {
      chips.push({ key: "auditor", label: `Auditor: ${activeQueryFilters.auditor}` });
    }
    return chips;
  }, [activeQueryFilters]);

  const removeChip = (key) => {
    if (key === "fileName") {
      setFilters((prev) => ({ ...prev, fileName: "" }));
      setDebouncedFileName("");
      return;
    }
    if (key === "date") {
      updateFilter("date", "");
      return;
    }
    updateFilter(key, "All");
  };

  return (
    <section className={`reports-section recent-activity-panel ${className}`.trim()}>
      <div className="reports-section__head">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>

      <div className="report-chart-card recent-activity-panel__card">
        <div className="report-chart-card__accent" aria-hidden="true" />
        <div className="report-chart-card__orb" aria-hidden="true" />
        <div className="report-chart-card__body recent-activity-panel__table">
          <div className="recent-activity-panel__filters" role="search" aria-label="Filter recent activity">
            <div className="recent-activity-panel__toolbar-row">
              <div className="recent-activity-panel__filter-search">
                <FaSearch className="recent-activity-panel__filter-icon" aria-hidden="true" />
                <Input
                  type="search"
                  className="recent-activity-panel__filter-input"
                  placeholder="Search audio…"
                  value={filters.fileName}
                  onChange={(e) => updateFilter("fileName", e.target.value)}
                  aria-label="Search by audio file name"
                />
              </div>
              <Input
                type="date"
                className="recent-activity-panel__filter-date"
                value={filters.date}
                onChange={(e) => updateFilter("date", e.target.value)}
                aria-label="Filter by upload date"
              />
              <Select
                className="recent-activity-panel__filter-select"
                value={filters.agent}
                onChange={(e) => updateFilter("agent", e.target.value)}
                disabled={dropdownsLoading}
                aria-label="Filter by agent"
              >
                <option value="All">{dropdownsLoading ? "Loading…" : "All agents"}</option>
                {agentList.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </Select>
              <Select
                className="recent-activity-panel__filter-select"
                value={filters.supervisor}
                onChange={(e) => updateFilter("supervisor", e.target.value)}
                disabled={dropdownsLoading}
                aria-label="Filter by supervisor"
              >
                <option value="All">{dropdownsLoading ? "Loading…" : "All supervisors"}</option>
                {supervisorList.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </Select>
              <Select
                className="recent-activity-panel__filter-select"
                value={filters.auditor}
                onChange={(e) => updateFilter("auditor", e.target.value)}
                disabled={dropdownsLoading}
                aria-label="Filter by auditor"
              >
                <option value="All">{dropdownsLoading ? "Loading…" : "All auditors"}</option>
                {auditorList.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </Select>
              <div className="recent-activity-panel__toolbar-actions">
                {filtersActive && (
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    className="recent-activity-panel__clear-btn"
                    onClick={clearFilters}
                    aria-label="Clear all filters"
                    title="Clear filters"
                  >
                    <FaTimes aria-hidden="true" />
                  </Button>
                )}
                <span className="recent-activity-panel__result-count" aria-live="polite">
                  {loading ? "Searching…" : `${recentCalls.length} result${recentCalls.length === 1 ? "" : "s"}`}
                </span>
              </div>
            </div>

            {activeChips.length > 0 && (
              <div className="recent-activity-panel__chips" aria-label="Active filters">
                {activeChips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    className="recent-activity-panel__chip"
                    onClick={() => removeChip(chip.key)}
                    aria-label={`Remove filter ${chip.label}`}
                  >
                    {chip.label}
                    <span aria-hidden="true">×</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="recent-activity-panel__error" role="alert">
              {error}
            </div>
          )}

          {loading ? (
          <div className="recent-activity-panel__loading">
            <Spinner />
            <span>Loading recent calls…</span>
          </div>
        ) : (
          <>
            <table className="ui-table">
              <thead>
                <tr>
                  <th>File name</th>
                  <th>Upload date</th>
                  <th>Status</th>
                  <th>Manual audit</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {displayedCalls.length > 0 ? (
                  displayedCalls.map((call, idx) => (
                    <tr key={`${call.FileName}-${idx}`}>
                      <td>
                        <span className="ellipsis" title={call.FileName}>
                          {call.FileName}
                        </span>
                      </td>
                      <td>{formatUploadDate(call.UploadDate)}</td>
                      <td>
                        <div className="recent-activity-panel__status">
                          <div className="recent-activity-panel__status-row">
                            {getStatusIcon(call.Status)}
                            <span>{call.Status}</span>
                          </div>
                          {call.FailureReason && (
                            <span className="recent-activity-panel__fail-hint" title={call.FailureReason}>
                              Failed at: {call.FailureStage || call.FailureReason}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        {call.HasManualAudit ? (
                          <Badge
                            variant="success"
                            className="recent-activity-panel__audit-badge"
                            title={auditLabel(call)}
                          >
                            <FaClipboardCheck aria-hidden="true" style={{ marginRight: 4 }} />
                            Audited
                          </Badge>
                        ) : (
                          <span className="recent-activity-panel__audit-pending">—</span>
                        )}
                      </td>
                      <td>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleView(call.FileName)}
                          aria-label={`View details for ${call.FileName}`}
                        >
                          View
                        </Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="recent-activity-panel__empty">
                      {filtersActive
                        ? "No calls match your filters. Try adjusting or clearing them."
                        : "No uploads yet. Submit a call above to get started."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {recentCalls.length > pageSize && (
              <div className="recent-activity-panel__pager">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCurrentPage((p) => p - 1)}
                  disabled={currentPage === 1}
                  aria-label="Previous page"
                >
                  Previous
                </Button>
                <span className="recent-activity-panel__page-label">
                  Page {currentPage} of {Math.ceil(recentCalls.length / pageSize)}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCurrentPage((p) => p + 1)}
                  disabled={currentPage * pageSize >= recentCalls.length}
                  aria-label="Next page"
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}
        </div>
      </div>
    </section>
  );
}
