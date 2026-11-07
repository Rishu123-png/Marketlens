import { STOCK_UNIVERSE } from "../lib/stock-universe.js";

export default function handler(_req, res) {
  return res.status(200).json({
    name: "Popular NSE stocks",
    scope: "A curated list of 20 actively followed Indian large-cap stocks, not the complete NSE/BSE listing.",
    stocks: STOCK_UNIVERSE,
    count: STOCK_UNIVERSE.length
  });
}
