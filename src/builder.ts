import { buildPercentChangeTree, type MetricPercentChange } from "./compare";
import type { BloomConfig } from "./redis/bloom.service";
import type { TSConfig, TSAggregation } from "./redis/timeseries.service";
import {
  defineDimensionalMetrics,
  defineMetrics,
  type InferDimensionalSeries,
  type InferDimensionalStats,
  type InferSeries,
  type InferStats,
  type MetricScope,
} from "./schema";
import { resolveRange } from "./time";
import type { Bucket, DateRange } from "./types";

type DimensionValuesMap = Record<string, readonly string[]>;

type BuilderStoreDef<TDims extends DimensionValuesMap = DimensionValuesMap> = {
  dimensions: TDims;
  config?: TSConfig;
};

type BuilderStoresDef = Record<string, BuilderStoreDef<DimensionValuesMap>>;

type BuilderDimensionalFilter<TStore extends BuilderStoreDef> = Partial<{
  [K in keyof TStore["dimensions"] & string]:
    | TStore["dimensions"][K][number]
    | readonly TStore["dimensions"][K][number][];
}>;

type BuilderMeasureDefForStore<
  TStores extends BuilderStoresDef,
  TStoreName extends keyof TStores & string,
> = {
  store: TStoreName;
  agg: TSAggregation;
  reducer?: TSAggregation;
  filter?: BuilderDimensionalFilter<TStores[TStoreName]>;
  breakdown?: {
    by: keyof TStores[TStoreName]["dimensions"] & string;
  };
};

type BuilderMeasureDef<TStores extends BuilderStoresDef> = {
  [TStoreName in keyof TStores & string]: BuilderMeasureDefForStore<TStores, TStoreName>;
}[keyof TStores & string];

type BuilderMeasuresDef<TStores extends BuilderStoresDef> = Record<string, BuilderMeasureDef<TStores>>;
type ConcreteMeasures<
  TStores extends BuilderStoresDef,
  TMeasures extends Record<string, unknown>,
> = {
  [K in keyof TMeasures & string]: Extract<TMeasures[K], BuilderMeasureDef<TStores>>;
};

type StoreDimensions<TStore extends BuilderStoreDef> = {
  [K in keyof TStore["dimensions"] & string]: TStore["dimensions"][K][number];
};

export type DomainPoint<TStore extends BuilderStoreDef> = {
  timestamp: Date;
  value: number;
  dimensions: StoreDimensions<TStore>;
};

type MeasureBreakdownKeys<
  TStores extends BuilderStoresDef,
  TStoreName extends keyof TStores & string,
> = keyof TStores[TStoreName]["dimensions"] & string;

type BuiltMeasureDefForStore<
  TStores extends BuilderStoresDef,
  TStoreName extends keyof TStores & string,
  TBy extends MeasureBreakdownKeys<TStores, TStoreName> | never = never,
> = {
  store: TStoreName;
  agg: TSAggregation;
  reducer?: TSAggregation;
  filter?: BuilderDimensionalFilter<TStores[TStoreName]>;
} & ([TBy] extends [never] ? {} : { breakdown: { by: TBy } });

type MeasureBuilderChain<
  TStores extends BuilderStoresDef,
  TStoreName extends keyof TStores & string,
  TBy extends MeasureBreakdownKeys<TStores, TStoreName> | never = never,
> = {
  agg(value: TSAggregation): MeasureBuilderChain<TStores, TStoreName, TBy>;
  reducer(value: TSAggregation): MeasureBuilderChain<TStores, TStoreName, TBy>;
  where(
    value: BuilderDimensionalFilter<TStores[TStoreName]>
  ): MeasureBuilderChain<TStores, TStoreName, TBy>;
  filter(
    value: BuilderDimensionalFilter<TStores[TStoreName]>
  ): MeasureBuilderChain<TStores, TStoreName, TBy>;
  breakdown<TNextBy extends MeasureBreakdownKeys<TStores, TStoreName>>(
    value: TNextBy
  ): MeasureBuilderChain<TStores, TStoreName, TNextBy>;
  done(): BuiltMeasureDefForStore<TStores, TStoreName, TBy>;
};

type MeasureBuilderRoot<TStores extends BuilderStoresDef> = {
  from<TStoreName extends keyof TStores & string>(
    store: TStoreName
  ): MeasureBuilderChain<TStores, TStoreName>;
};

