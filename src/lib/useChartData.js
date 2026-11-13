import { useCallback, useEffect, useRef, useState } from "react";
import { fetchChartData } from "./chartData.js";

/**
 * One request path for every chart. A request id and AbortController prevent a
 * slow older response from replacing a newer selection.
 */
export function useChartData({ initialSymbol = "RELIANCE", initialExchange = "NSE", initialName, initialInterval = "1day", limit = 320, autoLoad = true } = {}) {
  const [instrument, setInstrument] = useState({
    symbol: initialSymbol,
    exchange: initialExchange,
    name: initialName || initialSymbol,
    currency: initialExchange === "NSE" || initialExchange === "BSE" ? "INR" : "USD"
  });
  const [interval, setIntervalValue] = useState(initialInterval);
  const [analysis, setAnalysis] = useState(null);
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState(null);
  const [warning, setWarning] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);
  const abortRef = useRef(null);
  const keyRef = useRef(null);
  const mounted = useRef(true);

  const load = useCallback(
    async (target = instrument, timeframe = interval, { force = false } = {}) => {
      if (!target?.symbol) return;
      const key = `${target.symbol}|${target.exchange || "NSE"}|${timeframe}|${limit}`;
      if (!force && keyRef.current === key) return;
      const id = ++requestRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      // A new symbol/timeframe must never be shown with the previous selection's data.
      setAnalysis(null);
      setQuote(null);
      setError(null);
      setWarning(null);
      setQuoteError(null);
      try {
        const result = await fetchChartData({
          symbol: target.symbol,
          exchange: target.exchange || "",
          interval: timeframe,
          limit,
          signal: controller.signal
        });
        if (!mounted.current || requestRef.current !== id) return;
        setQuote(result.quote);
        setQuoteError(result.quoteError);
        setAnalysis(result.analysis);
        setWarning(result.analysisWarning);
        setError(result.error);
        if (result.analysis) keyRef.current = key;
      } catch (cause) {
        if (mounted.current && requestRef.current === id) {
          setAnalysis(null);
          setQuote(null);
          setError({ message: cause?.message || "Chart request failed.", status: cause?.status, details: cause?.details });
        }
      } finally {
        if (mounted.current && requestRef.current === id) setLoading(false);
      }
    },
    [instrument, interval, limit]
  );

  useEffect(() => {
    mounted.current = true;
    if (autoLoad) load(undefined, undefined, { force: true });
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
    };
    // The initial load is deliberately explicit; later loads are user-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chooseInstrument = useCallback(
    (next) => {
      setInstrument(next);
      load(next, interval, { force: true });
    },
    [interval, load]
  );

  const chooseInterval = useCallback(
    (next) => {
      setIntervalValue(next);
      load(instrument, next, { force: true });
    },
    [instrument, load]
  );

  const refresh = useCallback(() => load(instrument, interval, { force: true }), [instrument, interval, load]);

  return {
    instrument,
    interval,
    analysis,
    quote,
    quoteError,
    warning,
    error,
    loading,
    chooseInstrument,
    chooseInterval,
    refresh
  };
}
