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

let redisAnalyticsClient: RedisAnalyticsClient | null = null;

export function setRedisAnalyticsClient(client: RedisAnalyticsClient) {
  redisAnalyticsClient = client;
}

export function getRedisAnalyticsClient(): RedisAnalyticsClient {
  if (!redisAnalyticsClient) {
    throw new Error(
      "redis analytics client is not configured. Call setRedisAnalyticsClient() first."
    );
  }
  return redisAnalyticsClient;
}
