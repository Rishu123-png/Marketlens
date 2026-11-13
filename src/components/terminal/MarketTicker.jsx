import DataStatus from "./DataStatus.jsx";
import PriceChange from "./PriceChange.jsx";
import Sparkline from "./Sparkline.jsx";
import Icon from "./Icon.jsx";
import { formatMoney } from "../../lib/api.js";
import { quoteState, summarizeQuotes } from "../../lib/marketVisuals.js";

const FALLBACK = [
  { id: "IN-IDX-NIFTY50", symbol: "^NSEI", name: "Nifty 50", exchange: "NSE", quote: null },
  { id: "IN-IDX-SENSEX", symbol: "^BSESN", name: "BSE Sensex", exchange: "BSE", quote: null },
  { id: "IN-IDX-NIFTYBANK", symbol: "^NSEBANK", name: "Nifty Bank", exchange: "NSE", quote: null },
  { id: "IN-EQ-TCS", symbol: "TCS", name: "Tata Consultancy Services", exchange: "NSE", quote: null },
  { id: "IN-EQ-HDFCBANK", symbol: "HDFCBANK", name: "HDFC Bank", exchange: "NSE", quote: null },
  { id: "IN-EQ-RELIANCE", symbol: "RELIANCE", name: "Reliance Industries", exchange: "NSE", quote: null }
];

export default function MarketTicker({ overview, onSelect }) {
  const rawLive = overview?.indices || [];
  const preferred = ["IN-IDX-NIFTY50", "IN-IDX-SENSEX", "IN-IDX-NIFTYBANK"];
  const live = preferred
    .map((id) => rawLive.find((entry) => entry.id === id))
    .filter(Boolean)
    .concat(rawLive.filter((entry) => !preferred.includes(entry.id)));
  const movers = [...(overview?.gainers || []), ...(overview?.losers || [])];
  const extra = movers.find((entry) => entry.symbol === "TCS") || movers[0] || null;
  const items = [...live, ...(extra ? [extra] : [])].slice(0, 6);
  const entries = items.length ? items : FALLBACK;
  const summary = summarizeQuotes(rawLive, undefined, { verifiedByContract: true });

  return (
    <div className="ticker-strip" role="region" aria-label="Supported market ticker">
      <div className="ticker-label">
        <Icon name="trend" size={14} />
        <span>MARKET TAPE</span>
      </div>
      <div className="ticker-track">
        {entries.map((entry, index) => {
          const state = quoteState(entry.quote, undefined, { verifiedByContract: true });
          return (
            <button
              key={entry.id || entry.symbol || index}
              type="button"
              className="ticker-cell"
              onClick={() => onSelect?.({ symbol: entry.symbol, exchange: entry.exchange, name: entry.name, id: entry.id })}
              title={`${entry.name || entry.symbol} (${entry.symbol || entry.id || "—"}) · ${state.detail}`}
            >
              <div className="ticker-cell-main">
                <span className="ticker-name">{entry.name || entry.symbol}</span>
                <strong className={state.code !== "unavailable" ? "" : "is-empty"}>{state.code !== "unavailable" ? formatMoney(entry.quote.price, entry.quote.currency) : "—"}</strong>
                {entry.quote && state.code !== "unavailable" ? <PriceChange value={entry.quote.changePercent} percent size="sm" /> : null}
                <DataStatus state={state} compact />
              </div>
              <Sparkline width={62} height={24} points={[]} label={state.detail} />
            </button>
          );
        })}
      </div>
      <div className="ticker-meta">
        <DataStatus state={summary} compact />
        <span>{rawLive.length ? `${summary.count}/${rawLive.length} indices have quotes` : "Provider coverage pending"}</span>
      </div>
    </div>
  );
}
