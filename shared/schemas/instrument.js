import { z } from "zod";
import {
  assetTypeSchema,
  countrySchema,
  currencySchema,
  exchangeSchema,
  instrumentIdSchema,
  symbolSchema
} from "./primitives.js";

/**
 * Instrument identity.
 *
 * The internal `id` is the key everything joins on. `providers` holds explicit
 * provider tickers only where they are known; derivation happens in the catalog,
 * never in the schema.
 */
export const instrumentSchema = z.object({
  id: instrumentIdSchema,
  symbol: symbolSchema,
  name: z.string().min(1).max(160),
  exchange: exchangeSchema,
  country: countrySchema,
  currency: currencySchema,
  assetType: assetTypeSchema,
  sector: z.string().min(1).max(80),
  providers: z.record(z.string(), z.string()).nullable().optional(),
  timezone: z.string().min(1).max(64).nullable().optional(),
  sessionCalendar: z.string().min(1).max(64).nullable().optional()
});

export const instrumentListSchema = z.object({
  total: z.number().int().min(0),
  count: z.number().int().min(0),
  offset: z.number().int().min(0),
  limit: z.number().int().min(1).max(200),
  instruments: z.array(instrumentSchema)
});