function createMeasureBuilder<TStores extends BuilderStoresDef>(): MeasureBuilderRoot<TStores> {
  return {
    from<TStoreName extends keyof TStores & string>(store: TStoreName) {
      type TDimKey = MeasureBreakdownKeys<TStores, TStoreName>;
      type TState = {
        store: TStoreName;
        agg?: TSAggregation;
        reducer?: TSAggregation;
        filter?: BuilderDimensionalFilter<TStores[TStoreName]>;
        breakdown?: { by: TDimKey };
      };
      const state: TState = { store };

      const makeChain = <TBy extends TDimKey | never>(): MeasureBuilderChain<
        TStores,
        TStoreName,
        TBy
      > => ({
        agg(value) {
          state.agg = value;
          return makeChain<TBy>();
        },
        reducer(value) {
          state.reducer = value;
          return makeChain<TBy>();
        },
        where(value) {
          state.filter = value;
          return makeChain<TBy>();
        },
        filter(value) {
          state.filter = value;
          return makeChain<TBy>();
        },
        breakdown(value) {
          state.breakdown = { by: value };
          return makeChain<typeof value>();
        },
        done() {
          if (!state.agg) {
            throw new Error(`Measure from store "${store}" is missing agg()`);
          }
          return state as BuiltMeasureDefForStore<TStores, TStoreName, TBy>;
        },
      });

      return makeChain<never>();
    },
  };
}

type DomainStats<
  TStores extends BuilderStoresDef,
  TMeasures extends BuilderMeasuresDef<TStores>,
> = InferDimensionalStats<TStores, TMeasures>;

type DomainSeries<
  TStores extends BuilderStoresDef,
  TMeasures extends BuilderMeasuresDef<TStores>,
> = InferDimensionalSeries<TStores, TMeasures>;

type KeysOf<T> = keyof T & string;

type SelectedKeys<
  TAll,
  TSelected extends readonly KeysOf<TAll>[],
> = TSelected extends readonly [] ? KeysOf<TAll> : TSelected[number];

type SelectedResult<
  TAll,
  TSelected extends readonly KeysOf<TAll>[],
> = Pick<TAll, SelectedKeys<TAll, TSelected>>;

type AbsoluteChange<T> = T extends number
  ? number
  : T extends Record<string, unknown>
    ? { [K in keyof T]: AbsoluteChange<T[K]> }
    : never;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildAbsoluteChangeTree<T>(current: T, previous: T): AbsoluteChange<T> {
  if (typeof current === "number" && typeof previous === "number") {
    return (current - previous) as AbsoluteChange<T>;
  }

  if (!isRecord(current) || !isRecord(previous)) {
    return 0 as AbsoluteChange<T>;
  }

  const keys = new Set([
    ...Object.keys(current as Record<string, unknown>),
    ...Object.keys(previous as Record<string, unknown>),
  ]);

  const out: Record<string, unknown> = {};
  for (const key of keys) {
    out[key] = buildAbsoluteChangeTree(
      (current as Record<string, unknown>)[key],
      (previous as Record<string, unknown>)[key]
    );
  }

  return out as AbsoluteChange<T>;
}

function toRange(scope: MetricScope): DateRange {
  if (typeof scope === "string") {
    return resolveRange(scope);
  }
  return scope;
}

function previousPeriod(scope: MetricScope): DateRange {
  if (typeof scope === "string" && scope === "lifetime") {
    throw new Error(
      `Cannot infer previous period for "lifetime". Pass { previousScope } explicitly.`
    );
  }

  const current = toRange(scope);
  const spanMs = current.end.getTime() - current.start.getTime();
  if (spanMs <= 0) {
    throw new Error("Cannot infer previous period for empty range");
  }

  return {
    start: new Date(current.start.getTime() - spanMs),
    end: new Date(current.start.getTime()),
  };
}

function pickKeys<T extends Record<string, unknown>, K extends keyof T>(
  input: T,
  keys: readonly K[]
): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) {
    out[key] = input[key];
  }
  return out;
}

export type DomainQueryRunner<
  TStores extends BuilderStoresDef,
  TMeasures extends BuilderMeasuresDef<TStores>,
  TSelected extends readonly KeysOf<DomainStats<TStores, TMeasures>>[],
