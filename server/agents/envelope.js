/**
 * Evidence envelope construction.
 *
 * One deterministic object is handed to every agent. It contains only facts
 * produced by this codebase: the normalized quote, calculated indicators,
 * geometric chart structure, validated news evidence and data-quality facts.
 * No agent ever queries a provider directly.
 */

export const ENVELOPE_VERSION = "1.0.0";

const RECENT_CANDLE_COUNT = 30;
const MAX_EVIDENCE = 20;

function compactCandle(candle) {
  return {
    t: candle.time,
    o: candle.open,
    h: candle.high,
    l: candle.low,
    c: candle.close,
    v: candle.volume
  };
}

function compactIndicators(snapshot) {
  return {
    candles: snapshot.candles,
    lastClose: snapshot.lastClose,
    movingAverages: snapshot.movingAverages,
    rsi: snapshot.rsi,
    macd: snapshot.macd,
    atr: snapshot.atr,
    bollinger: snapshot.bollinger,
    relativeVolume: snapshot.relativeVolume,
    volumeBaseline: snapshot.volumeBaseline
  };
}

function compactChart(chart) {
  return {
    engineVersion: chart.engineVersion,
    candles: chart.candles,
    lastClose: chart.lastClose,
    trend: chart.trend,
    supportResistance: chart.supportResistance,
    candlestickPatterns: chart.candlestickPatterns,
    chartPatterns: chart.chartPatterns,
    limitations: chart.limitations
  };
}

function compactEvidence(items) {
  return (items || []).slice(0, MAX_EVIDENCE).map((item) => ({
    evidenceId: item.id ?? item.evidenceId,
    sourceType: item.sourceType,
    publisher: item.publisher,
    url: item.url,
    publishedAt: item.publishedAt,
    retrievedAt: item.retrievedAt,
    excerpt: item.excerpt,
    verification: item.verification,
    duplicateCount: item.duplicateCount ?? 1,
    injectionSignals: item.metadata?.injectionSignals ?? []
  }));
}

export function buildEvidenceEnvelope({
  instrument,
  depth,
  quote = null,
  crossQuotes = [],
  candles = null,
  indicators = null,
  chart = null,
  evidence = null,
  quality = {},
  generatedAt = new Date().toISOString()
} = {}) {
  const items = evidence?.items || [];

  return {
    envelopeVersion: ENVELOPE_VERSION,
    generatedAt,
    depth,
    instrument: {
      instrumentId: instrument?.id ?? null,
      symbol: instrument?.symbol ?? null,
      name: instrument?.name ?? null,
      exchange: instrument?.exchange ?? null,
      country: instrument?.country ?? null,
      currency: instrument?.currency ?? null,
      assetType: instrument?.assetType ?? null,
      sector: instrument?.sector ?? null
    },
    marketContext: {
      quote: quote
        ? {
            price: quote.price,
            change: quote.change,
            changePercent: quote.changePercent,
            currency: quote.currency,
            provider: quote.provider,
            providerTimestamp: quote.timestamp,
            retrievedAt: quote.retrievedAt
          }
        : null,
      crossQuotes: (crossQuotes || []).map((entry) => ({ provider: entry.provider, price: entry.price })),
      candles: candles
        ? {
            interval: candles.interval,
            count: candles.candles?.length ?? 0,
            coverage: candles.coverage,
            droppedRows: candles.droppedRows,
            source: candles.source
          }
        : null,
      recentCandles: (candles?.candles || []).slice(-RECENT_CANDLE_COUNT).map(compactCandle)
    },
    technical: indicators ? compactIndicators(indicators) : null,
    chart: chart ? compactChart(chart) : null,
    evidence: {
      items: compactEvidence(items),
      counts: evidence?.counts ?? { fetched: 0, accepted: 0, returned: 0, rejected: 0 },
      sources: evidence?.sources ?? [],
      limitations: evidence?.limitations ?? []
    },
    quality: {
      dataWarnings: quality.dataWarnings ?? [],
      candleDroppedRows: candles?.droppedRows ?? 0,
      newsRejected: evidence?.counts?.rejected ?? 0,
      quoteFreshness: quality.quoteFreshness ?? null
    }
  };
}

export function evidenceIdsOf(envelope) {
  return (envelope?.evidence?.items || []).map((item) => item.evidenceId);
}
