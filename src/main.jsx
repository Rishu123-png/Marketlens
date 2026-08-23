import React, {
  useState
} from "react";

import {
  createRoot
} from "react-dom/client";

import "./styles.css";

const money = (value) => {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "Not verified";
  }

  return `₹${Number(value).toLocaleString(
    "en-IN",
    {
      maximumFractionDigits: 2
    }
  )}`;
};

const pct = (value) => {
  if (
    value === null ||
    value === undefined ||
    value === ""
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

  const [
    searchResults,
    setSearchResults
  ] = useState([]);

  const [
    selected,
    setSelected
  ] = useState(null);

  const [
    quoteLoading,
    setQuoteLoading
  ] = useState(false);

  const [
    searching,
    setSearching
  ] = useState(false);

  const [error, setError] =
    useState("");

  const [
    analysis,
    setAnalysis
  ] = useState(null);

  const [
    analyzing,
    setAnalyzing
  ] = useState(false);

  const [
    analysisError,
    setAnalysisError
  ] = useState("");

  async function searchStocks(
    event
  ) {
    event?.preventDefault();

    const value =
      query.trim();

    if (value.length < 2) {
      setError(
        "Enter at least two characters to search."
      );
      return;
    }

    setSearching(true);
    setError("");
    setSearchResults([]);
    setSelected(null);
    setAnalysis(null);
    setAnalysisError("");

    try {
      const response =
        await fetch(
          `/api/search?q=${encodeURIComponent(
            value
          )}`
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
          "Stock search failed."
        );
      }

      setSearchResults(
        Array.isArray(
          data.results
        )
          ? data.results
          : []
      );

      if (
        !Array.isArray(
          data.results
        ) ||
        data.results.length === 0
      ) {
        setError(
          "No matching stock was returned by the configured providers."
        );
      }
    } catch (searchError) {
      setError(
        searchError instanceof Error
          ? searchError.message
          : "Unable to search stocks."
      );
    } finally {
      setSearching(false);
    }
  }

  async function selectStock(
    stock
  ) {
    setSelected({
      ...stock,
      loading: true
    });

    setQuoteLoading(true);
    setError("");
    setAnalysis(null);
    setAnalysisError("");

    try {
      const response =
        await fetch(
          `/api/market?symbol=${encodeURIComponent(
            stock.symbol
          )}&exchange=${encodeURIComponent(
            stock.exchange || ""
          )}`
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
          "No verified market quote is available."
        );
      }

      if (
        data.quoteVerified !== true ||
        data.price === null ||
        data.price === undefined
      ) {
        throw new Error(
          "MarketLens did not receive a verified price, so AI analysis has been blocked."
        );
      }

      setSelected({
        ...stock,
        ...data,
        mode: "verified",
        loading: false
      });
    } catch (quoteError) {
      setSelected(null);

      setError(
        quoteError instanceof Error
          ? quoteError.message
          : "Unable to load a verified market quote."
      );
    } finally {
      setQuoteLoading(false);
    }
  }

  async function analyzeStock() {
    if (
      !selected ||
      selected.mode !== "verified" ||
      selected.quoteVerified !== true ||
      selected.price === null ||
      selected.price === undefined
    ) {
      setAnalysisError(
        "A verified provider quote is required before AI analysis."
      );
      return;
    }

    setAnalyzing(true);
    setAnalysis(null);
    setAnalysisError("");

    try {
      const response =
        await fetch(
          "/api/report",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify({
              stock: {
                symbol:
                  selected.symbol,
                name:
                  selected.name ||
                  selected.symbol,
                exchange:
                  selected.exchange ||
                  ""
              },
              metrics: {
                source:
                  selected.source,
                updatedAt:
                  selected.updatedAt,
                price:
                  selected.price,
                change:
                  selected.change,
                changePercent:
                  selected.changePercent,
                open:
                  selected.open,
                previousClose:
                  selected.previousClose,
                dayHigh:
                  selected.dayHigh,
                dayLow:
                  selected.dayLow,
                volume:
                  selected.volume
              }
            })
          }
        );
const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
          "AI analysis failed."
        );
      }

      setAnalysis(
        data.report
      );
    } catch (reportError) {
      setAnalysisError(
        reportError instanceof Error
          ? reportError.message
          : "Unable to generate AI analysis."
      );
    } finally {
      setAnalyzing(false);
    }
  }

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
            INDIAN MARKETS · VERIFIED DATA
          </div>

          <h1>
            See the market
            <br />

            <em>
              with clarity.
            </em>
          </h1>

          <p className="hero-copy">
            Search available stocks, load
            provider-backed market data, and use AI
            to explain verified metrics without
            inventing a live price.
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
            ◉ Search on demand · verified quote
            first · AI never invents a market price
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
                Search any stock
              </b>

              <span className="muted">
                On-demand lookup
              </span>
            </div>

            <div className="orb-card card-b">
              <small>
                AI ANALYSIS
              </small>

              <b>
                Explain verified data
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
                Search
              </h3>

              <p>
                Search configured providers for the
                stock you actually want to analyze.
              </p>
            </div>

            <div>
              <span className="feature-num">
                02
              </span>

              <h3>
                Verify
              </h3>

              <p>
                Load a provider-backed quote before
                any AI analysis is allowed.
              </p>
            </div>

            <div>
              <span className="feature-num">
                03
              </span>

              <h3>
                Analyze
              </h3>

              <p>
                Groq explains supplied verified
                metrics and does not create a new
                market price.
              </p>
            </div>
          </section>
        </main>
      ) : (
        <main className="dashboard">
          <div className="dash-top">
            <div>
              <div className="eyebrow">
                MARKET SEARCH
                <span className="live-dot" />
                VERIFIED DATA FIRST
              </div>

              <h1>
                Market dashboard.
              </h1>

              <p>
                Search a stock, load a verified
                quote, then analyze that quote with
                AI.
              </p>
            </div>
          </div>

          <form
            className="search-wrap"
            onSubmit={searchStocks}
          >
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
              placeholder="Search symbol or company name, for example TCS or SBIN..."
            />

            <button
              className="refresh"
              type="submit"
              disabled={searching}
            >
              {searching
                ? "Searching..."
                : "Search"}
            </button>
          </form>

          {error && (
            <div className="api-error">
              <b>
                Information unavailable
              </b>

              <span>
                {error}
              </span>

              <small>
                If a verified quote cannot be
                loaded, MarketLens does not use AI
                to invent a replacement market
                price.
              </small>
            </div>
          )}

          {searching && (
            <div className="loading">
              Searching configured market-data
              providers…
            </div>
          )}

          {quoteLoading && (
            <div className="loading">
              Loading verified provider quote…
            </div>
          )}

          {!searching &&
            searchResults.length > 0 && (
              <>
                <div className="data-banner">
                  ● SEARCH RESULTS · SELECT A STOCK
                  TO LOAD VERIFIED MARKET DATA
                </div>

                <div className="content-grid">
                  <section className="panel">
                    <div className="panel-head">
                      <div>
                        <h2>
                          Stock search results
                        </h2>

                        <p>
                          Select a result to request
                          its real provider-backed
                          quote.
                        </p>
                      </div>
                    </div>

                    <div className="stock-list">
                      {searchResults.map(
                        (stock) => (
                          <button
                            className="stock-row"
                            onClick={() =>
                              selectStock(stock)
                            }
                            key={
                              `${stock.symbol}-${stock.exchange}`
                            }
                          >
                            <div className="stock-icon">
                              {stock.symbol
                                .slice(0, 2)}
                            </div>

                            <div className="stock-name">
                              <b>
                                {stock.symbol}
                              </b>

                              <small>
                                {stock.name ||
                                  stock.symbol}
                              </small>

                              <small>
                                {stock.exchange ||
                                  "Exchange not supplied"}
                              </small>
                            </div>

                            <div className="stock-price">
                              <b>
                                Load quote
                              </b>

                              <span>
                                Verified data
                              </span>
                            </div>

                            <span className="arrow">
                              →
                            </span>
                          </button>
                        )
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
                          AI analysis starts only
                          after a verified quote is
                          received.
                        </p>
                      </div>
                    </div>

                    <div className="quality">
                      <span className="quality-dot" />

                      <b>
                        On-demand provider lookup
                      </b>
                    </div>

                    <div className="quality-line">
                      <span>
                        Search results
                      </span>

                      <b>
                        {searchResults.length}
                      </b>
                    </div>

                    <div className="quality-line">
                      <span>
                        Selected quote
                      </span>

                      <b>
                        {selected &&
                        selected.mode ===
                          "verified"
                          ? "Verified"
                          : "Not loaded"}
                      </b>
                    </div>

                    <div className="quality-line">
                      <span>
                        AI role
                      </span>

                      <b>
                        Explain only
                      </b>
                    </div>

                    <div className="tip">
                      <b>
                        Important
                      </b>
    <div className="tip">
                      <b>
                        Important
                      </b>

                      <p>
                        Groq does not act as a
                        market-price provider. It
                        only interprets the verified
                        metrics sent by MarketLens.
                      </p>
                    </div>
                  </aside>
                </div>
              </>
            )}

          {!searching &&
            !quoteLoading &&
            searchResults.length === 0 &&
            !error && (
              <div className="empty">
                Search for a stock to begin.
              </div>
            )}

          <div className="disclaimer">
            MarketLens is a research and education
            tool. AI analysis interprets verified
            market metrics and is not personalized
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
          onClick={() => {
            if (
              !quoteLoading &&
              !analyzing
            ) {
              setSelected(null);
              setAnalysis(null);
              setAnalysisError("");
            }
          }}
        >
          <div
            className="modal"
            onClick={(event) =>
              event.stopPropagation()
            }
          >
            <button
              className="close"
              onClick={() => {
                if (
                  !quoteLoading &&
                  !analyzing
                ) {
                  setSelected(null);
                  setAnalysis(null);
                  setAnalysisError("");
                }
              }}
            >
              ×
            </button>

            {selected.loading ||
            quoteLoading ? (
              <div className="loading">
                Loading verified market quote…
              </div>
            ) : selected.mode ===
            "verified" ? (
              <>
                <div className="eyebrow">
                  VERIFIED QUOTE ·{" "}
                  {selected.symbol}
                </div>

                <h2>
                  {selected.name ||
                    selected.symbol}
                </h2>

                <div className="modal-price">
                  {money(
                    selected.price
                  )}

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
                        Day low
                      </small>

                      <b>
                        {money(
                          selected.dayLow
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
                    {selected.source ||
                      "Verified provider"}
                  </p>

                  <p>
                    Updated:{" "}
                    {selected.updatedAt
                      ? new Date(
                          selected.updatedAt
                        ).toLocaleString()
                      : "Time not supplied"}
                  </p>
                </div>

                <button
                  className="primary"
                  onClick={
                    analyzeStock
                  }
                  disabled={
                    analyzing
                  }
                  style={{
                    marginTop: "18px"
                  }}
                >
                  {analyzing
                    ? "Analyzing verified data..."
                    : "Analyze stock with AI"}

                  <span>
                    →
                  </span>
                </button>

                {analysisError && (
                  <div className="api-error">
                    <b>
                      AI analysis unavailable
                    </b>

                    <span>
                      {analysisError}
                    </span>
                  </div>
                )}

                {analysis && (
                  <div
                    className="report"
                    style={{
                      marginTop: "20px"
                    }}
                  >
                    <div className="eyebrow">
                      GROQ ANALYSIS · VERIFIED
                      METRICS ONLY
                    </div>

                    <h3>
                      {analysis.headline ||
                        "Market analysis"}
                    </h3>

                    <b>
                      Summary
                    </b>

                    <p>
                      {analysis.summary ||
                        "No summary returned."}
                    </p>

                    <b>
                      Market read
                    </b>

                    <p>
                      {analysis.marketRead ||
                        "No market read returned."}
                    </p>

                    <b>
                      Positive observations
                    </b>

                    <p>
                      {Array.isArray(
                        analysis.strengths
                      )
                        ? analysis.strengths.join(
                            " • "
                          )
                        : "Not available"}
                    </p>

                    <b>
                      Risks and uncertainty
                    </b>

                    <p>
                      {Array.isArray(
                        analysis.risks
                      )
                        ? analysis.risks.join(
                            " • "
                          )
                        : "Not available"}
                    </p>

                    <b>
                      What to monitor
                    </b>

                    <p>
                      {Array.isArray(
                        analysis.whatToMonitor
                      )
                        ? analysis.whatToMonitor.join(
                            " • "
                          )
                        : "Not available"}
                    </p>

                    <b>
                      Analysis limitations
                    </b>

                    <p>
                      {analysis.limitations ||
                        "The supplied verified quote alone does not contain every fundamental, technical or news input needed for a complete investment analysis."}
                    </p>

                    <div className="tip">
                      <b>
                        Data integrity
                      </b>

                      <p>
                        {analysis.dataIntegrity ||
                          "This AI analysis is based on the provider-backed metrics supplied by MarketLens. AI did not generate a new market price."}
                      </p>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="empty">
                No verified quote is available for
                this selection.
              </div>
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