> = {
  stats(scope: MetricScope): Promise<SelectedResult<DomainStats<TStores, TMeasures>, TSelected>>;
  series(
    scope: MetricScope,
    bucket: Bucket
  ): Promise<SelectedResult<DomainSeries<TStores, TMeasures>, TSelected>>;
  change(
    scope: MetricScope,
    options?: { previousScope?: MetricScope }
  ): Promise<{
    current: SelectedResult<DomainStats<TStores, TMeasures>, TSelected>;
    previous: SelectedResult<DomainStats<TStores, TMeasures>, TSelected>;
    percent: MetricPercentChange<SelectedResult<DomainStats<TStores, TMeasures>, TSelected>>;
    absolute: AbsoluteChange<SelectedResult<DomainStats<TStores, TMeasures>, TSelected>>;
  }>;
};

export type AnalyticsDomain<
  TStores extends BuilderStoresDef,
  TMeasures extends BuilderMeasuresDef<TStores>,
> = {
  prefix: string;
  stores: ReturnType<typeof defineDimensionalMetrics<TStores, TMeasures>>["stores"];
  measureNames: (keyof TMeasures & string)[];
  init(): Promise<void>;
  stats(scope: MetricScope): Promise<DomainStats<TStores, TMeasures>>;
  series(scope: MetricScope, bucket: Bucket): Promise<DomainSeries<TStores, TMeasures>>;
  change(
    scope: MetricScope,
    options?: { previousScope?: MetricScope }
  ): Promise<{
    current: DomainStats<TStores, TMeasures>;
    previous: DomainStats<TStores, TMeasures>;
    percent: MetricPercentChange<DomainStats<TStores, TMeasures>>;
    absolute: AbsoluteChange<DomainStats<TStores, TMeasures>>;
  }>;
  query(): DomainQueryRunner<TStores, TMeasures, readonly []>;
  query<const TSelected extends readonly KeysOf<DomainStats<TStores, TMeasures>>[]>(
    ...measures: TSelected
  ): DomainQueryRunner<TStores, TMeasures, TSelected>;
  record<TStoreName extends keyof TStores & string>(
    store: TStoreName,
    points: DomainPoint<TStores[TStoreName]>[]
  ): Promise<void>;
};

function createQueryRunner<
  TStores extends BuilderStoresDef,
  TMeasures extends BuilderMeasuresDef<TStores>,
  TSelected extends readonly KeysOf<DomainStats<TStores, TMeasures>>[],
>(
  metric: ReturnType<typeof defineDimensionalMetrics<TStores, TMeasures>>,
  selected: TSelected
): DomainQueryRunner<TStores, TMeasures, TSelected> {
  const hasSelection = selected.length > 0;

  return {
    async stats(scope) {
      const all = await metric.getStats(scope);
      if (!hasSelection) {
        return all as SelectedResult<DomainStats<TStores, TMeasures>, TSelected>;
      }
      return pickKeys(
        all as Record<string, unknown>,
        selected as readonly string[]
      ) as SelectedResult<DomainStats<TStores, TMeasures>, TSelected>;
    },

    async series(scope, bucket) {
      const all = await metric.getSeries(scope, bucket);
      if (!hasSelection) {
        return all as SelectedResult<DomainSeries<TStores, TMeasures>, TSelected>;
      }
      return pickKeys(
        all as Record<string, unknown>,
        selected as readonly string[]
      ) as SelectedResult<DomainSeries<TStores, TMeasures>, TSelected>;
    },

    async change(scope, options) {
      const previousScope = options?.previousScope ?? previousPeriod(scope);
      const [current, previous] = await Promise.all([
        this.stats(scope),
        this.stats(previousScope),
      ]);
      return {
        current,
        previous,
        percent: buildPercentChangeTree(current, previous),
        absolute: buildAbsoluteChangeTree(current, previous),
      };
    },
  };
}

export type AnalyticsDomainBuilder<
  TStores extends BuilderStoresDef,
  TMeasures extends Record<string, unknown>,
> = {
  prefix: string;
  timeseriesStore<const TName extends string, const TDims extends DimensionValuesMap>(
    name: TName,
    config: {
      dimensions: TDims;
      config?: TSConfig;
    }
  ): AnalyticsDomainBuilder<
    TStores & Record<TName, BuilderStoreDef<TDims>>,
    TMeasures
  >;
  measure<const TName extends string, TDef extends BuilderMeasureDef<TStores>>(
    name: TName,
    build: (measure: MeasureBuilderRoot<TStores>) => TDef
  ): AnalyticsDomainBuilder<TStores, TMeasures & Record<TName, TDef>>;
  build(): AnalyticsDomain<TStores, ConcreteMeasures<TStores, TMeasures>>;
};

