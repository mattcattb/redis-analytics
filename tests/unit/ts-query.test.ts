import { describe, expect, it, vi, beforeEach } from "vitest";
import { ts, tsQuery } from "../../src/query/ts-query.standard";
import { setRedisAnalyticsClient } from "../../src/client";
import type { RedisAnalyticsClient } from "../../src/client";

function createMockClient(): RedisAnalyticsClient {
  return {
    bf: {
      reserve: vi.fn(async () => undefined),
      mAdd: vi.fn(async () => []),
      mExists: vi.fn(async () => []),
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

describe("tsQuery", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    setRedisAnalyticsClient(client);
  });

  it("ts() creates a metric definition", () => {
    const def = ts("my:key", "SUM");
    expect(def).toEqual({ key: "my:key", agg: "SUM" });
  });

  it("lifetime() queries all data", async () => {
    (client.ts.range as any).mockResolvedValue([{ timestamp: 0, value: 100 }]);

    const q = tsQuery({
      total: ts("key1", "SUM"),
    });

    const result = await q.lifetime();
    expect(result).toHaveProperty("total");
    expect(result.total).toBe(100);

    expect(client.ts.range).toHaveBeenCalledWith(
      "key1",
      "-",
      "+",
      expect.objectContaining({
        AGGREGATION: expect.objectContaining({
          type: "SUM",
        }),
      })
    );
  });

  it("range() queries a date range", async () => {
    (client.ts.range as any).mockResolvedValue([{ timestamp: 1000, value: 50 }]);

    const q = tsQuery({
      count: ts("key1", "COUNT"),
    });

    const range = { start: new Date("2024-01-01"), end: new Date("2024-01-31") };
    const result = await q.range(range);
    expect(result.count).toBe(50);
  });

  it("timeframe() delegates to lifetime for 'lifetime'", async () => {
    (client.ts.range as any).mockResolvedValue([{ timestamp: 0, value: 200 }]);

    const q = tsQuery({
      total: ts("key1", "SUM"),
    });

    const result = await q.timeframe("lifetime");
    expect(result.total).toBe(200);
  });

  it("timeframe() delegates to range for non-lifetime", async () => {
    (client.ts.range as any).mockResolvedValue([{ timestamp: 0, value: 75 }]);

    const q = tsQuery({
      total: ts("key1", "SUM"),
    });

    const result = await q.timeframe("24h");
    expect(result.total).toBe(75);
  });

  it("handles multiple metrics in parallel", async () => {
    let callCount = 0;
    (client.ts.range as any).mockImplementation(async () => {
      callCount++;
      return [{ timestamp: 0, value: callCount * 10 }];
    });

    const q = tsQuery({
      total: ts("key1", "SUM"),
      avg: ts("key2", "AVG"),
    });

    const result = await q.lifetime();
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("avg");
    expect(client.ts.range).toHaveBeenCalledTimes(2);
  });

  it("returns 0 when no data points", async () => {
    (client.ts.range as any).mockResolvedValue([]);

    const q = tsQuery({ total: ts("key1", "SUM") });
    const result = await q.lifetime();
    expect(result.total).toBe(0);
  });

  it("buckets() returns bucketed data", async () => {
    (client.ts.range as any).mockResolvedValue([
      { timestamp: 1000, value: 5 },
      { timestamp: 2000, value: 10 },
    ]);

    const q = tsQuery({ total: ts("key1", "SUM") });
    const range = { start: new Date("2024-01-01"), end: new Date("2024-01-02") };
    const result = await q.buckets(range, "h");

    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.total)).toBe(true);
    expect(result.total).toHaveLength(2);
  });

  it("bucketsByTimeframe() delegates to lifetimeBuckets for 'lifetime'", async () => {
    (client.ts.range as any).mockResolvedValue([]);

    const q = tsQuery({ total: ts("key1", "SUM") });
    const result = await q.bucketsByTimeframe("lifetime", "m");

    expect(result).toHaveProperty("total");
  });

  it("bucketsByTimeframe() delegates to buckets for non-lifetime", async () => {
    (client.ts.range as any).mockResolvedValue([]);

    const q = tsQuery({ total: ts("key1", "SUM") });
    const result = await q.bucketsByTimeframe("1w", "d");

    expect(result).toHaveProperty("total");
  });
});
