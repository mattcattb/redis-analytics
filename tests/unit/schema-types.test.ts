import { describe, it, expectTypeOf } from "vitest";
import { defineMetrics, type InferStats, type InferSeries } from "../../src/schema";
import type { AnalyticBucket } from "../../src/types";
import type { TimeseriesStore } from "../../src/store/store.timeseries";
import type { HllStore } from "../../src/store/store.hll";
import type { BloomCounterStore } from "../../src/store/store.bloom-counter";

describe("defineMetrics type inference", () => {
  const metricsDef = {
    prefix: "test",
    metrics: {
      tips: {
        type: "timeseries" as const,
        config: { duplicatePolicy: "SUM" as const },
        aggregations: {
          tips_usd_total: "SUM" as const,
          tips_total: "COUNT" as const,
          tips_usd_avg: "AVG" as const,
        },
      },
      fees: {
        type: "timeseries" as const,
        config: { duplicatePolicy: "SUM" as const },
        aggregations: {
          fees_usd_total: "SUM" as const,
          fees_usd_avg: "AVG" as const,
        },
      },
      unique_tippers: { type: "hll" as const },
      unique_tippees: { type: "hll" as const },
      new_users: { type: "bloom-counter" as const },
    },
  } as const;

  type Def = typeof metricsDef.metrics;

  it("InferStats produces correct keys", () => {
    type Stats = InferStats<Def>;

    expectTypeOf<Stats>().toHaveProperty("tips_usd_total");
    expectTypeOf<Stats>().toHaveProperty("tips_total");
    expectTypeOf<Stats>().toHaveProperty("tips_usd_avg");
    expectTypeOf<Stats>().toHaveProperty("fees_usd_total");
    expectTypeOf<Stats>().toHaveProperty("fees_usd_avg");
    expectTypeOf<Stats>().toHaveProperty("unique_tippers");
    expectTypeOf<Stats>().toHaveProperty("unique_tippees");
    expectTypeOf<Stats>().toHaveProperty("new_users");
  });

  it("InferStats values are all numbers", () => {
    type Stats = InferStats<Def>;

    expectTypeOf<Stats["tips_usd_total"]>().toBeNumber();
    expectTypeOf<Stats["unique_tippers"]>().toBeNumber();
    expectTypeOf<Stats["new_users"]>().toBeNumber();
  });

  it("InferSeries produces correct keys with AnalyticBucket[] values", () => {
    type Series = InferSeries<Def>;

    expectTypeOf<Series["tips_usd_total"]>().toEqualTypeOf<AnalyticBucket[]>();
    expectTypeOf<Series["unique_tippers"]>().toEqualTypeOf<AnalyticBucket[]>();
    expectTypeOf<Series["new_users"]>().toEqualTypeOf<AnalyticBucket[]>();
  });

  it("stores have correct types", () => {
    const m = defineMetrics(metricsDef);

    expectTypeOf(m.stores.tips).toEqualTypeOf<TimeseriesStore>();
    expectTypeOf(m.stores.fees).toEqualTypeOf<TimeseriesStore>();
    expectTypeOf(m.stores.unique_tippers).toEqualTypeOf<HllStore>();
    expectTypeOf(m.stores.unique_tippees).toEqualTypeOf<HllStore>();
    expectTypeOf(m.stores.new_users).toEqualTypeOf<BloomCounterStore>();
  });

  it("timeseries-only definition infers correctly", () => {
    type TsOnly = {
      wagered: {
        type: "timeseries";
        aggregations: { wagers_total: "SUM"; wagers_count: "COUNT" };
      };
    };

    type Stats = InferStats<TsOnly>;
    expectTypeOf<Stats>().toHaveProperty("wagers_total");
    expectTypeOf<Stats>().toHaveProperty("wagers_count");
    expectTypeOf<Stats["wagers_total"]>().toBeNumber();
  });

  it("hll-only definition infers metric name as key", () => {
    type HllOnly = {
      unique_users: { type: "hll" };
      unique_sessions: { type: "hll" };
    };

    type Stats = InferStats<HllOnly>;
    expectTypeOf<Stats>().toHaveProperty("unique_users");
    expectTypeOf<Stats>().toHaveProperty("unique_sessions");
  });
});
