import type { TSConfig, TSAggregation } from "./redis/timeseries.service";
import type { BloomConfig } from "./redis/bloom.service";
import type {
  AnalyticBucket,
  Bucket,
  DateRange,
  Timeframe,
} from "./types";
import { TimeseriesStore } from "./store/store.timeseries";
import { HllStore } from "./store/store.hll";
import { BloomCounterStore } from "./store/store.bloom-counter";
import { ts, tsQuery } from "./query/ts-query.standard";

// ── Metric definition types ──

type TimeseriesMetricDef = {
  type: "timeseries";
  config?: TSConfig;
  aggregations: Record<string, TSAggregation>;
};

type HllMetricDef = {
  type: "hll";
};

type BloomCounterMetricDef = {
  type: "bloom-counter";
  bloom?: BloomConfig;
};

type MetricDef = TimeseriesMetricDef | HllMetricDef | BloomCounterMetricDef;

type MetricsDef = Record<string, MetricDef>;

// ── Type inference ──

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
  k: infer I
) => void
  ? I
  : never;

type InferStatsForMetric<K extends string, TDef extends MetricDef> =
  TDef extends { type: "timeseries"; aggregations: infer A }
    ? { [AK in keyof A]: number }
    : TDef extends { type: "hll" }
      ? { [P in K]: number }
      : TDef extends { type: "bloom-counter" }
        ? { [P in K]: number }
        : never;

export type InferStats<TDef extends MetricsDef> = UnionToIntersection<
  { [K in keyof TDef & string]: InferStatsForMetric<K, TDef[K]> }[keyof TDef & string]
>;

export type InferSeries<TDef extends MetricsDef> = {
  [K in keyof InferStats<TDef>]: AnalyticBucket[];
};

// ── Store type inference ──

type StoreForMetric<TDef extends MetricDef> =
  TDef extends { type: "timeseries" }
    ? TimeseriesStore
    : TDef extends { type: "hll" }
      ? HllStore
      : TDef extends { type: "bloom-counter" }
        ? BloomCounterStore
        : never;

type InferStores<TDef extends MetricsDef> = {
  [K in keyof TDef]: StoreForMetric<TDef[K]>;
};

// ── Query scope ──

/** A scope for querying metrics — either a named timeframe or a date range. */
export type MetricScope = Timeframe | DateRange;

function isTimeframe(scope: MetricScope): scope is Timeframe {
  return typeof scope === "string";
}

// ── Return type ──

export type DefinedMetrics<TDef extends MetricsDef> = {
  stores: InferStores<TDef>;
  init(): Promise<void>;
  getStats(scope: MetricScope): Promise<InferStats<TDef>>;
  getSeries(scope: MetricScope, bucket: Bucket): Promise<InferSeries<TDef>>;
};

// ── Implementation ──

type InternalStore =
  | { kind: "timeseries"; name: string; store: TimeseriesStore; aggregations: Record<string, TSAggregation> }
  | { kind: "hll"; name: string; store: HllStore }
  | { kind: "bloom-counter"; name: string; store: BloomCounterStore };

export function defineMetrics<const TDef extends MetricsDef>(config: {
  prefix: string;
  metrics: TDef;
}): DefinedMetrics<TDef> {
  const { prefix, metrics } = config;
  const internals: InternalStore[] = [];
  const storesRecord: Record<string, TimeseriesStore | HllStore | BloomCounterStore> = {};

  for (const [name, def] of Object.entries(metrics)) {
    const key = `${prefix}:${name}`;

    switch (def.type) {
      case "timeseries": {
        const store = new TimeseriesStore(key, def.config ?? {});
        storesRecord[name] = store;
        internals.push({ kind: "timeseries", name, store, aggregations: def.aggregations });
        break;
      }
      case "hll": {
        const store = new HllStore(key);
        storesRecord[name] = store;
        internals.push({ kind: "hll", name, store });
        break;
      }
      case "bloom-counter": {
        const store = new BloomCounterStore(key, { bloom: def.bloom });
        storesRecord[name] = store;
        internals.push({ kind: "bloom-counter", name, store });
        break;
      }
    }
  }

  // Build tsQuery definition from all timeseries metrics
  const tsQueryDef: Record<string, { key: string; agg: TSAggregation }> = {};
  for (const internal of internals) {
    if (internal.kind === "timeseries") {
      for (const [aggName, agg] of Object.entries(internal.aggregations)) {
        tsQueryDef[aggName] = ts(internal.store.key, agg);
      }
    }
  }
  const tsQ = tsQuery(tsQueryDef);
  const hasTsMetrics = Object.keys(tsQueryDef).length > 0;

  // Collect non-timeseries stores for stats/series
  const countStores = internals.filter(
    (s): s is Extract<InternalStore, { kind: "hll" | "bloom-counter" }> =>
      s.kind === "hll" || s.kind === "bloom-counter"
  );

  async function getStats(scope: MetricScope): Promise<InferStats<TDef>> {
    const tf = isTimeframe(scope);

    const tsStatsPromise = hasTsMetrics
      ? tf ? tsQ.timeframe(scope) : tsQ.range(scope)
      : Promise.resolve({});

    const countPromises = countStores.map(async (s) => {
      const value = tf
        ? await s.store.get(scope)
        : await s.store.total(scope);
      return [s.name, value] as const;
    });

    const [tsStats, ...countResults] = await Promise.all([
      tsStatsPromise,
      ...countPromises,
    ]);

    const result = { ...tsStats } as Record<string, number>;
    for (const [name, value] of countResults) {
      result[name] = value;
    }

    return result as InferStats<TDef>;
  }

  async function getSeries(scope: MetricScope, bucket: Bucket): Promise<InferSeries<TDef>> {
    const tf = isTimeframe(scope);

    const tsSeriesPromise = hasTsMetrics
      ? tf ? tsQ.bucketsByTimeframe(scope, bucket) : tsQ.buckets(scope, bucket)
      : Promise.resolve({});

    const countPromises = countStores.map(async (s) => {
      const buckets = tf
        ? await s.store.getBuckets(scope, bucket)
        : await s.store.buckets(scope, bucket);
      return [s.name, buckets] as const;
    });

    const [tsSeries, ...countResults] = await Promise.all([
      tsSeriesPromise,
      ...countPromises,
    ]);

    const result = { ...tsSeries } as Record<string, AnalyticBucket[]>;
    for (const [name, buckets] of countResults) {
      result[name] = buckets;
    }

    return result as InferSeries<TDef>;
  }

  return {
    stores: storesRecord as InferStores<TDef>,
    init: () => Promise.all(internals.map((s) => s.store.init())).then(() => undefined),
    getStats,
    getSeries,
  };
}