function createAnalyticsDomainBuilder<
  TStores extends BuilderStoresDef,
  TMeasures extends Record<string, unknown>,
>(
  prefix: string,
  stores: TStores,
  measures: TMeasures
): AnalyticsDomainBuilder<TStores, TMeasures> {
  return {
    prefix,

    timeseriesStore(name, config) {
      const nextStores = {
        ...stores,
        [name]: {
          dimensions: config.dimensions,
          config: config.config,
        },
      } as TStores & Record<typeof name, BuilderStoreDef<typeof config.dimensions>>;

      return createAnalyticsDomainBuilder(prefix, nextStores, measures);
    },

    measure(name, build) {
      const queryDef = build(createMeasureBuilder<TStores>());
      const nextMeasures = {
        ...measures,
        [name]: queryDef,
      } as TMeasures & Record<typeof name, typeof queryDef>;

      return createAnalyticsDomainBuilder(prefix, stores, nextMeasures);
    },

    build() {
      type Measures = ConcreteMeasures<TStores, TMeasures>;
      const dimensional = defineDimensionalMetrics({
        prefix,
        stores: stores as TStores,
        queries: measures as Measures,
      });

      const allRunner = createQueryRunner(
        dimensional,
        [] as const
      ) as DomainQueryRunner<
        TStores,
        Measures,
        readonly []
      >;

      const domain: AnalyticsDomain<
        TStores,
        Measures
      > = {
        prefix,
        stores: dimensional.stores,
        measureNames: Object.keys(measures) as (keyof Measures & string)[],
        init: dimensional.init,
        stats: dimensional.getStats,
        series: dimensional.getSeries,
        async change(scope, options) {
          const result = await allRunner.change(scope, options);
          return result as {
            current: DomainStats<TStores, Measures>;
            previous: DomainStats<TStores, Measures>;
            percent: MetricPercentChange<DomainStats<TStores, Measures>>;
            absolute: AbsoluteChange<DomainStats<TStores, Measures>>;
          };
        },
        query: ((...selected: readonly KeysOf<
          DomainStats<TStores, Measures>
        >[]) =>
          createQueryRunner(
            dimensional,
            selected as readonly KeysOf<
              DomainStats<TStores, Measures>
            >[]
          )) as AnalyticsDomain<
          TStores,
          Measures
        >["query"],
        async record(store, points) {
          const dimensionalStore = dimensional.stores[
            store as keyof typeof dimensional.stores
          ] as {
            record: (value: unknown[]) => Promise<void>;
          };
          await dimensionalStore.record(points as unknown[]);
        },
      };

      return domain;
    },
  };
}

export function analyticsDomain(prefix: string): AnalyticsDomainBuilder<{}, {}> {
  return createAnalyticsDomainBuilder(prefix, {}, {});
}

type ScalarMetricDef =
  | {
      type: "timeseries";
      config?: TSConfig;
      aggregations: Record<string, TSAggregation>;
    }
  | { type: "hll" }
  | {
      type: "bloom-counter";
      bloom?: BloomConfig;
    };

type ScalarMetricsDef = Record<string, ScalarMetricDef>;

type ScalarRecordPoint<TMetric extends ScalarMetricDef> = TMetric extends {
  type: "timeseries";
}
  ? {
      timestamp: Date;
      value: number;
    }
  : {
      id: string;
      timestamp: Date;
    };

type TimeseriesMetricNames<TMetrics extends ScalarMetricsDef> = {
  [K in keyof TMetrics & string]: TMetrics[K] extends { type: "timeseries" } ? K : never;
}[keyof TMetrics & string];

type ScalarStoreRecordable = {
  record(points: unknown[]): Promise<void>;
};

type ScalarStoreBackfillable = {
  backfillCompactions(): Promise<void>;
};

