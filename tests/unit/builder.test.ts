import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyticsDomain, analyticsMetrics } from "../../src/builder";
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

describe("analyticsDomain builder", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    setRedisAnalyticsClient(client);
  });

  it("builds typed metrics and supports stats/series/query selection", async () => {
    (client.ts.mRangeWithLabelsGroupBy as any).mockImplementation(
      async (_from: number | "-", _to: number | "+", filters: string[], groupBy: any, options: any) => {
        const isDeposit = filters.some((f) => f.includes("category=deposit"));
        const bucket = options?.AGGREGATION?.timeBucket ?? 0;

        if (groupBy.label === "baseKey") {
          if (isDeposit) {
            return {
              overall: {
                labels: { baseKey: "ana:tx:amount" },
                samples:
                  bucket === 3600000
                    ? [
                        { timestamp: 1000, value: 100 },
                        { timestamp: 2000, value: 50 },
                      ]
                    : [{ timestamp: 1000, value: 150 }],
              },
            };
          }

          return {
            overall: {
              labels: { baseKey: "ana:tx:amount" },
              samples:
                bucket === 3600000
                  ? [
                      { timestamp: 1000, value: 4 },
                      { timestamp: 2000, value: 3 },
                    ]
                  : [{ timestamp: 1000, value: 7 }],
            },
          };
        }

        if (groupBy.label === "coin") {
          return {
            btc: {
              labels: { coin: "btc" },
              samples:
                bucket === 3600000
                  ? [
                      { timestamp: 1000, value: 90 },
                      { timestamp: 2000, value: 40 },
                    ]
                  : [{ timestamp: 1000, value: 130 }],
            },
            eth: {
              labels: { coin: "eth" },
              samples:
                bucket === 3600000
                  ? [
                      { timestamp: 1000, value: 10 },
                      { timestamp: 2000, value: 10 },
                    ]
                  : [{ timestamp: 1000, value: 20 }],
            },
          };
        }

        return {};
      }
    );

    const tx = analyticsDomain("ana:tx")
      .timeseriesStore("amount", {
        dimensions: {
          coin: ["btc", "eth"] as const,
          category: ["deposit", "withdrawal"] as const,
        },
        config: { duplicatePolicy: "SUM" },
      })
      .measure("deposits_usd_total", (m) =>
        m.from("amount").agg("SUM").where({ category: "deposit" }).breakdown("coin").done()
      )
      .measure("withdrawals_total", (m) =>
        m.from("amount").agg("COUNT").where({ category: "withdrawal" }).done()
      )
      .build();

    await tx.init();
    expect(client.ts.create).toHaveBeenCalled();

    const stats = await tx.stats("24h");
    expect(stats.deposits_usd_total.overall).toBe(150);
    expect(stats.deposits_usd_total.breakdown.btc).toBe(130);
    expect(stats.withdrawals_total).toBe(7);

    const selected = await tx.query("withdrawals_total").stats("24h");
    expect(Object.keys(selected)).toEqual(["withdrawals_total"]);
    expect(selected.withdrawals_total).toBe(7);

    const series = await tx.query("deposits_usd_total").series("24h", "h");
    expect(series.deposits_usd_total.overall).toHaveLength(2);
    expect(series.deposits_usd_total.breakdown.eth).toHaveLength(2);

    await tx.record("amount", [
      {
        timestamp: new Date(),
        value: 12,
        dimensions: { coin: "btc", category: "deposit" },
      },
    ]);
    expect(client.ts.mAdd).toHaveBeenCalled();
  });

  it("computes change over previous period", async () => {
    const current = {
      start: new Date("2025-02-10T00:00:00.000Z"),
      end: new Date("2025-02-11T00:00:00.000Z"),
    };
    const previousStart = new Date("2025-02-09T00:00:00.000Z").getTime();
    const currentStart = current.start.getTime();

    (client.ts.mRangeWithLabelsGroupBy as any).mockImplementation(
      async (from: number, _to: number, _filters: string[], groupBy: any) => {
        if (groupBy.label !== "baseKey") return {};

        if (from === currentStart) {
          return {
            overall: {
              labels: { baseKey: "ana:tx:amount" },
              samples: [{ timestamp: 1000, value: 10 }],
            },
          };
        }

        if (from === previousStart) {
          return {
            overall: {
              labels: { baseKey: "ana:tx:amount" },
              samples: [{ timestamp: 1000, value: 5 }],
            },
          };
        }

        return {
          overall: {
            labels: { baseKey: "ana:tx:amount" },
            samples: [{ timestamp: 1000, value: 0 }],
          },
        };
      }
    );

    const tx = analyticsDomain("ana:tx")
      .timeseriesStore("amount", {
        dimensions: {
          coin: ["btc", "eth"] as const,
          category: ["deposit", "withdrawal"] as const,
        },
      })
      .measure("withdrawals_total", (m) =>
        m.from("amount").agg("COUNT").where({ category: "withdrawal" }).done()
      )
      .build();

    const change = await tx.query("withdrawals_total").change(current);
    expect(change.current.withdrawals_total).toBe(10);
    expect(change.previous.withdrawals_total).toBe(5);
    expect(change.absolute.withdrawals_total).toBe(5);
    expect(change.percent.withdrawals_total.status).toBe("increase");
  });

  it("requires previousScope for lifetime change", async () => {
    const tx = analyticsDomain("ana:tx")
      .timeseriesStore("amount", {
        dimensions: {
          coin: ["btc", "eth"] as const,
          category: ["deposit", "withdrawal"] as const,
        },
      })
      .measure("withdrawals_total", (m) =>
        m.from("amount").agg("COUNT").where({ category: "withdrawal" }).done()
      )
      .build();

    await expect(tx.change("lifetime")).rejects.toThrow(
      /Cannot infer previous period for "lifetime"/
    );
  });

  it("builds scalar metrics with timeseries aggregations", async () => {
    (client.ts.range as any).mockImplementation(
      async (
        _key: string,
        _from: number | "-",
        _to: number | "+",
        options?: {
          AGGREGATION?: {
            type?: string;
            timeBucket?: number;
            EMPTY?: boolean;
          };
        }
      ) => {
        const agg = options?.AGGREGATION?.type;
        const isBucketed = options?.AGGREGATION?.EMPTY === true;

        if (isBucketed) {
          if (agg === "SUM") {
            return [
              { timestamp: 1000, value: 90 },
              { timestamp: 2000, value: 30 },
            ];
          }
          if (agg === "COUNT") {
            return [
              { timestamp: 1000, value: 4 },
              { timestamp: 2000, value: 2 },
            ];
          }
          return [];
        }

        if (agg === "SUM") return [{ timestamp: 1000, value: 120 }];
        if (agg === "COUNT") return [{ timestamp: 1000, value: 6 }];
        return [];
      }
    );

    const roll = analyticsMetrics("ana:roll")
      .timeseriesMetric("wagered", {
        config: { duplicatePolicy: "SUM" },
        aggregations: {
          wagers_usd_total: "SUM",
          rolls_total: "COUNT",
        },
      })
      .build();

    await roll.init();
    expect(client.ts.create).toHaveBeenCalled();

    const stats = await roll.stats("24h");
    expect(stats.wagers_usd_total).toBe(120);
    expect(stats.rolls_total).toBe(6);

    const series = await roll.series("24h", "h");
    expect(series.wagers_usd_total).toHaveLength(2);
    expect(series.rolls_total).toHaveLength(2);

    await roll.record("wagered", [{ timestamp: new Date(), value: 50 }]);
    expect(client.ts.mAdd).toHaveBeenCalled();

    await roll.backfillCompactions("wagered");
  });

  it("supports scalar hll metrics", async () => {
    (client.pfCount as any).mockResolvedValue(9);

    const users = analyticsMetrics("ana:user")
      .hllMetric("users_unique_total")
      .build();

    await users.record("users_unique_total", [
      {
        id: "user-1",
        timestamp: new Date(),
      },
    ]);

    const stats = await users.stats("24h");
    expect(stats.users_unique_total).toBe(9);
    expect(client.pfCount).toHaveBeenCalled();
  });
});
