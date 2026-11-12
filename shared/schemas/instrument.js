import { z } from "zod";
import {
  assetTypeSchema,
  countrySchema,
  currencySchema,
  exchangeSchema,
  instrumentIdSchema,
  finiteNumberSchema,
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
  sessionCalendar: z.string().min(1).max(64).nullable().optional(),
  // Derivative identity. A template has no pinned expiry/strike; a live
  // contract may supply them. No derivative is ever priced without a provider
  // that explicitly supports it.
  underlyingId: instrumentIdSchema.nullable().optional(),
  contractTemplate: z.boolean().optional(),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  strike: finiteNumberSchema.nullable().optional(),
  optionType: z.enum(["CE", "PE"]).nullable().optional(),
  lotSize: z.number().int().positive().nullable().optional(),
  lotSizeStatus: z.enum(["verified", "reported", "unverified"]).optional(),
  lotSizeEffectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  lotSizeSource: z.string().min(1).max(500).nullable().optional()
});

export const instrumentListSchema = z.object({
  total: z.number().int().min(0),
  count: z.number().int().min(0),
  offset: z.number().int().min(0),
  limit: z.number().int().min(1).max(200),
  instruments: z.array(instrumentSchema)
});
