import type { TSConfig, TSAggregation } from "./redis/timeseries.service";
import type { BloomConfig } from "./redis/bloom.service";
import type {
  AnalyticBucket,
  Bucket,
  DateRange,
  Timeframe,
} from "./types";
import { TimeseriesStore } from "./store/store.timeseries";
import { DimensionalTSStore, type DimensionDef } from "./store/store.dimentional-ts";
import { HllStore } from "./store/store.hll";
import { BloomCounterStore } from "./store/store.bloom-counter";
import { dimensionalQuery, groupedQuery } from "./query/ts-query.dim";
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

// ── Dimensional schema API ──

type DimensionValuesMap = Record<string, readonly string[]>;

type DimensionalStoreDef<TDims extends DimensionValuesMap = DimensionValuesMap> = {
  dimensions: TDims;
  config?: TSConfig;
};

type DimensionalStoresDef = Record<string, DimensionalStoreDef<DimensionValuesMap>>;

export type DimensionalFilter<TDims extends DimensionValuesMap> = Partial<{
  [K in keyof TDims & string]:
    | TDims[K][number]
    | readonly TDims[K][number][];
}>;

type QueryDefForStore<
  TStores extends DimensionalStoresDef,
  TStoreName extends keyof TStores & string,
> = {
  store: TStoreName;
  agg: TSAggregation;
  reducer?: TSAggregation;
  filter?: DimensionalFilter<TStores[TStoreName]["dimensions"]>;
  breakdown?: {
    by: keyof TStores[TStoreName]["dimensions"] & string;
  };
};

type DimensionalQueryDef<TStores extends DimensionalStoresDef> = {
  [TStoreName in keyof TStores & string]: QueryDefForStore<TStores, TStoreName>;
}[keyof TStores & string];

type DimensionalQueriesDef<TStores extends DimensionalStoresDef> = Record<
  string,
  DimensionalQueryDef<TStores>
>;

type InferDimensionalStores<TStores extends DimensionalStoresDef> = {
  [K in keyof TStores]: DimensionalTSStore<keyof TStores[K]["dimensions"] & string>;
};

type InferDimensionalStatForQuery<
  TStores extends DimensionalStoresDef,
  TQuery extends DimensionalQueryDef<TStores>,
> = TQuery extends { store: infer TStoreName extends keyof TStores & string }
  ? TQuery extends {
      breakdown: { by: infer TBy extends keyof TStores[TStoreName]["dimensions"] & string };
    }
    ? {
        overall: number;
        breakdown: Record<TStores[TStoreName]["dimensions"][TBy][number], number>;
      }
    : number
  : never;

type InferDimensionalSeriesForQuery<
  TStores extends DimensionalStoresDef,
  TQuery extends DimensionalQueryDef<TStores>,
> = TQuery extends { store: infer TStoreName extends keyof TStores & string }
  ? TQuery extends {
      breakdown: { by: infer TBy extends keyof TStores[TStoreName]["dimensions"] & string };
    }
    ? {
        overall: AnalyticBucket[];
        breakdown: Record<TStores[TStoreName]["dimensions"][TBy][number], AnalyticBucket[]>;
      }
    : AnalyticBucket[]
  : never;

export type InferDimensionalStats<
  TStores extends DimensionalStoresDef,
  TQueries extends DimensionalQueriesDef<TStores>,
> = {
  [K in keyof TQueries]: InferDimensionalStatForQuery<TStores, TQueries[K]>;
};

export type InferDimensionalSeries<
  TStores extends DimensionalStoresDef,
  TQueries extends DimensionalQueriesDef<TStores>,
> = {
  [K in keyof TQueries]: InferDimensionalSeriesForQuery<TStores, TQueries[K]>;
};

export type DefinedDimensionalMetrics<
  TStores extends DimensionalStoresDef,
  TQueries extends DimensionalQueriesDef<TStores>,
> = {
  stores: InferDimensionalStores<TStores>;
  init(): Promise<void>;
  getStats(scope: MetricScope): Promise<InferDimensionalStats<TStores, TQueries>>;
  getSeries(
    scope: MetricScope,
    bucket: Bucket
  ): Promise<InferDimensionalSeries<TStores, TQueries>>;
};

