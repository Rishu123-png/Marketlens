/**
 * Thin JSON client. Errors keep the HTTP status and structured details so a
 * view can distinguish "not configured" (503) from "not found" (404) or a
 * validation problem (400) without guessing from the message.
 */
export async function api(path, { method = "GET", body, signal } = {}) {
  const response = await fetch(path, {
    method,
    signal,
    headers: body ? { "content-type": "application/json" } : undefined,
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(payload?.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.details = payload?.details ?? null;
    error.payload = payload;
    throw error;
  }

  return payload;
}

export const formatMoney = (value, currency = "INR") => {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const symbol = currency === "INR" ? "₹" : currency === "USD" ? "$" : "";
  return `${symbol}${Number(value).toLocaleString(currency === "INR" ? "en-IN" : "en-US", {
    maximumFractionDigits: 2
  })}`;
};

export const formatPercent = (value) => {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  return `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
};

export const formatTime = (value) => {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return String(value);
  return new Date(parsed).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};
