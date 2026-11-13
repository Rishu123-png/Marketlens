/** Presentation helpers. They never manufacture a market value. */

export function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function compactNumber(value, options = {}) {
  const number = numberOrNull(value);
  if (number === null) return "—";
  return new Intl.NumberFormat("en-IN", {
    notation: "compact",
    maximumFractionDigits: 1,
    ...options
  }).format(number);
}

export function preciseNumber(value, digits = 2) {
  const number = numberOrNull(value);
  if (number === null) return "—";
  return number.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

export function signedPercent(value) {
  const number = numberOrNull(value);
  if (number === null) return "—";
  return `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
}

export function changeTone(value) {
  const number = numberOrNull(value);
  if (number === null) return "flat";
  if (number > 0) return "up";
  if (number < 0) return "down";
  return "flat";
}

/**
 * Data state is deliberately conservative. A provider-verified quote is not
 * automatically a real-time quote: no current adapter has an exchange licence
 * that justifies "live". Only an explicit live entitlement would produce that
 * state.
 */
export function quoteState(quote, now = Date.now(), { verifiedByContract = false } = {}) {
  // Raw quote endpoints carry an explicit verification flag. The overview and
  // screener endpoints omit it from their public rows but guarantee that any
  // quote they include has already passed the gateway's identity checks.
  const verified = quote?.quoteVerified === true || (verifiedByContract && quote?.quoteVerified !== false);
  if (!quote || !verified || numberOrNull(quote.price) === null) {
    return { code: "unavailable", label: "UNAVAILABLE", detail: "No verified quote from a configured provider." };
  }
  // updatedAt/retrievedAt are retrieval times, not the market's timestamp.
  // They cannot establish how fresh the underlying observation is.
  const parsed = Date.parse(quote.providerTimestamp);
  if (!Number.isFinite(parsed) || parsed > now + 5 * 60_000) {
    return { code: "stale", label: "VERIFIED · TIME UNKNOWN", detail: "Identity verified; provider timestamp unavailable or invalid. Freshness cannot be established." };
  }
  const ageMinutes = Math.max(0, Math.round((now - parsed) / 60_000));
  const detail = ageMinutes < 60 ? `${ageMinutes}m` : `${Math.round(ageMinutes / 60)}h`;
  // A real-time claim cannot make an old or undated observation live.
  if (ageMinutes <= 2 && (quote.live === true || quote.realtime === true)) {
    return { code: "live", label: "VERIFIED LIVE", detail: "Provider marks the quote real-time." };
  }
  if (ageMinutes <= 24 * 60) {
    return { code: "delayed", label: "VERIFIED DELAYED", detail: `Verified quote, ${detail}.` };
  }
  if (ageMinutes <= 7 * 24 * 60) {
    return { code: "historical", label: "HISTORICAL", detail: `Verified quote is ${detail} old.` };
  }
  return { code: "stale", label: "STALE", detail: `Verified quote is ${detail} old.` };
}

export function candleState(analysis) {
  if (!analysis?.candles?.length) {
    return { code: "unavailable", label: "UNAVAILABLE", detail: "No historical candles returned." };
  }
  return {
    code: "historical",
    label: "HISTORICAL",
    detail: `${analysis.candles.length} candles · ${analysis.source || "provider"}`
  };
}

export function sessionLabel(market) {
  if (!market?.status) return { label: "SESSION UNKNOWN", code: "unavailable", time: "—" };
  const map = {
    open: { label: "SESSION HOURS*", code: "delayed" },
    "pre-open": { label: "BEFORE SESSION*", code: "delayed" },
    closed: { label: "OUTSIDE HOURS*", code: "closed" },
    weekend: { label: "WEEKEND · CLOSED", code: "closed" }
  };
  return { ...(map[market.status] || map.closed), time: market.istTime || "—" };
}

export function instrumentMonogram(symbol = "") {
  const cleaned = String(symbol).replace(/^\^/, "");
  return cleaned.slice(0, 2).toUpperCase() || "ML";
}

export function providerLabel(value) {
  if (!value) return "provider not reported";
  return String(value).replaceAll("_", " ");
}

export function fileSafe(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** Count usable index observations rather than catalog entries. */
export function summarizeQuotes(entries = [], now = Date.now(), options = {}) {
  const states = entries.map((entry) => quoteState(entry?.quote, now, options)).filter((state) => state.code !== "unavailable");
  if (!states.length) return { count: 0, code: "unavailable", label: "NO VERIFIED QUOTES" };
  const codes = new Set(states.map((state) => state.code));
  if (codes.size === 1) return { count: states.length, ...states[0] };
  return { count: states.length, code: "stale", label: "MIXED FRESHNESS", detail: "See each quote for its individual freshness." };
}

/** The coverage endpoint nests market observations under instruments, not evidence coverage. */
export function marketCoverage(payload) {
  return payload?.instruments?.coverage ?? null;
}
