import { AsyncLocalStorage } from "node:async_hooks";

export type RedisAnalyticsClient = {
  bf: {
    reserve: (key: string, errorRate: number, capacity: number) => Promise<unknown>;
    mAdd: (key: string, items: string[]) => Promise<boolean[]>;
    mExists: (key: string, items: string[]) => Promise<boolean[]>;
  };
  ts: {
    create: (key: string, options: Record<string, unknown>) => Promise<unknown>;
    alter: (key: string, options: Record<string, unknown>) => Promise<unknown>;
    createRule: (
      sourceKey: string,
      destKey: string,
      aggregation: string,
      bucketMs: number,
      align: number
    ) => Promise<unknown>;
    mAdd: (points: Array<{ key: string; timestamp: number; value: number }>) => Promise<unknown>;
    range: (
      key: string,
      from: number | "-",
      to: number | "+",
      options?: Record<string, unknown>
    ) => Promise<Array<{ timestamp: number; value: number | null }>>;
    mRangeWithLabels: (
      from: number | "-",
      to: number | "+",
      filters: string[],
      options?: Record<string, unknown>
    ) => Promise<
      Record<
        string,
        {
          labels: Record<string, string>;
          samples: Array<{ timestamp: number; value: number | null }>;
        }
      >
    >;
    mRangeWithLabelsGroupBy: (
      from: number | "-",
      to: number | "+",
      filters: string[],
      groupBy: Record<string, unknown>,
      options?: Record<string, unknown>
    ) => Promise<
      Record<
        string,
        {
          labels: Record<string, string>;
          samples: Array<{ timestamp: number; value: number | null }>;
        }
      >
    >;
  };
  pfAdd: (key: string, ids: string[]) => Promise<unknown>;
  pfCount: (keys: string[]) => Promise<number>;
  pfMerge: (destKey: string, sourceKeys: string[]) => Promise<unknown>;
  expire: (key: string, ttlSeconds: number) => Promise<unknown>;
  multi: () => {
    pfAdd: (key: string, ids: string[]) => unknown;
    pfCount: (key: string) => unknown;
    execAsPipeline: () => Promise<unknown>;
    execAsPipelineTyped?: () => Promise<unknown>;
  };
};

export type RedisAnalyticsCapabilities = {
  supportsPipelining: boolean;
  supportsExecAsPipelineTyped: boolean;
  supportsNativeGroupBy: boolean;
};

export type RedisAnalyticsContext = {
  client: RedisAnalyticsClient;
  capabilities: RedisAnalyticsCapabilities;
};

const DEFAULT_CAPABILITIES: RedisAnalyticsCapabilities = {
  supportsPipelining: true,
  supportsExecAsPipelineTyped: false,
  supportsNativeGroupBy: true,
};

function inferCapabilities(client: RedisAnalyticsClient): RedisAnalyticsCapabilities {
  const supportsExecAsPipelineTyped =
    typeof client.multi().execAsPipelineTyped === "function";

  return {
    ...DEFAULT_CAPABILITIES,
    supportsExecAsPipelineTyped,
  };
}

let redisAnalyticsClient: RedisAnalyticsClient | null = null;
let redisAnalyticsCapabilities: RedisAnalyticsCapabilities = DEFAULT_CAPABILITIES;
const contextStorage = new AsyncLocalStorage<RedisAnalyticsContext>();

export function setRedisAnalyticsClient(client: RedisAnalyticsClient) {
  redisAnalyticsClient = client;
  redisAnalyticsCapabilities = inferCapabilities(client);
}

export function setRedisAnalyticsCapabilities(
  capabilities: Partial<RedisAnalyticsCapabilities>
) {
  redisAnalyticsCapabilities = {
    ...redisAnalyticsCapabilities,
    ...capabilities,
  };
}

export function getRedisAnalyticsContext(): RedisAnalyticsContext | null {
  const scoped = contextStorage.getStore();
  if (scoped) return scoped;
  if (!redisAnalyticsClient) return null;

  return {
    client: redisAnalyticsClient,
    capabilities: redisAnalyticsCapabilities,
  };
}

export function withRedisAnalyticsContext<T>(
  context: RedisAnalyticsContext,
  run: () => T
): T {
  return contextStorage.run(context, run);
}

export function getRedisAnalyticsClient(): RedisAnalyticsClient {
  const context = getRedisAnalyticsContext();
  if (!context) {
    throw new Error(
      "redis analytics client is not configured. Call setRedisAnalyticsClient() first."
    );
  }
  return context.client;
}

export function getRedisAnalyticsCapabilities(): RedisAnalyticsCapabilities {
  const context = getRedisAnalyticsContext();
  if (context) return context.capabilities;
  return redisAnalyticsCapabilities;
}
