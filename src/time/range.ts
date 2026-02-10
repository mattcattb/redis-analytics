import type { DateRange, Timeframe } from "../types";

function subDuration(anchor: Date, timeframe: Exclude<Timeframe, "lifetime">): Date {
  const d = new Date(anchor.getTime());

  switch (timeframe) {
    case "24h":
      return new Date(d.getTime() - 24 * 60 * 60 * 1000);
    case "1w":
      return new Date(d.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "1m":
      d.setUTCMonth(d.getUTCMonth() - 1);
      return d;
    case "1y":
      d.setUTCFullYear(d.getUTCFullYear() - 1);
      return d;
  }
}

export function resolveRange(input: Timeframe | Date, anchorOrEnd?: Date): DateRange {
  if (input instanceof Date) {
    return { start: input, end: anchorOrEnd ?? input };
  }

  if (input === "lifetime") {
    return { start: new Date(0), end: anchorOrEnd ?? new Date() };
  }

  const end = anchorOrEnd ?? new Date();
  return {
    start: subDuration(end, input),
    end,
  };
}
