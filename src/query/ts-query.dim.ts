import type {
  TSAggregation,
  TSFilter,
  TSMRangeResult,
} from "../redis/timeseries.service";
import {
  FOREVER_MS,
  TimeSeriesService,
} from "../redis/timeseries.service";
import type { AnalyticBucket, Bucket, DateRange, Timeframe } from "../types";
import { BUCKET_MS, resolveRange, timestampToUtc } from "../time";

function extractValue(results: TSMRangeResult): number {
  if (results.length === 0) return 0;
  return results[0]?.samples[0]?.value ?? 0;
}

function extractBuckets(results: TSMRangeResult): AnalyticBucket[] {
  if (results.length === 0) return [];
  return results[0].samples.map((s) => [timestampToUtc(s.timestamp), s.value]);
}

export function dimensionalQuery(config: {
  filter: TSFilter;
  agg: TSAggregation;
  reducer?: TSAggregation;
}) {
  const { filter, agg, reducer = "SUM" } = config;

  const groupBy = {
    label: "baseKey",
    reducer,
  };

  return {
    async lifetime(): Promise<number> {
      const results = await TimeSeriesService.mrangeGroupBy(
        filter,
        "-",
        "+",
        FOREVER_MS,
        agg,
        groupBy
      );
      return extractValue(results);
    },

    async range(range: DateRange): Promise<number> {
      const start = range.start.getTime();
      const end = range.end.getTime();

      const results = await TimeSeriesService.mrangeGroupBy(
        filter,
        start,
        end - 1,
        FOREVER_MS,
        agg,
        groupBy,
        { align: start }
      );
      return extractValue(results);
    },

    async timeframe(tf: Timeframe): Promise<number> {
      if (tf === "lifetime") return this.lifetime();
      return this.range(resolveRange(tf));
    },

    async buckets(range: DateRange, bucket: Bucket = "d"): Promise<AnalyticBucket[]> {
      const bucketMs = BUCKET_MS[bucket];

      const results = await TimeSeriesService.mrangeGroupBy(
        filter,
        range.start.getTime(),
        range.end.getTime() - 1,
        bucketMs,
        agg,
        groupBy,
        { empty: true, align: range.start.getTime() }
      );
      return extractBuckets(results);
    },

    async bucketsByTimeframe(
      tf: Timeframe,
      bucket: Bucket = "d"
    ): Promise<AnalyticBucket[]> {
      if (tf === "lifetime") {
        const results = await TimeSeriesService.mrangeGroupBy(
          filter,
          "-",
          "+",
          BUCKET_MS[bucket],
          agg,
          groupBy,
          { empty: true }
        );
        return extractBuckets(results);
      }
      return this.buckets(resolveRange(tf), bucket);
    },
  };
}

type ExtractValues<T extends readonly string[]> = T[number];

export function groupedQuery<const TValues extends readonly string[]>(config: {
  filter: TSFilter;
  agg: TSAggregation;
  groupBy: string;
  values: TValues;
  reducer?: TSAggregation;
}) {
  const { filter, agg, groupBy, values, reducer = "SUM" } = config;

  type GroupKey = ExtractValues<TValues>;
  type Result = Record<GroupKey, number>;
  type BucketResult = Record<GroupKey, AnalyticBucket[]>;

  const groupConfig = {
    label: groupBy,
    reducer,
  };

  const exactValues = new Set(values as readonly string[]);
  const canonicalByNormalized = new Map<string, string>();
  for (const value of values) {
    canonicalByNormalized.set(value.toLowerCase(), value);
  }

  const resolveCanonicalKey = (raw: string): string | undefined => {
    if (exactValues.has(raw)) return raw;
    return canonicalByNormalized.get(raw.toLowerCase());
  };

  function mapToResult(results: TSMRangeResult): Result {
    const output = {} as Record<string, number>;
    for (const v of values) output[v] = 0;

    for (const r of results) {
      const groupVal = r.labels[groupBy];
      if (!groupVal) continue;
      const canonical = resolveCanonicalKey(groupVal);
      if (canonical) {
        output[canonical] += r.samples[0]?.value ?? 0;
      }
    }
    return output as Result;
  }

  function mapToBucketResult(results: TSMRangeResult): BucketResult {
    const output = {} as Record<string, AnalyticBucket[]>;
    for (const v of values) output[v] = [];
    const mergedByGroup = new Map<string, Map<number, number>>();

    for (const r of results) {
      const groupVal = r.labels[groupBy];
      if (!groupVal) continue;

      const canonical = resolveCanonicalKey(groupVal);
      if (!canonical) continue;

      if (!mergedByGroup.has(canonical)) {
        mergedByGroup.set(canonical, new Map<number, number>());
      }

      const byTs = mergedByGroup.get(canonical)!;
      for (const s of r.samples) {
        byTs.set(s.timestamp, (byTs.get(s.timestamp) ?? 0) + s.value);
      }
    }

    for (const [group, byTs] of mergedByGroup) {
      output[group] = [...byTs.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([ts, value]) => [timestampToUtc(ts), value]);
    }

    return output as BucketResult;
  }

  return {
    async range(range: DateRange): Promise<Result> {
      const start = range.start.getTime();
      const end = range.end.getTime();

      const results = await TimeSeriesService.mrangeGroupBy(
        filter,
        start,
        end - 1,
        end - start,
        agg,
        groupConfig,
        { align: start }
      );
      return mapToResult(results);
    },

    async timeframe(tf: Timeframe): Promise<Result> {
      if (tf === "lifetime") {
        const results = await TimeSeriesService.mrangeGroupBy(
          filter,
          "-",
          "+",
          FOREVER_MS,
          agg,
          groupConfig
        );
        return mapToResult(results);
      }
      return this.range(resolveRange(tf));
    },

    async buckets(range: DateRange, bucket: Bucket = "d"): Promise<BucketResult> {
      const results = await TimeSeriesService.mrangeGroupBy(
        filter,
        range.start.getTime(),
        range.end.getTime() - 1,
        BUCKET_MS[bucket],
        agg,
        groupConfig,
        { empty: true, align: range.start.getTime() }
      );
      return mapToBucketResult(results);
    },

    async bucketsByTimeframe(
      tf: Timeframe,
      bucket: Bucket = "d"
    ): Promise<BucketResult> {
      if (tf === "lifetime") {
        const results = await TimeSeriesService.mrangeGroupBy(
          filter,
          "-",
          "+",
          BUCKET_MS[bucket],
          agg,
          groupConfig,
          { empty: true }
        );
        return mapToBucketResult(results);
      }
      return this.buckets(resolveRange(tf), bucket);
    },
  };
}
