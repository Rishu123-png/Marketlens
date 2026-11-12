/**
 * Small HTTP helper for news and filing adapters.
 *
 * Same rules as the market-data helper: bounded timeout, no credentials in
 * error messages, and responses that are not JSON come back as text so RSS/Atom
 * feeds can be parsed.
 */

const DEFAULT_TIMEOUT_MS = 8_000;

export async function fetchText(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {} } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "MarketLens/1.0 (research; contact: ops@marketlens.example)", ...headers }
    });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Source HTTP ${response.status}`);
    }

    return text;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Source request timed out.");
    throw new Error(error instanceof Error ? error.message.slice(0, 200) : "Source request failed.");
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {} } = {}) {
  const text = await fetchText(url, { timeoutMs, headers });
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Source returned a non-JSON response.");
  }
}
