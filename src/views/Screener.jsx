import { useState } from "react";
import { api, formatMoney, formatPercent, formatTime } from "../lib/api.js";
import { ASSET_LABELS } from "../lib/instruments.js";
import { usePersistentState, uid } from "../lib/usePersistentState.js";

const SECTORS = [
  "",
  "Banking",
  "Information Technology",
  "Energy",
  "Consumer Goods",
  "Automotive",
  "Pharmaceuticals",
  "Healthcare",
  "Metals",
  "Utilities",
  "Financial Services",
  "Industrials",
  "Cement",
  "Telecom",
  "Real Estate",
  "Chemicals",
  "Defence",
  "Retail",
  "Internet",
  "Infrastructure"
];

const BLANK = {
  assetType: "",
  exchange: "NSE",
  sector: "",
  priceMin: "",
  priceMax: "",
  changeMin: "",
  changeMax: "",
  volumeMin: "",
  smaCondition: "",
  rsiMin: "",
  rsiMax: "",
  universeLimit: "20",
  technicalLimit: "12"
};

function buildQuery(filters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== "" && value !== null && value !== undefined) params.set(key, value);
  }
  return params.toString();
}

export default function Screener({ onNavigate }) {
  const [filters, setFilters] = useState(BLANK);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [screens, setScreens] = usePersistentState("marketlens-saved-screens", []);
  const [screenName, setScreenName] = useState("");

  function update(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  async function run(event) {
    event?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      setResult(await api(`/api/screener?${buildQuery(filters)}`));
    } catch (cause) {
      setResult(null);
      setError({ message: cause.message, details: cause.details });
    } finally {
      setLoading(false);
    }
  }

  function saveScreen() {
    const name = screenName.trim() || `Screen ${screens.length + 1}`;
    setScreens((current) => [...current, { id: uid("screen"), name, filters, createdAt: new Date().toISOString() }]);
    setScreenName("");
  }

  return (
    <section className="lab">
      <header className="lab-heading">
        <div>
          <span className="eyebrow">MARKET SCREENER</span>
          <h1>
            Filter the universe, <span>only where data exists.</span>
          </h1>
          <p>
            Quote filters run on provider-verified prices. Technical filters need candles, so they are evaluated on a
            bounded subset and the response states how many instruments were skipped or unavailable.
          </p>
        </div>
        <div className="heading-side">
          <span className="chip muted">no market-cap filter</span>
          <span className="chip">browser-saved screens</span>
        </div>
      </header>

      <form className="screen-form" onSubmit={run}>
        <div className="screen-row">
          <label>
            <span>ASSET TYPE</span>
            <select value={filters.assetType} onChange={(event) => update("assetType", event.target.value)}>
              <option value="">All equities &amp; ETFs</option>
              <option value="equity">Equity</option>
              <option value="etf">ETF</option>
            </select>
          </label>
          <label>
            <span>EXCHANGE</span>
            <select value={filters.exchange} onChange={(event) => update("exchange", event.target.value)}>
              <option value="">Any</option>
              {["NSE", "BSE", "NASDAQ", "NYSE"].map((exchange) => <option key={exchange}>{exchange}</option>)}
            </select>
          </label>
          <label>
            <span>SECTOR</span>
            <select value={filters.sector} onChange={(event) => update("sector", event.target.value)}>
              {SECTORS.map((sector) => <option key={sector} value={sector}>{sector || "Any"}</option>)}
            </select>
          </label>
          <label>
            <span>PRICE MIN</span>
            <input type="number" step="any" value={filters.priceMin} onChange={(event) => update("priceMin", event.target.value)} placeholder="0" />
          </label>
          <label>
            <span>PRICE MAX</span>
            <input type="number" step="any" value={filters.priceMax} onChange={(event) => update("priceMax", event.target.value)} placeholder="—" />
          </label>
          <label>
            <span>CHANGE % MIN</span>
            <input type="number" step="any" value={filters.changeMin} onChange={(event) => update("changeMin", event.target.value)} placeholder="-10" />
          </label>
          <label>
            <span>CHANGE % MAX</span>
            <input type="number" step="any" value={filters.changeMax} onChange={(event) => update("changeMax", event.target.value)} placeholder="10" />
          </label>
          <label>
            <span>VOLUME MIN</span>
            <input type="number" step="any" value={filters.volumeMin} onChange={(event) => update("volumeMin", event.target.value)} placeholder="100000" />
          </label>
          <label>
            <span>MOVING AVERAGE</span>
            <select value={filters.smaCondition} onChange={(event) => update("smaCondition", event.target.value)}>
              <option value="">Any</option>
              <option value="aboveSma50">Price &gt; SMA 50</option>
              <option value="belowSma50">Price &lt; SMA 50</option>
              <option value="aboveSma200">Price &gt; SMA 200</option>
              <option value="belowSma200">Price &lt; SMA 200</option>
            </select>
          </label>
          <label>
            <span>RSI MIN</span>
            <input type="number" step="any" value={filters.rsiMin} onChange={(event) => update("rsiMin", event.target.value)} placeholder="0" />
          </label>
          <label>
            <span>RSI MAX</span>
            <input type="number" step="any" value={filters.rsiMax} onChange={(event) => update("rsiMax", event.target.value)} placeholder="100" />
          </label>
          <label>
            <span>UNIVERSE LIMIT</span>
            <select value={filters.universeLimit} onChange={(event) => update("universeLimit", event.target.value)}>
              {["20", "40", "60"].map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label>
            <span>TECHNICAL LIMIT</span>
            <select value={filters.technicalLimit} onChange={(event) => update("technicalLimit", event.target.value)}>
              {["0", "6", "12"].map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
        </div>
        <div className="screen-actions">
          <button type="submit" className="primary-action" disabled={loading}>{loading ? "Screening…" : "Run screen"}</button>
          <button type="button" className="ghost-action" onClick={() => setFilters(BLANK)}>Reset</button>
          <span className="screen-save">
            <input value={screenName} onChange={(event) => setScreenName(event.target.value)} placeholder="Name this screen" aria-label="Screen name" />
            <button type="button" className="ghost-action" onClick={saveScreen}>Save</button>
          </span>
        </div>
      </form>

      {screens.length > 0 && (
        <div className="saved-screens">
          <span className="section-kicker">SAVED IN THIS BROWSER</span>
          {screens.map((screen) => (
            <span key={screen.id} className="saved-screen">
              <button type="button" className="text-action" onClick={() => setFilters({ ...BLANK, ...screen.filters })}>{screen.name}</button>
              <button
                type="button"
                className="clear-search"
                onClick={() => setScreens((current) => current.filter((item) => item.id !== screen.id))}
                aria-label={`Delete ${screen.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {error && (
        <div className="notice error" role="alert">
          <strong>Screen rejected</strong>
          <p>{error.message}</p>
          {Array.isArray(error.details) && <ul className="notice-list">{error.details.map((line, index) => <li key={index}>{line}</li>)}</ul>}
        </div>
      )}

      {result && (
        <>
          <div className="screen-summary">
            <div><span>VERIFIED QUOTES</span><strong>{result.universe.verifiedQuotes}</strong></div>
            <div><span>QUOTE MATCHES</span><strong>{result.universe.quoteMatched}</strong></div>
            <div><span>TECH EVALUATED</span><strong>{result.universe.technicalEvaluated}</strong></div>
            <div><span>FINAL MATCHES</span><strong>{result.matched}</strong></div>
            <div><span>UNIVERSE</span><strong>{result.universe.pool}</strong></div>
          </div>

          <div className="table-scroll market-panel">
            <table className="stocks-table">
              <thead>
                <tr>
                  <th>INSTRUMENT</th>
                  <th>PRICE</th>
                  <th>CHANGE</th>
                  <th>VOLUME</th>
                  <th>RSI</th>
                  <th>SMA 50</th>
                  <th>SMA 200</th>
                  <th>REL VOL</th>
                  <th>TECH</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <button className="instrument-cell" type="button" onClick={() => onNavigate?.("charts", row)}>
                        <span className="ticker-icon">{row.symbol.slice(0, 2)}</span>
                        <span className="instrument-text">
                          <strong>{row.symbol}</strong>
                          <small>{row.name} · {row.sector}</small>
                        </span>
                      </button>
                    </td>
                    <td className="table-price">{formatMoney(row.price, row.currency)}</td>
                    <td>
                      <span className={`change-pill ${Number(row.changePercent) >= 0 ? "positive" : "negative"}`}>
                        {formatPercent(row.changePercent)}
                      </span>
                    </td>
                    <td className="volume-cell">{Intl.NumberFormat("en-IN", { notation: "compact" }).format(Number(row.volume) || 0)}</td>
                    <td>{row.indicators?.rsi?.toFixed?.(2) ?? "—"}</td>
                    <td>{row.indicators?.sma50?.toFixed?.(2) ?? "—"}</td>
                    <td>{row.indicators?.sma200?.toFixed?.(2) ?? "—"}</td>
                    <td>{row.indicators?.relativeVolume?.toFixed?.(2) ?? "—"}</td>
                    <td className="not-quoted">{row.technicalStatus}</td>
                  </tr>
                ))}
                {!result.rows.length && (
                  <tr><td colSpan="9" className="table-empty">No verified instrument satisfies these filters.</td></tr>
                )}
              </tbody>
            </table>
            <div className="table-footer">
              <span>RETRIEVED {formatTime(result.generatedAt)} · {ASSET_LABELS[result.filters.assetType] || "MIXED"}</span>
              <span>{result.limitations[0]}</span>
            </div>
          </div>

          {result.technicalErrors.length > 0 && (
            <div className="notice info">
              <strong>{result.technicalErrors.length} instrument(s) lacked candle history for technical checks</strong>
              <ul className="notice-list">
                {result.technicalErrors.slice(0, 8).map((item) => <li key={item.symbol}>{item.symbol}: {item.message}</li>)}
              </ul>
            </div>
          )}

          <ul className="limitation-list">
            {result.limitations.map((line, index) => <li key={index}>{line}</li>)}
          </ul>
        </>
      )}
    </section>
  );
}
