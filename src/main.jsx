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
  if (
    value === null ||
    value === undefined
  ) {
    return "Not verified";
  }

  return `₹${Number(
    value
  ).toLocaleString(
    "en-IN",
    {
      maximumFractionDigits: 2
    }
  )}`;
};

const pct = (value) => {
  if (
    value === null ||
    value === undefined
  ) {
    return "Not verified";
  }

  const number = Number(value);

  return `${
    number > 0 ? "+" : ""
  }${number.toFixed(2)}%`;
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
      // Sequential loading prevents all five
      // stocks from hitting fallback APIs at once.
      const successful = [];
      const failed = [];

      for (const symbol of symbols) {
        try {
          const response =
            await fetch(
              `/api/market?symbol=${encodeURIComponent(
                symbol
              )}`
            );

          const data =
            await response.json();

          if (!response.ok) {
            throw new Error(
              data.error ||
              "Market data unavailable"
            );
          }

          successful.push(data);

          // Small delay between symbols.
          await new Promise(
            (resolve) =>
              setTimeout(resolve, 700)
          );
        } catch (stockError) {
          failed.push(
            stockError instanceof Error
              ? stockError.message
              : `${symbol} unavailable`
          );
        }
      }

      setStocks(successful);

      const verifiedCount =
        successful.filter(
          (stock) =>
            stock.mode === "verified"
        ).length;

      const researchCount =
        successful.filter(
          (stock) =>
            stock.mode === "research"
        ).length;

      if (successful.length === 0) {
        setError(
          failed[0] ||
          "No stock information could be loaded."
        );
      } else if (
        researchCount > 0
      ) {
        setError(
          `${verifiedCount} of ${symbols.length} stocks have verified provider quotes. ${researchCount} stock(s) are in AI Research Mode because a live quote could not be verified.`
        );
      } else if (
        failed.length > 0
      ) {
        setError(
          `${successful.length} of ${symbols.length} stocks loaded. Some requests are temporarily unavailable.`
        );
      }
    } catch (loadError) {
      setStocks([]);

      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load stock information."
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

  const filtered =
    stocks.filter(
      (stock) =>
        (stock.symbol || "")
          .toLowerCase()
          .includes(
            query.toLowerCase()
          )
    );

  const verifiedCount =
    stocks.filter(
      (stock) =>
        stock.mode === "verified"
    ).length;

  const researchCount =
    stocks.filter(
      (stock) =>
        stock.mode === "research"
    ).length;

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
            MarketLens uses verified provider
            quotes when available and clearly
            labels AI research when a live quote
            cannot be verified.
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
            ◉ Verified quotes when available ·
            AI never invents a market price
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
                Verified quotes
              </b>

              <span className="muted">
                Provider-backed
              </span>
            </div>

            <div className="orb-card card-b">
              <small>
                AI RESEARCH
              </small>

              <b>
                Clear fallback
              </b>

              <span className="muted">
                No invented prices
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
                Verify
              </h3>

              <p>
                Request quotes from configured
                market-data providers.
              </p>
            </div>

            <div>
              <span className="feature-num">
                02
              </span>

              <h3>
                Fallback
              </h3>

              <p>
                Try another provider if the first
                one cannot return a usable quote.
              </p>
            </div>

            <div>
              <span className="feature-num">
                03
              </span>

              <h3>
                Research
              </h3>

              <p>
                Use AI research only when live
                market data cannot be verified.
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
                DATA + RESEARCH
              </div>

              <h1>
                Market dashboard.
              </h1>

              <p>
                Verified quotes are clearly
                separated from AI research mode.
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
                setQuery(
                  event.target.value
                )
              }
              placeholder="Search loaded symbols..."
            />
          </div>
  {error && (
            <div className="api-error">
              <b>
                {researchCount > 0
                  ? "Mixed data mode"
                  : stocks.length > 0
                  ? "Partial market data"
                  : "Information unavailable"}
              </b>

              <span>
                {error}
              </span>

              <small>
                AI Research Mode is not a live
                market quote and does not generate
                prices or other unverified
                time-sensitive values.
              </small>
            </div>
          )}

          {loading && (
            <div className="loading">
              Loading provider data and research
              fallback…
            </div>
          )}

          {!loading &&
            stocks.length > 0 && (
              <>
                <div className="data-banner">
                  ● VERIFIED QUOTES:{" "}
                  {verifiedCount} · AI RESEARCH:{" "}
                  {researchCount}
                </div>

                <div className="content-grid">
                  <section className="panel">
                    <div className="panel-head">
                      <div>
                        <h2>
                          Stock information
                        </h2>

                        <p>
                          Verified quotes are
                          distinguished from
                          research-only results.
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
                                {stock.mode ===
                                "verified"
                                  ? `Verified quote: ${stock.source}`
                                  : "AI Research Mode · live quote unavailable"}
                              </small>
                            </div>

                            <div className="stock-price">
                              <b>
                                {stock.mode ===
                                "verified"
                                  ? money(
                                      stock.price
                                    )
                                  : "Research"}
                              </b>

                              <span
                                className={
                                  stock.mode ===
                                  "verified"
                                    ? Number(
                                        stock.changePercent
                                      ) >= 0
                                      ? "up"
                                      : "down"
                                    : ""
                                }
                              >
                                {stock.mode ===
                                "verified"
                                  ? pct(
                                      stock.changePercent
                                    )
                                  : "No price generated"}
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
                          Know what type of
                          information you are seeing.
                        </p>
                      </div>
                    </div>

                    <div className="quality">
                      <span className="quality-dot" />

                      <b>
                        {verifiedCount > 0
                          ? "Provider data received"
                          : "Research fallback active"}
                      </b>
                    </div>

                    <div className="quality-line">
                      <span>
                        Verified quotes
                      </span>

                      <b>
                        {verifiedCount}
                      </b>
                    </div>

                    <div className="quality-line">
                      <span>
                        Research fallback
                      </span>

                      <b>
                        {researchCount}
                      </b>
                    </div>

                    <div className="quality-line">
                      <span>
                        Total loaded
                      </span>

                      <b>
                        {stocks.length}
                      </b>
                    </div>

                    <div className="tip">
                      <b>
                        Important
                      </b>

                      <p>
                        Research mode is useful for
                        understanding a company, but
                        a current price must come
                        from a verified market-data
                        source.
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
                No information could be loaded.
              </div>
            )}

          <div className="disclaimer">
            MarketLens is a research and education
            tool. AI research is not a verified
            live quote and is not personalized
            investment advice.
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

            {selected.mode ===
            "verified" ? (
              <>
                <div className="eyebrow">
                  VERIFIED QUOTE ·{" "}
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
                    Verified provider data
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
                        {selected.volume !=
                        null
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
                    Source:{" "}
                    {selected.source}
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="eyebrow">
                  AI RESEARCH MODE ·{" "}
                  {selected.symbol}
                </div>

                <h2>
                  {selected.symbol}
                </h2>

                <div className="modal-price">
                  Live quote unavailable
                </div>

                <div className="report">
                  <b>
                    {selected.research
                      ?.company ||
                      "Research fallback"}
                  </b>

                  <p>
                    {selected.research
                      ?.summary ||
                      "No research summary was returned."}
                  </p>

                  <div className="metrics">
                    <span>
                      <small>
                        Business
                      </small>

                      <b>
                        {selected.research
                          ?.business ||
                          "Not available"}
                      </b>
                    </span>
                  </div>

                  <p>
                    <b>
                      Strengths to research:
                    </b>
                  </p>

                  <p>
                    {Array.isArray(
                      selected.research
                        ?.strengths
                    )
                      ? selected.research.strengths.join(
                          " • "
                        )
                      : "Not available"}
                  </p>

                  <p>
                    <b>
                      Risks to research:
                    </b>
                  </p>

                  <p>
                    {Array.isArray(
                      selected.research
                        ?.risks
                    )
                      ? selected.research.risks.join(
                          " • "
                        )
                      : "Not available"}
                  </p>

                  <p>
                    <b>
                      What to monitor:
                    </b>
                  </p>

                  <p>
                    {Array.isArray(
                      selected.research
                        ?.whatToMonitor
                    )
                      ? selected.research.whatToMonitor.join(
                          " • "
                        )
                      : "Not available"}
                  </p>

                  <p>
                    <small>
                      {selected.research
                        ?.researchStatus ||
                        "Research fallback — live quote unavailable and no market price has been generated."}
                    </small>
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(
  document.getElementById("root")
).render(<App />);