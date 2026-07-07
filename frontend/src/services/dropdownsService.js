import { apiGet } from "../utils/apiHelpers";

/** Shared dropdown lists for agent/user forms. */
export async function fetchAgentFormDropdowns() {
  const [managers, teamLeaders, auditors, locations] = await Promise.all([
    apiGet("/api/dropdown/managers", { label: "dropdown-managers" }),
    apiGet("/api/dropdown/team-leaders", { label: "dropdown-team-leaders" }),
    apiGet("/api/dropdown/auditors", { label: "dropdown-auditors" }),
    apiGet("/api/dropdown/locations", { label: "dropdown-locations" }),
  ]);
  return {
    managers: managers.success ? managers.managers || [] : [],
    teamLeaders: teamLeaders.success ? teamLeaders.teamLeaders || [] : [],
    auditors: auditors.auditors || [],
    locations: locations.success ? locations.locations || [] : [],
  };
}

export async function listTeamLeaders({ location } = {}) {
  const params = location && location !== "All" ? { location } : undefined;
  const data = await apiGet("/api/team-leaders", { params, label: "team-leaders" });
  return data.success ? data.teamLeaders || [] : [];
}

export async function listAuditorsDropdown() {
  const data = await apiGet("/api/dropdown/auditors", { label: "auditors-dropdown" });
  return (data.auditors || [])
    .map((a) => a.Username)
    .filter(Boolean)
    .sort();
}

export async function listAgentsDropdown() {
  const data = await apiGet("/api/agents", { label: "agents-dropdown" });
  if (!Array.isArray(data)) return [];
  return [...new Set(data.map((a) => a.agent_name || a.Agent_Name).filter(Boolean))].sort();
}

export async function listLocationsDropdown() {
  const data = await apiGet("/api/dropdown/locations", { label: "dropdown-locations" });
  return data.success ? data.locations || [] : [];
}

/** Active locations from managed Locations table (dashboard filters). */
export async function listActiveLocations() {
  const data = await apiGet("/api/locations", { label: "locations" });
  if (!data.success) {
    throw new Error(data.message || "Failed to fetch locations");
  }
  return data.locations || [];
}
