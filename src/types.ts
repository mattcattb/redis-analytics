export type AnalyticBucket = readonly [Date, number];

export type DateRange = {
  start: Date;
  end: Date;
};

export const BUCKETS = ["h", "d", "m"] as const;
export type Bucket = (typeof BUCKETS)[number];

export const TIMEFRAMES = ["24h", "1w", "1m", "1y", "lifetime"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const TIMEFRAME_TO_DEFAULT_BUCKET: Record<Timeframe, Bucket> = {
  "24h": "h",
  "1w": "d",
  "1m": "d",
  "1y": "m",
  lifetime: "m",
};