export type AnalyticsMetricsDomain<TMetrics extends ScalarMetricsDef> = {
  prefix: string;
  stores: ReturnType<typeof defineMetrics<TMetrics>>["stores"];
  metricNames: (keyof TMetrics & string)[];
  init(): Promise<void>;
  stats(scope: MetricScope): Promise<InferStats<TMetrics>>;
  series(scope: MetricScope, bucket: Bucket): Promise<InferSeries<TMetrics>>;
  record<TName extends keyof TMetrics & string>(
    metric: TName,
    points: ScalarRecordPoint<TMetrics[TName]>[]
  ): Promise<void>;
  backfillCompactions(...metrics: TimeseriesMetricNames<TMetrics>[]): Promise<void>;
};

export type AnalyticsMetricsBuilder<TMetrics extends ScalarMetricsDef> = {
  prefix: string;
  timeseriesMetric<
    const TName extends string,
    const TAgg extends Record<string, TSAggregation>,
  >(
    name: TName,
    options: {
      aggregations: TAgg;
      config?: TSConfig;
    }
  ): AnalyticsMetricsBuilder<
    TMetrics &
      Record<
        TName,
        {
          type: "timeseries";
          config?: TSConfig;
          aggregations: TAgg;
        }
      >
  >;
  hllMetric<const TName extends string>(
    name: TName
  ): AnalyticsMetricsBuilder<TMetrics & Record<TName, { type: "hll" }>>;
  bloomCounterMetric<const TName extends string>(
    name: TName,
    options?: {
      bloom?: BloomConfig;
    }
  ): AnalyticsMetricsBuilder<
    TMetrics &
      Record<
        TName,
        {
          type: "bloom-counter";
          bloom?: BloomConfig;
        }
      >
  >;
  build(): AnalyticsMetricsDomain<TMetrics>;
};

function createAnalyticsMetricsBuilder<TMetrics extends ScalarMetricsDef>(
  prefix: string,
  metrics: TMetrics
): AnalyticsMetricsBuilder<TMetrics> {
  return {
    prefix,

    timeseriesMetric(name, options) {
      const nextMetrics = {
        ...metrics,
        [name]: {
          type: "timeseries",
          config: options.config,
          aggregations: options.aggregations,
        },
      } as TMetrics &
        Record<
          typeof name,
          {
            type: "timeseries";
            config?: TSConfig;
            aggregations: typeof options.aggregations;
          }
        >;

      return createAnalyticsMetricsBuilder(prefix, nextMetrics);
    },

    hllMetric(name) {
      const nextMetrics = {
        ...metrics,
        [name]: { type: "hll" },
      } as TMetrics & Record<typeof name, { type: "hll" }>;

      return createAnalyticsMetricsBuilder(prefix, nextMetrics);
    },

    bloomCounterMetric(name, options) {
      const nextMetrics = {
        ...metrics,
        [name]: {
          type: "bloom-counter",
          bloom: options?.bloom,
        },
      } as TMetrics &
        Record<
          typeof name,
          {
            type: "bloom-counter";
            bloom?: BloomConfig;
          }
        >;

      return createAnalyticsMetricsBuilder(prefix, nextMetrics);
    },

    build() {
      const definedMetrics = defineMetrics({
        prefix,
        metrics,
      });

      const allTimeseriesMetrics = Object.entries(metrics)
        .filter(([, metricDef]) => metricDef.type === "timeseries")
        .map(([metricName]) => metricName) as TimeseriesMetricNames<TMetrics>[];

      const domain: AnalyticsMetricsDomain<TMetrics> = {
        prefix,
        stores: definedMetrics.stores,
        metricNames: Object.keys(metrics) as (keyof TMetrics & string)[],
        init: definedMetrics.init,
        stats: definedMetrics.getStats,
        series: definedMetrics.getSeries,
        async record(metric, points) {
          const store = definedMetrics.stores[
            metric as keyof typeof definedMetrics.stores
          ] as ScalarStoreRecordable;
          await store.record(points as unknown[]);
        },
        async backfillCompactions(...metricNames) {
          const targetMetrics =
            metricNames.length > 0 ? metricNames : allTimeseriesMetrics;

          await Promise.all(
            targetMetrics.map(async (metricName) => {
              const store = definedMetrics.stores[
                metricName as keyof typeof definedMetrics.stores
              ] as Partial<ScalarStoreBackfillable>;

              if (typeof store.backfillCompactions === "function") {
                await store.backfillCompactions();
              }
            })
          );
        },
      };

      return domain;
    },
  };
}

export function analyticsMetrics(prefix: string): AnalyticsMetricsBuilder<{}> {
  return createAnalyticsMetricsBuilder(prefix, {});
}
