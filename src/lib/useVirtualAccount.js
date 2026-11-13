import { useMemo } from "react";
import { usePersistentState, uid } from "./usePersistentState.js";
import { simulateLimitOrder, simulateMarketOrder, STARTING_CASH } from "./virtualAccount.js";
export { STARTING_CASH, FEE_RATE, SLIPPAGE_RATE } from "./virtualAccount.js";

const DEFAULT_ACCOUNT = { startingCash: STARTING_CASH, cash: STARTING_CASH, positions: [], orders: [], equityHistory: [] };

function normalise(value) {
  return {
    ...DEFAULT_ACCOUNT, ...(value || {}),
    positions: Array.isArray(value?.positions) ? value.positions : [],
    orders: Array.isArray(value?.orders) ? value.orders : [],
    equityHistory: Array.isArray(value?.equityHistory) ? value.equityHistory : []
  };
}

/** Browser-local simulation. No broker or real-money execution path exists. */
export function useVirtualAccount() {
  const [raw, setRaw] = usePersistentState("marketlens-virtual-account-v2", DEFAULT_ACCOUNT);
  const account = useMemo(() => normalise(raw), [raw]);

  function executeMarketOrder(input) {
    const result = simulateMarketOrder(account, { ...input, id: uid("ord"), at: new Date().toISOString() });
    if (result.ok) setRaw(result.account);
    return result;
  }
  function placeLimitOrder(input) {
    const result = simulateLimitOrder(account, { ...input, id: uid("ord"), at: new Date().toISOString() });
    if (result.ok) setRaw(result.account);
    return result;
  }
  function cancelOrder(orderId) {
    setRaw((current) => {
      const state = normalise(current);
      return { ...state, orders: state.orders.map((entry) => entry.id === orderId && entry.status === "PENDING" ? { ...entry, status: "CANCELLED" } : entry) };
    });
  }
  function recordEquity(equity) {
    if (!Number.isFinite(Number(equity))) return;
    const point = { at: new Date().toISOString(), equity: Number(Number(equity).toFixed(2)) };
    setRaw((current) => {
      const state = normalise(current);
      return { ...state, equityHistory: [...state.equityHistory, point].slice(-180) };
    });
  }
  function reset() {
    setRaw({ ...DEFAULT_ACCOUNT, positions: [], orders: [], equityHistory: [] });
  }
  return { account, executeMarketOrder, placeLimitOrder, cancelOrder, recordEquity, reset };
}
