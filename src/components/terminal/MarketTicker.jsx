import { useEffect, useMemo, useRef, useState } from "react";
import DataStatus from "./DataStatus.jsx";
import PriceChange from "./PriceChange.jsx";
import Icon from "./Icon.jsx";
import { formatMoney } from "../../lib/api.js";
import { quoteState, signedPercent } from "../../lib/marketVisuals.js";
import { advanceTicker, selectTickerMovers, TICKER_MOVER_LIMIT } from "../../lib/marketTicker.js";

function useSystemReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
  );

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return undefined;
    const update = () => setReduced(media.matches);
    update();
    if (media.addEventListener) {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    media.addListener?.(update);
    return () => media.removeListener?.(update);
  }, []);

  return reduced;
}

function emptyMessage(overview, loading) {
  if (!overview) return loading ? "Loading verified movers…" : "Market movers unavailable";
  if (!overview.breadth?.verified) return "No verified stock quotes available";
  if (!overview.breadth?.changesAvailable) return "No reported percentage changes for verified stocks";
  return "No gainers or losers among verified stocks";
}

function TapeCell({ entry, direction, duplicate, onSelect }) {
  const state = quoteState(entry.quote, undefined, { verifiedByContract: true });
  const compactState = { ...state, label: state.label.replace(/^VERIFIED (?:· )?/, "") };
  const price = formatMoney(entry.quote.price, entry.quote.currency);
  const detail = `${direction === "up" ? "Gainer" : "Loser"}: ${entry.name || entry.symbol}. ${state.label}. ${state.detail}`;
  const description = `${entry.symbol}, ${price}, ${signedPercent(entry.quote.changePercent)}. ${detail}`;

  return (
    <button
      type="button"
      className={`ticker-cell is-${direction}`}
      tabIndex={duplicate ? -1 : undefined}
      title={`${description} Open in Markets.`}
      // The visual repeat is hidden from assistive technology and never takes
      // keyboard or mouse focus, but remains clickable for pointer users.
      onMouseDown={duplicate ? (event) => event.preventDefault() : undefined}
      onClick={() => onSelect?.({ symbol: entry.symbol, exchange: entry.exchange, name: entry.name, id: entry.id })}
    >
      <span className="ticker-cell-main">
        <span className="ticker-cell-head">
          <strong className="ticker-symbol">{entry.symbol}</strong>
          <DataStatus state={compactState} compact />
        </span>
        <span className="ticker-cell-values">
          <span className="ticker-price">{price}</span>
          <PriceChange value={entry.quote.changePercent} percent size="sm" />
        </span>
      </span>
      <span className="ticker-screen-reader">{detail}</span>
    </button>
  );
}

function TapeSequence({ gainers, losers, onSelect, duplicate = false, sequenceRef }) {
  const groups = [
    { label: "TOP GAINERS", direction: "up", entries: gainers },
    { label: "TOP LOSERS", direction: "down", entries: losers }
  ];

  return (
    <div className="ticker-sequence" ref={sequenceRef} aria-hidden={duplicate ? "true" : undefined}>
      {groups.map((group) => (
        <div className="ticker-group" key={group.direction}>
          <div className={`ticker-group-heading is-${group.direction}`}>
            <Icon name={group.direction} size={14} />
            <span>{group.label}</span>
            <small>{group.entries.length}/{TICKER_MOVER_LIMIT}</small>
          </div>
          {group.entries.length ? group.entries.map((entry, index) => (
            <TapeCell
              key={entry.id || `${entry.symbol}-${index}`}
              entry={entry}
              direction={group.direction}
              duplicate={duplicate}
              onSelect={onSelect}
            />
          )) : <span className="ticker-no-group">No qualifying {group.direction === "up" ? "gainers" : "losers"}</span>}
        </div>
      ))}
    </div>
  );
}

