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

type AnyFn = (...args: unknown[]) => unknown;

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
  const instanceRecord = instance as Record<string, unknown>;
  const names = Object.getOwnPropertyNames(proto).filter(
    (name) => name !== "constructor" && typeof instanceRecord[name] === "function"
  );

  for (const name of names) {
    const original = instanceRecord[name] as AnyFn;
    instanceRecord[name] = (...args: unknown[]) =>
      withRedisAnalyticsContext(context, () => original.apply(instance, args));
  }
  return instance;
}

type CreateAnalyticsOptionsWithValidation = {
  client: unknown;
  capabilities?: Partial<RedisAnalyticsCapabilities>;
  validateClientContract?: true;
};

type CreateAnalyticsOptionsWithoutValidation = {
  client: RedisAnalyticsClient;
  capabilities?: Partial<RedisAnalyticsCapabilities>;
  validateClientContract: false;
};

export type CreateAnalyticsOptions =
  | CreateAnalyticsOptionsWithValidation
  | CreateAnalyticsOptionsWithoutValidation;

export function createAnalytics(options: CreateAnalyticsOptions) {
  const client =
    options.validateClientContract === false
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
    const metric = createDimensionalMetric(...args);
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
        bindObjectMethods(tsQuery(...args), context),
      dimensional: (...args: Parameters<typeof dimensionalQuery>) =>
        bindObjectMethods(dimensionalQuery(...args), context),
      grouped: (...args: Parameters<typeof groupedQuery>) =>
        bindObjectMethods(groupedQuery(...args), context),
    },
    metrics: {
      createDimensionalMetric: createMetric,
      mapMetricConfig,
    },
    bootstrap: (targets: BootstrapTarget[], options?: BootstrapOptions) =>
      run(() => bootstrapAnalytics(targets, options)),
  };
}
