import { describe, expectTypeOf, it } from "vitest";
import { analyticsDomain, analyticsMetrics } from "../../src/builder";
import type { AnalyticBucket } from "../../src/types";

describe("analyticsDomain type inference", () => {
  const tx = analyticsDomain("ana:tx")
    .timeseriesStore("amount", {
      dimensions: {
        coin: ["btc", "eth"] as const,
        category: ["deposit", "withdrawal"] as const,
      },
      config: { duplicatePolicy: "SUM" as const },
    })
    .measure("deposits_usd_total", (m) =>
      m.from("amount").agg("SUM").where({ category: "deposit" }).breakdown("coin").done()
    )
    .measure("withdrawals_total", (m) =>
      m.from("amount").agg("COUNT").where({ category: "withdrawal" }).done()
    )
    .build();

  it("infers stats and series result shapes", () => {
    type Stats = Awaited<ReturnType<typeof tx.stats>>;
    type Series = Awaited<ReturnType<typeof tx.series>>;

    expectTypeOf<Stats["deposits_usd_total"]>().toEqualTypeOf<{
      overall: number;
      breakdown: Record<"btc" | "eth", number>;
    }>();
    expectTypeOf<Stats["withdrawals_total"]>().toBeNumber();

    expectTypeOf<Series["deposits_usd_total"]>().toEqualTypeOf<{
      overall: AnalyticBucket[];
      breakdown: Record<"btc" | "eth", AnalyticBucket[]>;
    }>();
    expectTypeOf<Series["withdrawals_total"]>().toEqualTypeOf<AnalyticBucket[]>();
  });

  it("infers selected query output keys", () => {
    const selected = tx.query("deposits_usd_total");
    type SelectedStats = Awaited<ReturnType<typeof selected.stats>>;

    expectTypeOf<SelectedStats>().toEqualTypeOf<{
      deposits_usd_total: {
        overall: number;
        breakdown: Record<"btc" | "eth", number>;
      };
    }>();
  });

  it("infers typed record dimensions", () => {
    tx.record("amount", [
      {
        timestamp: new Date(),
        value: 10,
        dimensions: {
          coin: "btc",
          category: "deposit",
        },
      },
    ]);
  });
});

describe("analyticsMetrics type inference", () => {
  const tipping = analyticsMetrics("ana:tip")
    .timeseriesMetric("tips", {
      config: { duplicatePolicy: "SUM" as const },
      aggregations: {
        tips_usd_total: "SUM" as const,
        tips_total: "COUNT" as const,
      },
    })
    .hllMetric("tippers_unique_total")
    .build();

  it("infers flat stats and series result shapes", () => {
    type Stats = Awaited<ReturnType<typeof tipping.stats>>;
    type Series = Awaited<ReturnType<typeof tipping.series>>;

    expectTypeOf<Stats>().toEqualTypeOf<{
      tips_usd_total: number;
      tips_total: number;
      tippers_unique_total: number;
    }>();

    expectTypeOf<Series>().toEqualTypeOf<{
      tips_usd_total: AnalyticBucket[];
      tips_total: AnalyticBucket[];
      tippers_unique_total: AnalyticBucket[];
    }>();
  });

  it("infers typed record points by metric kind", () => {
    tipping.record("tips", [
      {
        timestamp: new Date(),
        value: 10,
      },
    ]);

    tipping.record("tippers_unique_total", [
      {
        id: "user-1",
        timestamp: new Date(),
      },
    ]);
  });
});
