import {
  type RedisAnalyticsCapabilities,
  type RedisAnalyticsClient,
  type RedisAnalyticsContext,
  withRedisAnalyticsContext,
} from "./client";
import { assertRedisAnalyticsClientContract } from "./client-contract";
import { BloomService } from "./redis/bloom.service";
import { HLLService } from "./redis/hll.service";
import { TimeSeriesService } from "./redis/timeseries.service";
import {
  BloomCounterStore,
  DimensionalTSStore,
  HllStore,
  TimeseriesStore,
} from "./store";
import { dimensionalQuery, groupedQuery } from "./query/ts-query.dim";
import { tsQuery } from "./query/ts-query.standard";
import { bootstrapAnalytics, type BootstrapOptions, type BootstrapTarget } from "./bootstrap";
import { createDimensionalMetric, mapMetricConfig } from "./metric-registry";

type AnyFn = (...args: any[]) => any;

function bindObjectMethods<T extends Record<string, unknown>>(
  target: T,
  context: RedisAnalyticsContext
): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(target)) {
    if (typeof value !== "function") {
      out[key] = value;
      continue;
    }
    out[key] = (...args: unknown[]) =>
      withRedisAnalyticsContext(context, () => (value as AnyFn).apply(target, args));
  }
  return out as T;
}

function bindInstanceMethods<T extends object>(instance: T, context: RedisAnalyticsContext): T {
  const proto = Object.getPrototypeOf(instance) as Record<string, unknown>;
  const names = Object.getOwnPropertyNames(proto).filter(
    (name) => name !== "constructor" && typeof (instance as any)[name] === "function"
  );

  for (const name of names) {
    const original = (instance as any)[name] as AnyFn;
    (instance as any)[name] = (...args: unknown[]) =>
      withRedisAnalyticsContext(context, () => original.apply(instance, args));
  }
  return instance;
}

export type CreateAnalyticsOptions = {
  client: RedisAnalyticsClient;
  capabilities?: Partial<RedisAnalyticsCapabilities>;
  validateClientContract?: boolean;
};

export function createAnalytics(options: CreateAnalyticsOptions) {
  const client = options.validateClientContract === false
    ? options.client
    : assertRedisAnalyticsClientContract(options.client);
  const inferredTypedPipeline = typeof client.multi().execAsPipelineTyped === "function";

  const context: RedisAnalyticsContext = {
    client,
    capabilities: {
      supportsPipelining: true,
      supportsNativeGroupBy: true,
      supportsExecAsPipelineTyped: inferredTypedPipeline,
      ...options.capabilities,
    },
  };

  const run = <T>(fn: () => T): T => withRedisAnalyticsContext(context, fn);

  const createMetric = (...args: Parameters<typeof createDimensionalMetric>) => {
    const metric = createDimensionalMetric(...(args as [any]));
    return {
      ...metric,
      createStore: () => bindInstanceMethods(metric.createStore(), context),
    };
  };

  return {
    context,
    run,
    services: {
      timeseries: bindObjectMethods(TimeSeriesService, context),
      hll: bindObjectMethods(HLLService, context),
      bloom: bindObjectMethods(BloomService, context),
    },
    stores: {
      timeseries: (...args: ConstructorParameters<typeof TimeseriesStore>) =>
        bindInstanceMethods(new TimeseriesStore(...args), context),
      dimensional: <TDim extends string>(
        ...args: ConstructorParameters<typeof DimensionalTSStore<TDim>>
      ) => bindInstanceMethods(new DimensionalTSStore<TDim>(...args), context),
      hll: (...args: ConstructorParameters<typeof HllStore>) =>
        bindInstanceMethods(new HllStore(...args), context),
      bloomCounter: (...args: ConstructorParameters<typeof BloomCounterStore>) =>
        bindInstanceMethods(new BloomCounterStore(...args), context),
    },
    query: {
      ts: (...args: Parameters<typeof tsQuery>) =>
        bindObjectMethods(tsQuery(...(args as [any])), context),
      dimensional: (...args: Parameters<typeof dimensionalQuery>) =>
        bindObjectMethods(dimensionalQuery(...(args as [any])), context),
      grouped: (...args: Parameters<typeof groupedQuery>) =>
        bindObjectMethods(groupedQuery(...(args as [any])), context),
    },
    metrics: {
      createDimensionalMetric: createMetric,
      mapMetricConfig,
    },
    bootstrap: (targets: BootstrapTarget[], options?: BootstrapOptions) =>
      run(() => bootstrapAnalytics(targets, options)),
  };
}