export default function MarketTicker({ overview, loading, reduceMotion = false, onSelect }) {
  const { gainers, losers } = useMemo(() => selectTickerMovers(overview), [overview]);
  const hasMovers = gainers.length + losers.length > 0;
  const systemReducedMotion = useSystemReducedMotion();
  const motionOff = reduceMotion || systemReducedMotion;
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const trackRef = useRef(null);
  const sequenceRef = useRef(null);

  // A refresh can remove the track while it is hovered or focused, in which
  // case browsers need not dispatch a leave/blur event for the removed node.
  useEffect(() => {
    if (!hasMovers) {
      setHovered(false);
      setFocused(false);
    }
  }, [hasMovers]);

  // Native scrolling keeps every original button reachable by keyboard and lets
  // touch users browse manually. One identical, aria-hidden repeat makes the
  // automatic wrap seamless without duplicating the screen-reader/Tab order.
  useEffect(() => {
    const track = trackRef.current;
    const sequence = sequenceRef.current;
    if (!track || !sequence || !hasMovers || motionOff || paused || hovered || focused) return undefined;

    let frame;
    let previousTime;
    let position = track.scrollLeft;
    const scroll = (time) => {
      if (previousTime !== undefined) {
        const width = sequence.getBoundingClientRect().width;
        if (width > 0) {
          position = advanceTicker(position, time - previousTime, width);
          track.scrollLeft = position;
        }
      }
      previousTime = time;
      frame = window.requestAnimationFrame(scroll);
    };
    frame = window.requestAnimationFrame(scroll);
    return () => window.cancelAnimationFrame(frame);
  }, [hasMovers, motionOff, paused, hovered, focused, gainers, losers]);

  const attempted = overview?.breadth?.universeAttempted;
  const scope = Number.isFinite(attempted) && attempted > 0 ? `CURATED ${attempted} STOCKS` : "CURATED STOCKS";
  const scopeDetail = Number.isFinite(attempted) && attempted > 0
    ? `Ranked among verified quotes in a curated universe of ${attempted} Indian stocks, not the whole exchange.`
    : "Ranked among verified quotes in a curated Indian stock universe, not the whole exchange.";

  return (
    <div className="ticker-strip" role="region" aria-label="Curated stock movers market tape, not exchange-wide" aria-describedby="ticker-scope">
      <div className="ticker-label" title={scopeDetail}>
        <span className="ticker-brand"><Icon name="trend" size={14} /> MARKET TAPE</span>
        <span className="ticker-scope" id="ticker-scope">{scope}</span>
      </div>
      {hasMovers ? (
        <div
          className="ticker-track"
          ref={trackRef}
          tabIndex={0}
          role="group"
          aria-label="Top gainers followed by top losers. Scroll horizontally to browse."
          onPointerEnter={(event) => { if (event.pointerType === "mouse") setHovered(true); }}
          onPointerLeave={(event) => { if (event.pointerType === "mouse") setHovered(false); }}
          onTouchStart={() => setPaused(true)}
          onWheel={(event) => { if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) setPaused(true); }}
          onFocus={() => setFocused(true)}
          onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
        >
          <div className={`ticker-run ${motionOff ? "is-static" : ""}`.trim()}>
            <TapeSequence gainers={gainers} losers={losers} onSelect={onSelect} sequenceRef={sequenceRef} />
            {!motionOff && <TapeSequence gainers={gainers} losers={losers} onSelect={onSelect} duplicate />}
          </div>
        </div>
      ) : <div className="ticker-empty" role="status">{emptyMessage(overview, loading)}</div>}
      {hasMovers && (
        <button
          type="button"
          className="ticker-toggle"
          aria-label={motionOff ? "Market tape motion disabled by reduced motion preference" : "Pause market tape"}
          aria-pressed={!motionOff ? paused : undefined}
          disabled={motionOff}
          title={motionOff ? "Reduced motion is enabled. Scroll manually." : paused ? "Resume market tape" : "Pause market tape"}
          onClick={() => setPaused((value) => !value)}
        >
          <Icon name={paused || motionOff ? "play" : "pause"} size={15} />
        </button>
      )}
      <div className="ticker-meta" title={scopeDetail}>
        <span>{overview ? `${overview.breadth?.verified ?? 0}/${attempted ?? 0} STOCKS VERIFIED` : "COVERAGE PENDING"}</span>
        <span>NOT EXCHANGE-WIDE</span>
      </div>
    </div>
  );
}
