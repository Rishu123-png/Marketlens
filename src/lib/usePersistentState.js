import { useCallback, useEffect, useState } from "react";

/**
 * Local, explicit persistence. Browser storage is used for watchlists, alerts
 * and the virtual portfolio because this deployment has no authenticated user
 * store; every screen that uses it says so instead of implying server-side sync.
 */
export function usePersistentState(key, fallback) {
  const [value, setValue] = useState(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return fallback;
      const parsed = JSON.parse(raw);
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage can be disabled; the session still works in memory */
    }
  }, [key, value]);

  const reset = useCallback(() => setValue(fallback), [fallback]);
  return [value, setValue, reset];
}

export function uid(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
