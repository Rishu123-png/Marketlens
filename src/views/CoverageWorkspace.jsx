import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatTime } from "../lib/api.js";

function count(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString("en-IN") : "—";
}

function chipFor(status) {
  if (["ok", "verified", "eligible", "active"].includes(status)) return "ok";
  if (["unconfigured", "declared-not-configured", "configured-unverified", "primary", "fallback"].includes(status)) return "warn";
  if (["rejected", "unavailable", "unsupported", "rejected-terms"].includes(status)) return "bad";
  return "muted";
}

/**
 * Market Data Coverage workspace.
 *
 * Separate from AI usage by design. Every number here is about instruments,
 * providers, intervals and observed data. A configured provider is not
 * verified coverage; a declared exchange is not an entitlement; nothing is
 * labelled real-time unless a provider explicitly claims and proves it.
 */
export default function CoverageWorkspace() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [exchange, setExchange] = useState("ALL");
  const [assetType, setAssetType] = useState("ALL");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await api("/api/diagnostics");
      setData(payload.market);
      setError(null);
    } catch (cause) {
      setError(cause.message || "Coverage unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 45_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const matrix = data?.instrumentMatrix || [];
  const registry = data?.registry?.providers || {};
  const requests = data?.recentRequests?.entries || [];
  const coverage = data?.instrumentCoverage;

  const rows = useMemo(() => {
    const needle = search.trim().toUpperCase();
    return matrix.filter((entry) => {
      const instrument = entry.instrument || entry;
      if (exchange !== "ALL" && instrument.exchange !== exchange) return false;
      if (assetType !== "ALL" && instrument.assetType !== assetType) return false;
      if (!needle) return true;
      return `${instrument.symbol} ${instrument.name} ${instrument.id}`.toUpperCase().includes(needle);
    });
  }, [matrix, search, exchange, assetType]);

  const exchanges = useMemo(
    () => [...new Set(matrix.map((entry) => (entry.instrument || entry).exchange))].sort(),
    [matrix]
  );
  const types = useMemo(
    () => [...new Set(matrix.map((entry) => (entry.instrument || entry).assetType))].sort(),
    [matrix]
  );

  return (
    <section className="lab coverage-workspace">
      <header className="lab-heading">
        <div>
          <span className="eyebrow">MARKET DATA · COVERAGE MATRIX</span>
          <h1>
            What the data can support, <span>and what it cannot.</span>
          </h1>
          <p>
            Configured → mapped → attempted → validated → covered. These are different facts. Free developer tiers do not
            become authorised NSE/BSE real-time feeds, and no instrument is marked real-time here.
          </p>
        </div>
        <div className="heading-side">
          <button type="button" className="mode" onClick={load} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <span className="chip muted">{data?.freshness?.classification || "unknown"} freshness</span>
        </div>
      </header>

      {error && (
        <div className="notice error" role="alert">
          <strong>Coverage unavailable</strong>
          <p>{error}</p>
        </div>
      )}

      <div className="diag-summary coverage-summary">
        <div>
          <span>CATALOGUED</span>
          <strong>{count(coverage?.catalogued)}</strong>
        </div>
        <div>
          <span>QUOTE-CAPABLE (CONFIGURED)</span>
          <strong>{count(coverage?.quoteEnabled)}</strong>
        </div>
        <div>
          <span>VERIFIED QUOTES</span>
          <strong>{count(coverage?.verifiedLatestQuote)}</strong>
        </div>
        <div>
          <span>VERIFIED CANDLES</span>
          <strong>{count(coverage?.verifiedHistoricalCandles)}</strong>
        </div>
        <div>
          <span>NO CONFIGURED SOURCE</span>
          <strong>{count(coverage?.unavailableFromAllConfigured)}</strong>
        </div>
        <div>
          <span>REAL-TIME</span>
          <strong>{count(coverage?.realtime)}</strong>
        </div>
      </div>

      <div className="diagnostics-grid">
        <article className="panel diagnostics-panel">
          <div className="panel-head">
            <div>
              <span className="section-kicker">PROVIDER REGISTRY V2</span>
              <h2>Exchanges, intervals, entitlement and licensing</h2>
            </div>
            <span className="chip muted">{data?.registry?.version || "—"}</span>
          </div>
          <table className="diag-table">
            <thead>
              <tr>
                <th>PROVIDER</th>
                <th>STATE</th>
                <th>EXCHANGES</th>
                <th>QUOTE / CANDLES</th>
                <th>INTERVALS</th>
                <th>ENTITLEMENT (INDIA)</th>
                <th>CIRCUIT / QUOTA</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(registry).map((provider) => {
                const health = provider.health || {};
                return (
                  <tr key={provider.id}>
                    <td>
                      <strong>{provider.label}</strong>
                      <small>{provider.kind} · {provider.envName || "no key"}</small>
                    </td>
                    <td>
                      <span className={`chip ${chipFor(provider.status)}`}>{provider.status}</span>
                      <div>{provider.configured ? "configured" : "not configured"}</div>
                    </td>
                    <td>{provider.exchanges?.join(", ")}</td>
                    <td>
                      quote: {provider.quote?.freshness || "—"}
                      <div>candles: {provider.candles?.daily ? "daily" : "—"}{provider.candles?.intraday?.length ? ` · ${provider.candles.intraday.length} intraday` : ""}</div>
                    </td>
                    <td>
                      daily {provider.intervals?.daily?.join("/") || "—"}
                      <div>intraday {provider.intervals?.intraday?.join("/") || "—"}</div>
                    </td>
                    <td>
                      {provider.entitlement?.indiaEquity || "—"}
                      <div className="muted-note">{provider.licensing?.permittedUse || "—"}</div>
                    </td>
                    <td>
                      {health.circuit || "—"} {health.reason ? `· ${health.reason}` : ""}
                      <div>
                        {health.quota?.remainingRequests != null
                          ? `${health.quota.remainingRequests} requester left`
                          : provider.rateLimits?.freeTier
                            ? `free: ${Object.values(provider.rateLimits.freeTier).filter((value) => value != null).join(" / ")}`
                            : "no quota metadata"}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted-note">
            Declared exchange lists are not instrument-level entitlements. Yahoo/yfinance is shown only as
            evaluated-and-rejected under Yahoo&apos;s automated-access terms; it is not a registered provider.
          </p>
        </article>

        <article className="panel diagnostics-panel">
          <div className="panel-head">
            <div>
              <span className="section-kicker">INTERVAL COVERAGE</span>
              <h2>Declared vs configured, never inferred</h2>
            </div>
            <span className="chip muted">{data?.freshness?.lastSuccessfulQuoteAt ? `LAST QUOTE ${formatTime(data.freshness.lastSuccessfulQuoteAt)}` : "NO VERIFIED QUOTE"}</span>
          </div>
          <table className="diag-table">
            <thead>
              <tr>
                <th>EXCHANGE</th>
                <th>INTERVAL</th>
                <th>DECLARED</th>
                <th>CONFIGURED</th>
                <th>VERIFIED</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data?.intervalCoverage || {}).flatMap(([venue, intervals]) =>
                Object.entries(intervals).map(([interval, row]) => (
                  <tr key={`${venue}-${interval}`}>
                    <td>{venue}</td>
                    <td>{interval}</td>
                    <td>{row.declaredProviders?.join(", ") || "—"}</td>
                    <td>{row.configuredProviders?.join(", ") || "—"}</td>
                    <td>{count(row.verifiedInstruments)}</td>
                    <td><span className={`chip ${chipFor(row.status)}`}>{row.status}</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <p className="muted-note">
            Daily/weekly/monthly/intraday support is a provider declaration. Verified coverage requires an observed,
            identity-validated response and is still not a real-time claim.
          </p>
        </article>
      </div>

      <article className="panel diagnostics-panel">
        <div className="panel-head">
          <div>
            <span className="section-kicker">INSTRUMENT COVERAGE</span>
            <h2>Every catalogued listing, with its honest state</h2>
          </div>
          <span className="chip muted">{count(rows.length)} SHOWN</span>
        </div>

        <div className="workspace-toolbar">
          <input
            type="search"
            value={search}
            placeholder="Search symbol, name or internal id"
            onChange={(event) => setSearch(event.target.value)}
          />
          <select value={exchange} onChange={(event) => setExchange(event.target.value)}>
            <option value="ALL">All exchanges</option>
            {exchanges.map((venue) => <option key={venue} value={venue}>{venue}</option>)}
          </select>
          <select value={assetType} onChange={(event) => setAssetType(event.target.value)}>
            <option value="ALL">All asset types</option>
            {types.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </div>

        <div className="diag-request-table">
          <table className="diag-table">
            <thead>
              <tr>
                <th>INSTRUMENT</th>
                <th>EXCHANGE</th>
                <th>TYPE</th>
                <th>MAPPED</th>
                <th>QUOTE ENABLED</th>
                <th>CANDLE ENABLED</th>
                <th>VERIFIED QUOTE</th>
                <th>LAST SUCCESS</th>
                <th>PROVIDER / ERROR</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => {
                const instrument = entry.instrument || entry;
                const availability = entry.availability || instrument.availability || {};
                const lastSuccess = availability.lastQuoteAt || availability.lastCandleAt || null;
                return (
                  <tr key={instrument.id}>
                    <td>
                      <strong>{instrument.symbol}</strong>
                      <small>{instrument.name}</small>
                    </td>
                    <td>{instrument.exchange}</td>
                    <td>{instrument.assetType}</td>
                    <td>{availability.providerSymbols ? Object.entries(availability.providerSymbols).map(([id, ticker]) => `${id}:${ticker || "unmapped"}`).join(" · ") : availability.mappedProviders?.join(", ") || "—"}</td>
                    <td>{availability.quoteEnabled ? "yes" : "no"}</td>
                    <td>{availability.candleEnabled ? "yes" : "no"}</td>
                    <td>{availability.quoteVerifiedRecently ? "yes" : "no"}</td>
                    <td>{lastSuccess ? formatTime(lastSuccess) : "never in this instance"}</td>
                    <td title={entry.failure || ""}>
                      {availability.quoteProviders?.join(", ") || "—"}
                      {entry.failure ? <small>{String(entry.failure).slice(0, 80)}</small> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>

      <article className="panel diagnostics-panel">
        <div className="panel-head">
          <div>
            <span className="section-kicker">LAST ATTEMPTS</span>
            <h2>Configured → attempted → succeeded → validated</h2>
          </div>
          <span className="chip muted">{count(requests.length)} REQUESTS</span>
        </div>
        {!requests.length && <div className="chart-placeholder empty compact">No quote or candle requests recorded in this instance.</div>}
        {requests.length > 0 && (
          <div className="diag-request-table">
            <table className="diag-table">
              <thead>
                <tr>
                  <th>TIME</th>
                  <th>KIND</th>
                  <th>INSTRUMENT</th>
                  <th>PROVIDER</th>
                  <th>CACHE</th>
                  <th>HTTP</th>
                  <th>CANDLES</th>
                  <th>ERROR</th>
                </tr>
              </thead>
              <tbody>
                {requests.slice(0, 30).map((entry, index) => (
                  <tr key={`${entry.at}-${index}`}>
                    <td>{formatTime(entry.at)}</td>
                    <td>{entry.kind}</td>
                    <td>{entry.symbol || entry.instrumentId}<small>{entry.exchange || ""}</small></td>
                    <td>{entry.provider || "—"}</td>
                    <td>{entry.cacheHit ? "hit" : entry.attempted ? "miss" : "not sent"}</td>
                    <td>{entry.httpStatus ?? "—"}</td>
                    <td>{entry.returnedCount ?? 0}{entry.droppedCount ? ` (${entry.droppedCount} dropped)` : ""}</td>
                    <td title={entry.error || ""}>{entry.error ? String(entry.error).slice(0, 70) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  );
}
