import { z } from "zod";
import { finiteNumberSchema, nullableNumberSchema } from "./primitives.js";

/**
 * Normalized OHLCV candle.
 *
 * `adjusted` is optional here because the current candle provider path does not
 * report it; persistence (M3) must require an explicit value, since mixing
 * adjusted and unadjusted history silently corrupts indicators.
 */
export const candleSchema = z
  .object({
    time: z.string().min(1).max(40),
    open: finiteNumberSchema,
    high: finiteNumberSchema,
    low: finiteNumberSchema,
    close: finiteNumberSchema,
    volume: nullableNumberSchema,
    source: z.string().min(1).max(80),
    adjusted: z.boolean().nullable().optional()
  })
  .superRefine((candle, context) => {
    const high = candle.high;
    const low = candle.low;

    if (high < low) {
      context.addIssue({ code: "custom", path: ["high"], message: "high cannot be below low" });
    }
    for (const side of ["open", "close"]) {
      if (candle[side] > high || candle[side] < low) {
        context.addIssue({
          code: "custom",
          path: [side],
          message: `${side} must lie within the day's high/low range`
        });
      }
    }
  });

export const candleSeriesSchema = z.object({
  symbol: z.string().min(1),
  interval: z.string().min(1),
  source: z.string().min(1),
  candles: z.array(candleSchema).min(1)
});
