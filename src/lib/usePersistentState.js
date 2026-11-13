import { useCallback, useEffect, useRef, useState } from "react";

const LOCAL_EVENT = "marketlens:local-state";

function readStored(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Browser-local state with same-tab and cross-tab synchronization. It is not a
 * server account: each workspace still makes that storage boundary explicit.
 */
export function usePersistentState(key, fallback) {
  const fallbackRef = useRef(fallback);
  const [value, setValue] = useState(() => readStored(key, fallbackRef.current));

  useEffect(() => {
    function receive(event) {
      const changedKey = event.type === LOCAL_EVENT ? event.detail?.key : event.key;
      if (changedKey !== key) return;
      const next = readStored(key, fallbackRef.current);
      setValue((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    }
    window.addEventListener(LOCAL_EVENT, receive);
    window.addEventListener("storage", receive);
    return () => {
      window.removeEventListener(LOCAL_EVENT, receive);
      window.removeEventListener("storage", receive);
    };
  }, [key]);

  useEffect(() => {
    try {
      const serialized = JSON.stringify(value);
      if (window.localStorage.getItem(key) === serialized) return;
      window.localStorage.setItem(key, serialized);
      window.dispatchEvent(new CustomEvent(LOCAL_EVENT, { detail: { key } }));
    } catch {
      // Storage can be disabled; this hook continues to work in memory.
    }
  }, [key, value]);

  const reset = useCallback(() => setValue(fallbackRef.current), []);
  return [value, setValue, reset];
}

export function uid(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
