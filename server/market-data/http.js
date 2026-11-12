/**
 * Shared JSON fetch for market-data providers.
 *
 * Every provider call is bounded by a timeout and every non-2xx response is
 * converted into an Error whose message is safe to surface in an API `details`
 * array (no keys, no headers).
 */

const DEFAULT_TIMEOUT_MS = 8_000;

export async function fetchJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(text.slice(0, 250) || `Provider HTTP ${response.status}`);
    }

    if (!response.ok) {
      throw new Error(
        data?.["Error Message"] ||
          data?.message ||
          data?.error ||
          data?.Information ||
          `Provider HTTP ${response.status}`
      );
    }

    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Provider request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/** Number, or null. Strips thousands separators and percent signs. */
export function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/,/g, "").replace("%", ""));
  return Number.isFinite(number) ? number : null;
}

/** Unix seconds or ISO string to ISO string, or null when unusable. */
export function parseTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}
