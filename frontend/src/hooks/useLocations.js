import { useState, useEffect, useCallback } from "react";
import { apiGet } from "../utils/apiHelpers";

/**
 * Shared hook to fetch active locations from the managed Locations table (Admin Settings).
 * Uses GET /api/locations which returns active locations from dbo.Locations.
 * @returns {{ locations: string[], loading: boolean, error: string|null, refetch: Function }}
 */
export default function useLocations() {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchLocations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet("/api/locations", { label: "locations" });
      if (data.success) {
        setLocations(data.locations || []);
      } else {
        setError(data.message || "Failed to fetch locations");
        setLocations([]);
      }
    } catch (err) {
      console.error("useLocations: failed to fetch:", err);
      setError(err.message);
      setLocations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  return { locations, loading, error, refetch: fetchLocations };
}
