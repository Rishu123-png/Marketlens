import { z } from "zod";
import {
  assetTypeSchema,
  currencySchema,
  exchangeSchema,
  finiteNumberSchema,
  instrumentIdSchema,
  isoTimestampSchema,
  nullableNumberSchema,
  symbolSchema
} from "./primitives.js";

export const QUOTE_FRESHNESS = ["verified", "unknown"];

/**
 * One normalized quote. Every provider adapter produces exactly this shape.
 * `price: null" is only acceptable when `quoteVerified` is false — a verified
 * quote without a price is a contract violation.
 */
export const quoteSchema = z
  .object({
    mode: z.literal("verified"),
    quoteVerified: z.boolean(),

    instrumentId: instrumentIdSchema,
    symbol: symbolSchema,
    displaySymbol: symbolSchema,
    name: z.string().min(1).max(160).nullable().optional(),
    exchange: exchangeSchema,
    country: z.string().regex(/^[A-Z]{2}$/).nullable().optional(),
    currency: currencySchema.nullable().optional(),
    assetType: assetTypeSchema,

    price: nullableNumberSchema,
    change: nullableNumberSchema.optional(),
    changePercent: nullableNumberSchema.optional(),
    open: nullableNumberSchema.optional(),
    previousClose: nullableNumberSchema.optional(),
    dayHigh: nullableNumberSchema.optional(),
    dayLow: nullableNumberSchema.optional(),
    volume: nullableNumberSchema.optional(),

    source: z.string().min(1).max(80),
    provider: z.string().min(1).max(40),

    updatedAt: isoTimestampSchema,
    retrievedAt: isoTimestampSchema.optional(),
    providerTimestamp: isoTimestampSchema.nullable().optional(),
    freshness: z.enum(QUOTE_FRESHNESS)
  })
  .superRefine((quote, context) => {
    if (quote.quoteVerified && quote.price === null) {
      context.addIssue({
        code: "custom",
        path: ["price"],
        message: "A verified quote must carry a price"
      });
    }
    if (Number.isFinite(quote.dayHigh) && Number.isFinite(quote.dayLow) && quote.dayHigh < quote.dayLow) {
      context.addIssue({ code: "custom", path: ["dayHigh"], message: "dayHigh cannot be below dayLow" });
    }
  });
