import React, {
  useEffect,
  useState
} from "react";

import {
  createRoot
} from "react-dom/client";

import "./styles.css";

const symbols = [
  "RELIANCE",
  "TCS",
  "INFY",
  "HDFCBANK",
  "BHARTIARTL"
];

const money = (value) => {
  if (value === null || value === undefined) {
    return "—";
  }

  return `₹${Number(value).toLocaleString(
    "en-IN",
    {
      maximumFractionDigits: 2
    }
  )}`;
};

const pct = (value) => {
  if (value === null || value === undefined) {
    return "—";
  }

  const number = Number(value);

  return `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
};

function App() {
  const [started, setStarted] =
    useState(false);

  const [query, setQuery] =
    useState("");

  const [stocks, setStocks] =
    useState([]);

  const [selected, setSelected] =
    useState(null);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  async function load() {
    setLoading(true);
    setError("");

    try {
      const results =
        await Promise.allSettled(
          symbols.map(async (symbol) => {
            const response =
              await fetch(
                `/api/market?symbol=${encodeURIComponent(
                  symbol
                )}`
              );

            const data =
              await response.json();

            if (!response.ok) {
              const details =
                Array.isArray(data.details)
                  ? data.details
                      .map((item) => {
                        if (
                          typeof item === "string"
                        ) {
                          return item;
                        }

                        return `${item.provider}: ${item.message}`;
                      })
                      .join(" | ")
                  : "";

              throw new Error(
                details ||
                  data.error ||
                  "Market data unavailable"
              );
            }

            return data;
          })
        );

      const successful =
        results
          .filter(
            (result) =>
              result.status ===
              "fulfilled"
          )
          .map(
            (result) => result.value
          );

      const failed =
        results
          .filter(
            (result) =>
              result.status ===
              "rejected"
          )
          .map(
            (result) =>
              result.reason?.message
          )
          .filter(Boolean);

      setStocks(successful);

      if (successful.length === 0) {
        setError(
          failed[0] ||
            "No market-data provider returned usable quotes."
        );
      } else if (failed.length > 0) {
        setError(
          `${successful.length} of ${symbols.length} stocks loaded. Some symbols are temporarily unavailable.`
        );
      }
    } catch (loadError) {
      setStocks([]);

      setError(
        loadError instanceof Error
          ? loadError.message
          : "Market data unavailable."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (started) {
      load();
    }
  }, [started]);

  const filtered = stocks.filter(
    (stock) =>
      (stock.symbol || "")
        .toLowerCase()
        .includes(
          query.toLowerCase()
        )
  );

  return (
    <div className="app">
      <header>
        <div className="brand">
          <div className="logo">
            ⌁
          </div>

          <div>
            <strong>
              MarketLens
            </strong>

            <small>
              Clarity for every market move
            </small>
          </div>
        </div>

        <nav>
          <button className="nav active">
            Overview
          </button>

          <button className="nav">
            Screener
          </button>

          <button className="nav">
            Watchlist
          </button>
        </nav>

        <button className="menu">
          ☰
        </button>
      </header>

      {!started ? (
        <main className="landing">
          <div className="eyebrow">
            <span className="pulse" />
            INDIAN MARKETS · RESEARCH
          </div>

          <h1>
            See the market
            <br />

            <em>
              with clarity.
            </em>
          </h1>

          <p className="hero-copy">
            MarketLens brings available market
            data, business fundamentals and market
            context together — then explains what
            matters in plain language.
          </p>

          <div className="hero-actions">
            <button
              className="primary"
              onClick={() =>
                setStarted(true)
              }
            >
              Start analyzing
              <span>
                →
              </span>
            </button>

            <button
              className="ghost"
              onClick={() =>
                document
                  .getElementById("how")
                  ?.scrollIntoView({
                    behavior: "smooth"
                  })
              }
            >
              How it works
              <span>
                ↓
              </span>
            </button>
          </div>

          <div className="hero-note">
            ◉ Provider data only · no invented
            prices · availability may vary
          </div>

          <div className="orbit">
            <div className="orbit-ring" />

            <div className="orb-center">
              <span>
                ML
              </span>
            </div>

            <div className="orb-card card-a">
              <small>
                DATA FIRST
              </small>

              <b>
                Provider feeds
              </b>

              <span className="muted">
                Server verified
              </span>
            </div>

            <div className="orb-card card-b">
              <small>
                RESEARCH
              </small>

              <b>
                Explainable
              </b>

              <span className="muted">
                Risk before reward
              </span>
            </div>
          </div>

          <section
            id="how"
            className="features"
          >
            <div>
              <span className="feature-num">
                01
              </span>

              <h3>
                Connect
              </h3>

              <p>
                Request market information from
                configured providers.
              </p>
            </div>

            <div>
              <span className="feature-num">
                02
              </span>

              <h3>
                Analyze
              </h3>

              <p>
                Use transparent calculations and
                verified inputs.
              </p>
            </div>

            <div>
              <span className="feature-num">
                03
              </span>

              <h3>
                Understand
              </h3>

              <p>
                Review scenarios, risks and
                context in simple language.
              </p>
            </div>
          </section>
        </main>
      ) : (
        <main className="dashboard">
          <div className="dash-top">
            <div>
              <div className="eyebrow">
                MARKET OVERVIEW
                <span className="live-dot" />
                PROVIDER RESPONSE
              </div>

              <h1>
                Market dashboard.
              </h1>

              <p>
                Available information from your
                configured market-data providers.
              </p>
            </div>

            <button
              className="refresh"
              onClick={load}
              disabled={loading}
            >
              {loading
                ? "Loading..."
                : "↻ Refresh"}
            </button>
          </div>

          <div className="search-wrap">
            <span>
              ⌕
            </span>

            <input
              className="search"
              value={query}
              onChange={(event) =>
                setQuery(event.target.value)
              }
              placeholder="Search loaded symbols..."
            />
          </div>

          {error && (
            <div className="api-error">
              <b>
                {stocks.length > 0
                  ? "Partial market data"
                  : "Market data unavailable"}
              </b>

              <span>
                {error}
              </span>

              <small>
                API quota, market coverage,
                exchange symbol support and provider
                availability can affect results.
              </small>
            </div>
          )}

          {loading && (
            <div className="loading">
              Fetching market data…
            </div>
          )}

          {!loading &&
            stocks.length > 0 && (
              <>
                <div className="data-banner">
                  ● PROVIDER RESPONSE · Received:{" "}
                  {new Date(
                    stocks[0].updatedAt
                  ).toLocaleString()}
                </div>

                <div className="content-grid">
                  <section className="panel">
                    <div className="panel-head">
                      <div>
                        <h2>
                          Loaded stocks
                        </h2>

                        <p>
                          Quotes returned by
                          available providers
                        </p>
                      </div>
                    </div>

                    <div className="stock-list">
                      {filtered.map(
                        (stock) => (
                          <button
                            className="stock-row"
                            onClick={() =>
                              setSelected(stock)
                            }
                            key={stock.symbol}
                          >
                            <div className="stock-icon">
                              {stock.symbol.slice(
                                0,
                                2
                              )}
                            </div>

                            <div className="stock-name">
                              <b>
                                {stock.symbol}
                              </b>

                              <small>
                                Provider:{" "}
                                {stock.source}
                              </small>
                            </div>

                            <div className="stock-price">
                              <b>
                                {money(
                                  stock.price
                                )}
                              </b>

                              <span
                                className={
                                  Number(
                                    stock.changePercent
                                  ) >= 0
                                    ? "up"
                                    : "down"
                                }
                              >
                                {pct(
                                  stock.changePercent
                                )}
                              </span>
                            </div>

                            <span className="arrow">
                              →
                            </span>
                          </button>
                        )
                      )}

                      {filtered.length === 0 && (
                        <div className="empty">
                          No loaded symbol matches
                          your search.
                        </div>
                      )}
                    </div>
                  </section>

                  <aside className="panel">
                    <div className="panel-head">
                      <div>
                        <h2>
                          Data quality
                        </h2>

                        <p>
                          Always inspect freshness
                          and coverage
                        </p>
                      </div>
                    </div>

                    <div className="quality">
                      <span className="quality-dot" />

                      <b>
                        Provider response received
                      </b>
                    </div>

                    <div className="quality-line">
                      <span>
                        Source
                      </span>

                      <b>
                        {stocks[0].source}
                      </b>
                    </div>

                    <div className="quality-line">
                      <span>
                        Quotes loaded
                      </span>

                      <b>
                        {stocks.length}
                      </b>
                    </div>

                    <div className="quality-line">
                      <span>
                        Fallback used
                      </span>

                      <b>
                        {stocks.some(
                          (stock) =>
                            stock.fallbackUsed
                        )
                          ? "Yes"
                          : "No"}
                      </b>
                    </div>

                    <div className="tip">
                      <b>
                        Research note
                      </b>

                      <p>
                        A positive price move is not
                        a recommendation. Check
                        fundamentals, valuation,
                        liquidity and risk before
                        acting.
                      </p>
                    </div>
                  </aside>
                </div>
              </>
            )}

          {!loading &&
            !stocks.length &&
            !error && (
              <div className="empty">
                No provider data returned.
              </div>
            )}

          <div className="disclaimer">
            MarketLens is a research and education
            tool. It does not guarantee returns or
            provide personalized investment advice.
            Market investments are subject to risk.
          </div>
        </main>
      )}

      <footer>
        <span>
          MarketLens
        </span>

        <span>
          Made by Rishu Jaswar
        </span>

        <span>
          Research clearly · Invest responsibly
        </span>
      </footer>

      {selected && (
        <div
          className="modal-backdrop"
          onClick={() =>
            setSelected(null)
          }
        >
          <div
            className="modal"
            onClick={(event) =>
              event.stopPropagation()
            }
          >
            <button
              className="close"
              onClick={() =>
                setSelected(null)
              }
            >
              ×
            </button>

            <div className="eyebrow">
              PROVIDER QUOTE ·{" "}
              {selected.symbol}
            </div>

            <h2>
              {selected.symbol}
            </h2>

            <div className="modal-price">
              {money(selected.price)}

              <span
                className={
                  Number(
                    selected.changePercent
                  ) >= 0
                    ? "up"
                    : "down"
                }
              >
                {pct(
                  selected.changePercent
                )}
              </span>
            </div>

            <div className="report">
              <b>
                Provider data
              </b>

              <div className="metrics">
                <span>
                  <small>
                    Open
                  </small>

                  <b>
                    {money(
                      selected.open
                    )}
                  </b>
                </span>

                <span>
                  <small>
                    Day high
                  </small>

                  <b>
                    {money(
                      selected.dayHigh
                    )}
                  </b>
                </span>

                <span>
                  <small>
                    Volume
                  </small>

                  <b>
                    {selected.volume != null
                      ? Number(
                          selected.volume
                        ).toLocaleString(
                          "en-IN"
                        )
                      : "—"}
                  </b>
                </span>
              </div>

              <p>
                AI research reports should only use
                verified metrics returned by market
                data providers.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(
  document.getElementById("root")
).render(<App />);