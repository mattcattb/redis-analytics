import { describe, expect, it, vi, beforeEach } from "vitest";
import { dimensionalQuery, groupedQuery } from "../../src/query/ts-query.dim";
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

describe("dimensionalQuery", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    setRedisAnalyticsClient(client);
  });

  it("lifetime() returns aggregated value", async () => {
    (client.ts.mRangeWithLabelsGroupBy as any).mockResolvedValue(
      Object.entries({
        "key1": {
          labels: { baseKey: "test" },
          samples: [{ timestamp: 0, value: 100 }],
        },
      }).map(([key, data]) => ({ key, ...data }))
    );

    const q = dimensionalQuery({
      filter: { baseKey: "test" },
      agg: "SUM",
    });

    const result = await q.lifetime();
    expect(typeof result).toBe("number");
  });

  it("range() returns aggregated value", async () => {
    (client.ts.mRangeWithLabelsGroupBy as any).mockResolvedValue([
      {
        key: "k1",
        labels: { baseKey: "test" },
        samples: [{ timestamp: 0, value: 50 }],
      },
    ]);

    const q = dimensionalQuery({
      filter: { baseKey: "test" },
      agg: "SUM",
    });

    const range = { start: new Date("2024-01-01"), end: new Date("2024-01-31") };
    const result = await q.range(range);
    expect(result).toBe(50);
  });

  it("timeframe() delegates to lifetime for 'lifetime'", async () => {
    (client.ts.mRangeWithLabelsGroupBy as any).mockResolvedValue([]);

    const q = dimensionalQuery({
      filter: { baseKey: "test" },
      agg: "SUM",
    });

    const result = await q.timeframe("lifetime");
    expect(result).toBe(0);
  });

  it("returns 0 when no results", async () => {
    (client.ts.mRangeWithLabelsGroupBy as any).mockResolvedValue([]);

    const q = dimensionalQuery({
      filter: { baseKey: "test" },
      agg: "SUM",
    });

    const result = await q.lifetime();
    expect(result).toBe(0);
  });

  it("buckets() returns AnalyticBucket[]", async () => {
    (client.ts.mRangeWithLabelsGroupBy as any).mockResolvedValue([
      {
        key: "k1",
        labels: { baseKey: "test" },
        samples: [
          { timestamp: 1000, value: 5 },
          { timestamp: 2000, value: 10 },
        ],
      },
    ]);

    const q = dimensionalQuery({
      filter: { baseKey: "test" },
      agg: "SUM",
    });

    const range = { start: new Date("2024-01-01"), end: new Date("2024-01-02") };
    const result = await q.buckets(range, "h");
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0][1]).toBe(5);
  });
});

describe("groupedQuery", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    setRedisAnalyticsClient(client);
  });

  it("range() returns grouped results", async () => {
    (client.ts.mRangeWithLabelsGroupBy as any).mockResolvedValue([
      {
        key: "k1",
        labels: { chain: "solana" },
        samples: [{ timestamp: 0, value: 100 }],
      },
      {
        key: "k2",
        labels: { chain: "ethereum" },
        samples: [{ timestamp: 0, value: 200 }],
      },
    ]);

    const q = groupedQuery({
      filter: { baseKey: "test" },
      agg: "SUM",
      groupBy: "chain",
      values: ["solana", "ethereum"] as const,
    });

    const range = { start: new Date("2024-01-01"), end: new Date("2024-01-31") };
    const result = await q.range(range);

    expect(result.solana).toBe(100);
    expect(result.ethereum).toBe(200);
  });

  it("initializes all values to 0", async () => {
    (client.ts.mRangeWithLabelsGroupBy as any).mockResolvedValue([]);

    const q = groupedQuery({
      filter: { baseKey: "test" },
      agg: "SUM",
      groupBy: "chain",
      values: ["solana", "ethereum"] as const,
    });

    const range = { start: new Date("2024-01-01"), end: new Date("2024-01-31") };
    const result = await q.range(range);

    expect(result.solana).toBe(0);
    expect(result.ethereum).toBe(0);
  });

  it("resolves canonical key from case-insensitive match", async () => {
    (client.ts.mRangeWithLabelsGroupBy as any).mockResolvedValue([
      {
        key: "k1",
        labels: { chain: "Solana" },
        samples: [{ timestamp: 0, value: 100 }],
      },
    ]);

    const q = groupedQuery({
      filter: { baseKey: "test" },
      agg: "SUM",
      groupBy: "chain",
      values: ["solana", "ethereum"] as const,
    });

    const range = { start: new Date("2024-01-01"), end: new Date("2024-01-31") };
    const result = await q.range(range);

    expect(result.solana).toBe(100);
  });

  it("timeframe() delegates to lifetime for 'lifetime'", async () => {
    (client.ts.mRangeWithLabelsGroupBy as any).mockResolvedValue([]);

    const q = groupedQuery({
      filter: { baseKey: "test" },
      agg: "SUM",
      groupBy: "chain",
      values: ["solana"] as const,
    });

    const result = await q.timeframe("lifetime");
    expect(result.solana).toBe(0);
  });

  it("buckets() returns grouped AnalyticBucket[]", async () => {
    (client.ts.mRangeWithLabelsGroupBy as any).mockResolvedValue([
      {
        key: "k1",
        labels: { chain: "solana" },
        samples: [
          { timestamp: 1000, value: 5 },
          { timestamp: 2000, value: 10 },
        ],
      },
    ]);

    const q = groupedQuery({
      filter: { baseKey: "test" },
      agg: "SUM",
      groupBy: "chain",
      values: ["solana", "ethereum"] as const,
    });

    const range = { start: new Date("2024-01-01"), end: new Date("2024-01-02") };
    const result = await q.buckets(range, "h");

    expect(result.solana).toHaveLength(2);
    expect(result.ethereum).toHaveLength(0);
  });
});
