import { describe, expect, it } from "vitest";

import { createDimensionalMetric, mapMetricConfig } from "../../src/metric-registry";

describe("metric registry", () => {
  const txAmount = createDimensionalMetric({
    prefix: "ana:tx",
    suffix: "amount",
    dimensions: [
      { name: "coin", values: ["btc", "eth"] as const },
      { name: "category", values: ["deposit", "withdrawal"] as const },
    ] as const,
    staticLabels: { service: "tx" },
  });

  it("creates stable keys and labels", () => {
    const key = txAmount.key({ coin: "btc", category: "deposit" });
    const labels = txAmount.labels({ coin: "btc", category: "deposit" });

    expect(key).toBe("ana:tx:amount:coin=btc:category=deposit");
    expect(labels).toEqual({
      baseKey: "ana:tx:amount",
      service: "tx",
      coin: "btc",
      category: "deposit",
    });
  });

  it("rejects unknown dimension values to prevent key drift", () => {
    expect(() =>
      txAmount.key({ coin: "doge" as never, category: "deposit" })
    ).toThrow(/Invalid value/);
  });

  it("builds typed filters", () => {
    const filter = txAmount.filter({ category: "deposit", coin: ["btc", "eth"] });
    expect(filter).toEqual({
      baseKey: "ana:tx:amount",
      service: "tx",
      category: "deposit",
      coin: ["btc", "eth"],
    });
  });

  it("maps metric config like the original API pattern", () => {
    const config = {
      deposits_total: { category: "deposit", agg: "COUNT" as const },
      withdrawals_total: { category: "withdrawal", agg: "COUNT" as const },
    };

    const mapped = mapMetricConfig(config, (entry) => ({
      filter: txAmount.filter({ category: entry.category }),
      agg: entry.agg,
    }));

    expect(Object.keys(mapped)).toEqual(["deposits_total", "withdrawals_total"]);
    expect(mapped.deposits_total.filter.category).toBe("deposit");
    expect(mapped.withdrawals_total.filter.category).toBe("withdrawal");
  });
});
