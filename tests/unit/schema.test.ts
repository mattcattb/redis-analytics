import { describe, expect, it, vi, beforeEach } from "vitest";
import { defineMetrics } from "../../src/schema";
import { setRedisAnalyticsClient } from "../../src/client";
import type { RedisAnalyticsClient } from "../../src/client";

function createMockClient(): RedisAnalyticsClient {
  return {
    bf: {
      reserve: vi.fn(async () => undefined),
      mAdd: vi.fn(async (key: string, ids: string[]) => ids.map(() => true)),
      mExists: vi.fn(async (key: string, ids: string[]) => ids.map(() => false)),
    },
    ts: {
      create: vi.fn(async () => undefined),
      alter: vi.fn(async () => undefined),
      createRule: vi.fn(async () => undefined),
      mAdd: vi.fn(async () => undefined),
      range: vi.fn(async () => []),
      mRangeWithLabels: vi.fn(async () => ({})),
      mRangeWithLabelsGroupBy: vi.fn(async () => ({})),
    },
    pfAdd: vi.fn(async () => undefined),
    pfCount: vi.fn(async () => 0),
    pfMerge: vi.fn(async () => undefined),
    expire: vi.fn(async () => undefined),
    multi: () => ({
      pfAdd: vi.fn(() => undefined),
      pfCount: vi.fn(() => undefined),
      execAsPipeline: vi.fn(async () => undefined),
    }),
  };
}

describe("defineMetrics", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    setRedisAnalyticsClient(client);
  });

  it("creates stores for all metric types", () => {
    const m = defineMetrics({
      prefix: "test:prefix",
      metrics: {
        events: {
          type: "timeseries",
          config: { duplicatePolicy: "SUM" },
          aggregations: { events_total: "COUNT", events_sum: "SUM" },
        },
        unique_users: { type: "hll" },
        new_users: { type: "bloom-counter" },
      },
    });

    expect(m.stores.events).toBeDefined();
    expect(m.stores.events.key).toBe("test:prefix:events");
    expect(m.stores.unique_users).toBeDefined();
    expect(m.stores.unique_users.key).toBe("test:prefix:unique_users");
    expect(m.stores.new_users).toBeDefined();
  });

  it("init() calls init on all stores", async () => {
    const m = defineMetrics({
      prefix: "test:init",
      metrics: {
        events: {
          type: "timeseries",
          aggregations: { events_total: "COUNT" },
        },
        unique_users: { type: "hll" },
      },
    });

    await m.init();

    // TimeseriesStore.init calls ensureKey
    expect(client.ts.create).toHaveBeenCalled();
  });

  it("getStats with timeframe string", async () => {
    (client.ts.range as any).mockResolvedValue([{ timestamp: 1000, value: 42 }]);
    (client.pfCount as any).mockResolvedValue(7);

    const m = defineMetrics({
      prefix: "test:stats",
      metrics: {
        tips: {
          type: "timeseries",
          config: { duplicatePolicy: "SUM" },
          aggregations: { tips_total: "COUNT", tips_sum: "SUM" },
        },
        unique_tippers: { type: "hll" },
      },
    });

    const stats = await m.getStats("24h");

    expect(stats).toHaveProperty("tips_total");
    expect(stats).toHaveProperty("tips_sum");
    expect(stats).toHaveProperty("unique_tippers");
    expect(typeof stats.tips_total).toBe("number");
    expect(typeof stats.unique_tippers).toBe("number");
  });

  it("getStats with date range", async () => {
    (client.ts.range as any).mockResolvedValue([{ timestamp: 1000, value: 10 }]);
    (client.pfCount as any).mockResolvedValue(3);

    const m = defineMetrics({
      prefix: "test:range",
      metrics: {
        events: {
          type: "timeseries",
          aggregations: { events_count: "COUNT" },
        },
        unique_users: { type: "hll" },
      },
    });

    const range = { start: new Date("2024-01-01"), end: new Date("2024-01-31") };
    const stats = await m.getStats(range);

    expect(stats).toHaveProperty("events_count");
    expect(stats).toHaveProperty("unique_users");
  });

  it("getSeries with timeframe string", async () => {
    (client.ts.range as any).mockResolvedValue([
      { timestamp: 1000, value: 5 },
      { timestamp: 2000, value: 10 },
    ]);

    const m = defineMetrics({
      prefix: "test:series",
      metrics: {
        events: {
          type: "timeseries",
          aggregations: { events_count: "COUNT" },
        },
      },
    });

    const series = await m.getSeries("24h", "h");

    expect(series).toHaveProperty("events_count");
    expect(Array.isArray(series.events_count)).toBe(true);
  });

  it("getSeries with date range", async () => {
    (client.ts.range as any).mockResolvedValue([
      { timestamp: 1000, value: 5 },
    ]);

    const multiMock = {
      pfAdd: vi.fn(() => undefined),
      pfCount: vi.fn(() => undefined),
      execAsPipeline: vi.fn(async () => [3, 5]),
    };
    (client.multi as any) = vi.fn(() => multiMock);

    const m = defineMetrics({
      prefix: "test:series-range",
      metrics: {
        events: {
          type: "timeseries",
          aggregations: { events_sum: "SUM" },
        },
        unique_users: { type: "hll" },
      },
    });

    const range = { start: new Date("2024-01-01"), end: new Date("2024-01-02") };
    const series = await m.getSeries(range, "h");

    expect(series).toHaveProperty("events_sum");
    expect(series).toHaveProperty("unique_users");
  });

  it("works with only timeseries metrics (no hll/bloom)", async () => {
    (client.ts.range as any).mockResolvedValue([{ timestamp: 1000, value: 99 }]);

    const m = defineMetrics({
      prefix: "test:ts-only",
      metrics: {
        wagered: {
          type: "timeseries",
          config: { duplicatePolicy: "SUM" },
          aggregations: { wagers_total: "SUM", wagers_count: "COUNT" },
        },
      },
    });

    const stats = await m.getStats("1w");
    expect(stats).toHaveProperty("wagers_total");
    expect(stats).toHaveProperty("wagers_count");
  });

  it("works with only hll metrics (no timeseries)", async () => {
    (client.pfCount as any).mockResolvedValue(42);

    const m = defineMetrics({
      prefix: "test:hll-only",
      metrics: {
        unique_users: { type: "hll" },
        unique_sessions: { type: "hll" },
      },
    });

    const stats = await m.getStats("24h");
    expect(stats).toHaveProperty("unique_users");
    expect(stats).toHaveProperty("unique_sessions");
  });

  it("works with bloom-counter metrics", async () => {
    (client.ts.range as any).mockResolvedValue([{ timestamp: 1000, value: 15 }]);

    const m = defineMetrics({
      prefix: "test:bloom",
      metrics: {
        new_items: { type: "bloom-counter" },
      },
    });

    const stats = await m.getStats("1m");
    expect(stats).toHaveProperty("new_items");
  });

  it("getStats with lifetime timeframe", async () => {
    (client.ts.range as any).mockResolvedValue([{ timestamp: 0, value: 500 }]);
    (client.pfCount as any).mockResolvedValue(99);

    const m = defineMetrics({
      prefix: "test:lifetime",
      metrics: {
        events: {
          type: "timeseries",
          aggregations: { events_total: "COUNT" },
        },
        unique_users: { type: "hll" },
      },
    });

    const stats = await m.getStats("lifetime");
    expect(stats).toHaveProperty("events_total");
    expect(stats).toHaveProperty("unique_users");
  });
});
