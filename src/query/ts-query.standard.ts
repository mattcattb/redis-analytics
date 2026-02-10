import {
  TimeSeriesService,
  type TSAggregation,
} from "../redis/timeseries.service";
import type { AnalyticBucket, Bucket, DateRange, Timeframe } from "../types";

import { BUCKET_MS, resolveRange, timestampToUtc } from "../time";

const FOREVER_MS = 3153600000000;

type TSQueryResult<T extends TSQueryDef> = {
  [K in keyof T]: number;
};

type TSBucketResult<T extends TSQueryDef> = {
  [K in keyof T]: AnalyticBucket[];
};

export type TSMetricDef = {
  key: string;
  agg: TSAggregation;
};

export type TSQueryDef = Record<string, TSMetricDef>;

export function ts(key: string, agg: TSAggregation): TSMetricDef {
  return { key, agg };
}

async function executeTS(
  def: TSMetricDef,
  scope: { kind: "lifetime" } | { kind: "range"; range: DateRange }
): Promise<number> {
  const { key, agg } = def;

  if (scope.kind === "lifetime") {
    const samples = await TimeSeriesService.range(key, "-", "+", FOREVER_MS, agg);
    return samples[0]?.value ?? 0;
  }

  const start = scope.range.start.getTime();
  const end = scope.range.end.getTime();
  const samples = await TimeSeriesService.range(key, start, end - 1, FOREVER_MS, agg);

  return samples[0]?.value ?? 0;
}

async function executeTSBuckets(
  def: TSMetricDef,
  scope:
    | { kind: "lifetime"; bucket: Bucket }
    | { kind: "range"; range: DateRange; bucket: Bucket }
): Promise<AnalyticBucket[]> {
  const { key, agg } = def;
  const bucketMs = BUCKET_MS[scope.bucket];

  if (scope.kind === "lifetime") {
    const samples = await TimeSeriesService.range(key, "-", "+", bucketMs, agg, {
      empty: true,
    });

    return samples.map((s) => [timestampToUtc(s.timestamp), s.value]);
  }

  const start = scope.range.start.getTime();
  const end = scope.range.end.getTime();

  const samples = await TimeSeriesService.range(key, start, end - 1, bucketMs, agg, {
    empty: true,
  });

  return samples.map((s) => [timestampToUtc(s.timestamp), s.value]);
}

export function tsQuery<T extends TSQueryDef>(def: T) {
  return {
    async lifetime(): Promise<TSQueryResult<T>> {
      const entries = Object.entries(def);
      const results = await Promise.all(
        entries.map(async ([name, metric]) => {
          const value = await executeTS(metric as TSMetricDef, { kind: "lifetime" });
          return [name, value] as const;
        })
      );

      return Object.fromEntries(results) as TSQueryResult<T>;
    },

    async range(range: DateRange): Promise<TSQueryResult<T>> {
      const entries = Object.entries(def);

      const results = await Promise.all(
        entries.map(async ([name, metric]) => {
          const value = await executeTS(metric as TSMetricDef, { kind: "range", range });
          return [name, value] as const;
        })
      );

      return Object.fromEntries(results) as TSQueryResult<T>;
    },

    async timeframe(tf: Timeframe): Promise<TSQueryResult<T>> {
      if (tf === "lifetime") return this.lifetime();
      return this.range(resolveRange(tf));
    },

    async buckets(range: DateRange, bucket: Bucket = "d"): Promise<TSBucketResult<T>> {
      const entries = Object.entries(def);

      const results = await Promise.all(
        entries.map(async ([name, metric]) => {
          const value = await executeTSBuckets(metric as TSMetricDef, {
            kind: "range",
            range,
            bucket,
          });

          return [name, value] as const;
        })
      );

      return Object.fromEntries(results) as TSBucketResult<T>;
    },

    async lifetimeBuckets(bucket: Bucket = "m"): Promise<TSBucketResult<T>> {
      const entries = Object.entries(def);

      const results = await Promise.all(
        entries.map(async ([name, metric]) => {
          const value = await executeTSBuckets(metric as TSMetricDef, {
            kind: "lifetime",
            bucket,
          });

          return [name, value] as const;
        })
      );

      return Object.fromEntries(results) as TSBucketResult<T>;
    },

    async bucketsByTimeframe(
      tf: Timeframe,
      bucket: Bucket = "d"
    ): Promise<TSBucketResult<T>> {
      if (tf === "lifetime") return this.lifetimeBuckets(bucket);
      return this.buckets(resolveRange(tf), bucket);
    },
  };
}