type RuntimeDimensionalQuery = {
  key: string;
  overall: ReturnType<typeof dimensionalQuery>;
  breakdown?: ReturnType<typeof groupedQuery>;
};

function toDimensionDefs<TDims extends DimensionValuesMap>(
  dimensions: TDims
): DimensionDef<keyof TDims & string>[] {
  return Object.entries(dimensions).map(([name, values]) => ({
    name: name as keyof TDims & string,
    knownValues: values,
  }));
}

export function defineDimensionalMetrics<
  const TStores extends DimensionalStoresDef,
  const TQueries extends DimensionalQueriesDef<TStores>,
>(config: {
  prefix: string;
  stores: TStores;
  queries: TQueries;
}): DefinedDimensionalMetrics<TStores, TQueries> {
  const storesRecord = {} as InferDimensionalStores<TStores>;

  for (const [storeName, storeDef] of Object.entries(config.stores)) {
    const key = `${config.prefix}:${storeName}`;
    const dimDefs = toDimensionDefs(storeDef.dimensions);

    (
      storesRecord as Record<
        string,
        DimensionalTSStore<string>
      >
    )[storeName] = new DimensionalTSStore(key, dimDefs, storeDef.config ?? {});
  }

  const queryPlans = Object.entries(config.queries).map(([queryKey, queryDef]) => {
    const store = (
      storesRecord as Record<
        string,
        DimensionalTSStore<string>
      >
    )[queryDef.store];
    const filter = store.filter(queryDef.filter as Record<string, string | string[]>);

    const overall = dimensionalQuery({
      filter,
      agg: queryDef.agg,
      reducer: queryDef.reducer,
    });

    let breakdown: ReturnType<typeof groupedQuery> | undefined;
    if (queryDef.breakdown) {
      const by = queryDef.breakdown.by as string;
      const storeDefinition = config.stores[
        queryDef.store
      ] as DimensionalStoreDef<DimensionValuesMap>;
      const values = storeDefinition.dimensions[by];

      if (!values) {
        throw new Error(
          `Unknown breakdown dimension "${by}" for query "${queryKey}"`
        );
      }

      breakdown = groupedQuery({
        filter,
        agg: queryDef.agg,
        reducer: queryDef.reducer,
        groupBy: by,
        values,
      });
    }

    return {
      key: queryKey,
      overall,
      breakdown,
    } satisfies RuntimeDimensionalQuery;
  });

  async function getStats(
    scope: MetricScope
  ): Promise<InferDimensionalStats<TStores, TQueries>> {
    const tf = isTimeframe(scope);
    const results = await Promise.all(
      queryPlans.map(async (plan) => {
        if (plan.breakdown) {
          const [overall, breakdown] = await Promise.all([
            tf ? plan.overall.timeframe(scope) : plan.overall.range(scope),
            tf ? plan.breakdown.timeframe(scope) : plan.breakdown.range(scope),
          ]);
          return [plan.key, { overall, breakdown }] as const;
        }

        const value = tf ? plan.overall.timeframe(scope) : plan.overall.range(scope);
        return [plan.key, await value] as const;
      })
    );

    return Object.fromEntries(results) as InferDimensionalStats<TStores, TQueries>;
  }

  async function getSeries(
    scope: MetricScope,
    bucket: Bucket
  ): Promise<InferDimensionalSeries<TStores, TQueries>> {
    const tf = isTimeframe(scope);
    const results = await Promise.all(
      queryPlans.map(async (plan) => {
        if (plan.breakdown) {
          const [overall, breakdown] = await Promise.all([
            tf
              ? plan.overall.bucketsByTimeframe(scope, bucket)
              : plan.overall.buckets(scope, bucket),
            tf
              ? plan.breakdown.bucketsByTimeframe(scope, bucket)
              : plan.breakdown.buckets(scope, bucket),
          ]);
          return [plan.key, { overall, breakdown }] as const;
        }

        const value = tf
          ? plan.overall.bucketsByTimeframe(scope, bucket)
          : plan.overall.buckets(scope, bucket);
        return [plan.key, await value] as const;
      })
    );

    return Object.fromEntries(results) as InferDimensionalSeries<TStores, TQueries>;
  }

  return {
    stores: storesRecord,
    init: () => Promise.all(Object.values(storesRecord).map((store) => store.init())).then(() => undefined),
    getStats,
    getSeries,
  };
}
