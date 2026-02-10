import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient, type RedisClientType } from "redis";

import { bootstrapAnalytics } from "../../src/bootstrap";
import { setRedisAnalyticsClient } from "../../src/client";
import { createDimensionalMetric } from "../../src/metric-registry";
import { dimensionalQuery } from "../../src/query/ts-query.dim";
import { ts, tsQuery } from "../../src/query/ts-query.standard";
import { TimeseriesStore } from "../../src/store/store.timeseries";
import { createRedisStackAnalyticsClient } from "./redis-stack-adapter";

const runIntegration = process.env.REDIS_INTEGRATION === "1";

describe.runIf(runIntegration)("redis-stack integration", () => {
  let redis: RedisClientType;
  let prefix: string;

  beforeAll(async () => {
    redis = createClient({ url: process.env.REDIS_URL ?? "redis://127.0.0.1:6379" });
    await redis.connect();
    setRedisAnalyticsClient(createRedisStackAnalyticsClient(redis));
  });

  beforeEach(async () => {
    prefix = `it:${randomUUID()}`;
    await redis.flushDb();
  });

  afterAll(async () => {
    await redis.quit();
  });

  it("records and queries a simple timeseries metric", async () => {
    const store = new TimeseriesStore(`${prefix}:bets`, {
      duplicatePolicy: "SUM",
      labels: { metric: "bets" },
    });

    await bootstrapAnalytics([store], { backfillCompactions: true });

    const now = new Date();
    await store.record([
      { timestamp: now, value: 2 },
      { timestamp: now, value: 3 },
    ]);

    const q = tsQuery({ total: ts(store.key, "SUM") });
    const totals = await q.timeframe("24h");

    expect(totals.total).toBe(5);
  });

  it("supports typed dimensional metrics with grouped querying", async () => {
    const txAmount = createDimensionalMetric({
      prefix,
      suffix: "tx_amount",
      dimensions: [
        { name: "coin", values: ["btc", "eth"] as const },
        { name: "category", values: ["deposit", "withdrawal"] as const },
      ] as const,
      config: { duplicatePolicy: "SUM" },
    });

    const store = txAmount.createStore();
    await bootstrapAnalytics([store]);

    await store.record(
      txAmount.points([
        {
          timestamp: new Date(),
          value: 10,
          dimensions: { coin: "btc", category: "deposit" },
        },
        {
          timestamp: new Date(),
          value: 5,
          dimensions: { coin: "eth", category: "deposit" },
        },
      ])
    );

    const overallDeposits = dimensionalQuery({
      filter: txAmount.filter({ category: "deposit" }),
      agg: "SUM",
      reducer: "SUM",
    });

    const total = await overallDeposits.timeframe("24h");
    expect(total).toBe(15);
  });
});
