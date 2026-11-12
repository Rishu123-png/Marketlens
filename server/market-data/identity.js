/**
 * Quote identity checks.
 *
 * A ticker is not an identity: `TCS` is both Tata Consultancy Services on NSE and
 * The Container Store on NYSE. If a provider silently resolves the wrong listing,
 * the normalized quote would still look structurally valid — a plausible number
 * in the wrong currency. This module rejects those quotes before they can be
 * cached, shown or fed to an agent.
 */

const VENUE_ALIASES = {
  NSE: ["NSE", "NSE INDIA", "XNSE", "NATIONAL STOCK EXCHANGE"],
  BSE: ["BSE", "BSE INDIA", "XBOM", "BOMBAY STOCK EXCHANGE"],
  NASDAQ: ["NASDAQ", "NASDAQGS", "NASDAQ CM", "NASDAQ CAPITAL MARKET", "XNAS"],
  NYSE: ["NYSE", "NYSE ARCA", "ARCA", "XNYS", "NEW YORK STOCK EXCHANGE", "AMEX", "NYSE AMERICAN"],
  INDEX: ["INDEX", "INDICES"]
};

function normalizeVenue(value) {
  const text = String(value || "").trim().toUpperCase();
  if (!text) return null;
  for (const [canonical, aliases] of Object.entries(VENUE_ALIASES)) {
    if (aliases.some((alias) => text === alias || text.includes(alias))) return canonical;
  }
  return null;
}

export function expectedVenues(instrument) {
  if (!instrument) return [];
  return [...new Set((VENUE_ALIASES[instrument.exchange] || []).map((alias) => normalizeVenue(alias)).filter(Boolean))];
}

/**
 * @returns {{ok:boolean, reason:string|null, checks:object}}
 */
export function validateQuoteIdentity(instrument, quote) {
  const checks = {
    providerSymbol: quote?.providerSymbol ?? null,
    providerExchange: quote?.providerExchange ?? null,
    providerCurrency: quote?.providerCurrency ?? null,
    instrumentCurrency: instrument?.currency ?? null,
    instrumentExchange: instrument?.exchange ?? null
  };

  const providerCurrency = String(checks.providerCurrency || "").trim().toUpperCase();
  if (providerCurrency && checks.instrumentCurrency && providerCurrency !== String(checks.instrumentCurrency).toUpperCase()) {
    return {
      ok: false,
      reason: `Provider quoted ${providerCurrency} for an instrument denominated in ${checks.instrumentCurrency}; refusing a cross-currency price.`,
      checks
    };
  }

  // Index tickers are provider-specific and frequently carry a synthetic venue,
  // so exchange identity is only enforced for listed instruments.
  if (instrument?.assetType !== "index") {
    const providerVenue = normalizeVenue(checks.providerExchange);
    const expected = expectedVenues(instrument);
    if (providerVenue && expected.length && !expected.includes(providerVenue)) {
      return {
        ok: false,
        reason: `Provider returned an instrument on ${checks.providerExchange}, but ${instrument.symbol} is listed on ${instrument.exchange}; refusing a possible cross-listing.`,
        checks
      };
    }
  }

  return { ok: true, reason: null, checks };
}
