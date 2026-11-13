import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";

/**
 * Small resource hook with explicit loading/error state. It never substitutes
 * demo data when a request fails.
 */
export function useApiResource(path, { intervalMs = 0, enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled && path));
  const mounted = useRef(true);

  const load = useCallback(
    async ({ quiet = false } = {}) => {
      if (!path || !enabled) return null;
      if (!quiet) setLoading(true);
      try {
        const payload = await api(path);
        if (mounted.current) {
          setData(payload);
          setError(null);
        }
        return payload;
      } catch (cause) {
        if (mounted.current) setError(cause);
        return null;
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    [path, enabled]
  );

  useEffect(() => {
    mounted.current = true;
    load();
    if (!intervalMs) return () => { mounted.current = false; };
    const timer = window.setInterval(() => load({ quiet: true }), intervalMs);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
    };
  }, [load, intervalMs]);

  return { data, error, loading, reload: load, setData };
}

export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
