import DataStatus from "./DataStatus.jsx";
import PriceChange from "./PriceChange.jsx";
import { formatMoney, formatTime } from "../../lib/api.js";
import { instrumentMonogram, quoteState } from "../../lib/marketVisuals.js";

export default function InstrumentHeader({ instrument, quote, quoteError, state, actions, compact = false }) {
  const dataState = state || quoteState(quote);
  const symbol = instrument?.symbol?.replace(/^\^/, "") || "—";
  const usable = Boolean(quote) && dataState.code !== "unavailable";
  const provenance = usable
    ? `${quote.source || quote.provider || "Provider"} · quote ${formatTime(quote.providerTimestamp)} · retrieved ${formatTime(quote.retrievedAt)}`
    : quoteError || "No provider-verified price";
  return (
    <div className={`instrument-header ${compact ? "is-compact" : ""}`.trim()}>
      <div className="instrument-identity">
        <span className="instrument-monogram">{instrumentMonogram(symbol)}</span>
        <div>
          <div className="instrument-symbol-row">
            <strong>{symbol}</strong>
            <span className="venue-tag">{instrument?.exchange || "—"}</span>
            {instrument?.assetType && <span className="venue-tag muted">{instrument.assetType}</span>}
          </div>
          <p>{instrument?.name || "Instrument identity unavailable"}</p>
        </div>
      </div>
      <div className="instrument-quote">
        <strong className={usable ? "" : "is-empty"}>{usable ? formatMoney(quote.price, quote.currency) : "—"}</strong>
        {usable ? <PriceChange value={quote.changePercent} percent /> : null}
        <DataStatus state={dataState} />
        <small title={provenance}>{provenance}</small>
      </div>
      {actions && <div className="instrument-actions">{actions}</div>}
    </div>
  );
}
