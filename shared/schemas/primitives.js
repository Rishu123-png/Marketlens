/**
 * Primitive schemas shared by every Market Lens contract.
 *
 * Validation is a trust-boundary concern: provider payloads, agent output and
 * request bodies are all untrusted. These schemas describe internal shapes, so
 * unknown extra keys are tolerated (and stripped) while wrong types and missing
 * required fields are rejected.
 */

import { z } from "zod";

export const SYMBOL_PATTERN = /^\^?[A-Z0-9._:&-]{1,40}$/;
export const INSTRUMENT_ID_PATTERN = /^[A-Z]{2}-[A-Z]{2,6}-[A-Z0-9]+$/;

/**
 * Asset classes the model can represent. Only `ACTIVE_ASSET_TYPES` may be
 * exposed by the API: a class becomes available when an authorised data source
 * and validation exist, not because the schema accepts it.
 */
export const ASSET_TYPES = ["equity", "index", "etf", "bond", "commodity", "fx", "crypto"];
export const ACTIVE_ASSET_TYPES = ["equity", "index", "etf"];

export const symbolSchema = z
  .string()
  .regex(SYMBOL_PATTERN, "Invalid instrument symbol");

export const instrumentIdSchema = z
  .string()
  .regex(INSTRUMENT_ID_PATTERN, "Invalid instrument id");

export const assetTypeSchema = z.enum(ASSET_TYPES);
export const activeAssetTypeSchema = z.enum(ACTIVE_ASSET_TYPES);

export const countrySchema = z.string().regex(/^[A-Z]{2}$/, "Expected a 2-letter country code");
export const currencySchema = z.string().regex(/^[A-Z]{3}$/, "Expected a 3-letter currency code");

/** ISO-8601 timestamp that actually parses. */
export const isoTimestampSchema = z
  .string()
  .refine(
    (value) => /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)),
    "Expected an ISO-8601 timestamp"
  );

export const finiteNumberSchema = z
  .number()
  .refine((value) => Number.isFinite(value), "Expected a finite number");

export const nullableNumberSchema = finiteNumberSchema.nullable();

export const nonNegativeIntegerSchema = z.number().int().min(0);

export const exchangeSchema = z.string().min(1).max(24);

/** Turn a ZodError into `{ path, message }[]` for API `details` payloads. */
export function issueList(error) {
  if (!error?.issues) return [];
  return error.issues.map((issue) => ({
    path: issue.path.join(".") || "(root)",
    message: issue.message
  }));
}

/** Throw a 400-flavoured error with the schema issues attached. */
export function assertValid(schema, value, label = "payload") {
  const result = schema.safeParse(value);
  if (!result.success) {
    const error = new Error(`${label} failed validation.`);
    error.statusCode = 400;
    error.details = issueList(result.error);
    throw error;
  }
  return result.data;
}
