import { timestampToUtc } from "../time";

import { getRedisAnalyticsClient } from "../client";
import type { AnalyticBucket } from "../types";

export const FOREVER_MS = 3153600000000;

export type TSFilter = Record<string, string | string[]>;

export type TSPoint = {
  key: string;
  timestamp: number;
  value: number;
};

export type TSRangeResult = Array<{ timestamp: number; value: number }>;

export type TSMRangeResult = Array<{
  key: string;
  labels: Record<string, string>;
  samples: TSRangeResult;
}>;

export type TSAggregation = "SUM" | "AVG" | "COUNT" | "LAST" | "MAX" | "MIN";
export type TSDuplicatePolicy = "SUM" | "LAST" | "MIN" | "MAX" | "BLOCK";

export type TSCompactionRule = {
  agg: TSAggregation;
  bucketMs?: number;
  retentionHrs?: number;
};

export type TSConfig = {
  labels?: Record<string, string>;
  retentionHrs?: number;
  duplicatePolicy?: TSDuplicatePolicy;
  /**
   * When false (default), existing series keys are left untouched.
   * Set true only when you explicitly want to reconcile key settings on startup.
   */
  reconcileExisting?: boolean;
};

const createFilterArray = (filter: TSFilter) => {
  return Object.entries(filter).map(([k, v]) =>
    Array.isArray(v) ? `${k}=(${v.join(",")})` : `${k}=${v}`
  );
};

export const pointToBucket = (
  points: { value: number; timestamp: number }[]
): AnalyticBucket[] =>
  points.map((x) => [timestampToUtc(x.timestamp), x.value] as const);

export const TimeSeriesService = {
  async ensureKey(key: string, config: TSConfig = {}) {
    const {
      duplicatePolicy = "LAST",
      labels = {},
      retentionHrs = 0,
      reconcileExisting = false,
    } = config;
    const RETENTION = retentionHrs * 60 * 60 * 1000;

    try {
      await getRedisAnalyticsClient().ts.create(key, {
        RETENTION,
        LABELS: labels,
        DUPLICATE_POLICY: duplicatePolicy,
      });
    } catch (e: any) {
      if ((e?.message ?? "").includes("key already exists")) {
        if (!reconcileExisting) return;

        await getRedisAnalyticsClient().ts.alter(key, {
          RETENTION,
          DUPLICATE_POLICY: duplicatePolicy,
          LABELS: labels,
        });
      } else {
        throw e;
      }
    }
  },

  async ensureCompactionRule(
    sourceKey: string,
    destKey: string,
    options: TSCompactionRule
  ) {
    const { agg, bucketMs = 60 * 60 * 1000 } = options;

    await this.ensureKey(destKey, { ...options, duplicatePolicy: "LAST" });

    try {
      await getRedisAnalyticsClient().ts.createRule(
        sourceKey,
        destKey,
        agg,
        bucketMs,
        0
      );
    } catch (e: any) {
      const message = e?.message ?? "";
      if (
        !message.includes("DUPLICATE") &&
        !message.includes("already exists") &&
        !message.includes("the destination key already has a src rule")
      ) {
        throw e;
      }
    }
  },

  async add(points: TSPoint[]) {
    if (points.length === 0) return;
    await getRedisAnalyticsClient().ts.mAdd(points);
  },

  async range(
    key: string,
    from: number | "-",
    to: number | "+",
    bucketMs: number,
    aggregation: TSAggregation,
    options: { align?: number; empty?: boolean } = {}
  ) {
    const { align = 0, empty = false } = options;

    const samples = await getRedisAnalyticsClient().ts.range(key, from, to, {
      AGGREGATION: {
        type: aggregation,
        timeBucket: bucketMs,
        ALIGN: align,
        EMPTY: empty,
      },
    });

    return samples.map((s) => ({
      timestamp: s.timestamp,
      value: s.value ?? 0,
    }));
  },

  async rangeRaw(
    key: string,
    from: number | "-" = "-",
    to: number | "+" = "+"
  ) {
    const samples = await getRedisAnalyticsClient().ts.range(key, from, to);
    return samples.map((s) => ({ timestamp: s.timestamp, value: s.value ?? 0 }));
  },

  async mrange(
    filter: TSFilter,
    from: number | "-",
    to: number | "+",
    bucketMs: number,
    aggregation: TSAggregation,
    options: { align?: number; empty?: boolean } = {}
  ): Promise<TSMRangeResult> {
    const { align = 0, empty = false } = options;

    const filterArray = createFilterArray(filter);

    const results = await getRedisAnalyticsClient().ts.mRangeWithLabels(
      from,
      to,
      filterArray,
      {
        AGGREGATION: {
          type: aggregation,
          timeBucket: bucketMs,
          ALIGN: align,
          EMPTY: empty,
        },
      }
    );

    return Object.entries(results).map(([key, data]) => ({
      key,
      labels: data.labels,
      samples: data.samples.map((s) => ({
        timestamp: s.timestamp,
        value: s.value ?? 0,
      })),
    }));
  },

  async mrangeGroupBy(
    filter: TSFilter,
    from: number | "-",
    to: number | "+",
    bucketMs: number,
    agg: TSAggregation,
    groupBy: { label: string; reducer: TSAggregation },
    options: { align?: number; empty?: boolean } = {}
  ): Promise<TSMRangeResult> {
    const filterArray = createFilterArray(filter);

    const results = await getRedisAnalyticsClient().ts.mRangeWithLabelsGroupBy(
      from,
      to,
      filterArray,
      {
        label: groupBy.label,
        REDUCE: groupBy.reducer !== "LAST" ? groupBy.reducer : "SUM",
      },
      {
        ALIGN: options.align ?? 0,

        AGGREGATION: {
          timeBucket: bucketMs,
          type: agg,
          EMPTY: options.empty ?? false,
        },
      }
    );

    return Object.entries(results).map(([key, data]) => ({
      key,
      labels: data.labels,
      samples: data.samples.map((s) => ({
        timestamp: s.timestamp,
        value: s.value ?? 0,
      })),
    }));
  },

  async backfillCompaction(
    sourceKey: string,
    destKey: string,
    agg: TSAggregation,
    bucketMs: number
  ): Promise<void> {
    const samples = await this.range(sourceKey, "-", "+", bucketMs, agg, {
      align: 0,
      empty: false,
    });

    if (samples.length === 0) return;

    await this.add(
      samples.map((s) => ({
        key: destKey,
        timestamp: s.timestamp,
        value: s.value,
      }))
    );
  },
};
