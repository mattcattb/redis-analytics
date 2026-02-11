import { describe, expect, it, vi, beforeEach } from "vitest";
import { TimeseriesStore } from "../../src/store/store.timeseries";
import { HllStore } from "../../src/store/store.hll";
import { BloomCounterStore } from "../../src/store/store.bloom-counter";
import { DimensionalTSStore } from "../../src/store/store.dimentional-ts";
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

describe("TimeseriesStore", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    setRedisAnalyticsClient(client);
  });

  it("init() calls ensureKey", async () => {
    const store = new TimeseriesStore("test:key", { duplicatePolicy: "SUM" });
    await store.init();
    expect(client.ts.create).toHaveBeenCalledWith(
      "test:key",
      expect.objectContaining({
        DUPLICATE_POLICY: "SUM",
      })
    );
  });

  it("does not alter existing key by default", async () => {
    (client.ts.create as any).mockRejectedValueOnce(new Error("key already exists"));

    const store = new TimeseriesStore("test:key", { duplicatePolicy: "SUM" });
    await store.init();

    expect(client.ts.alter).not.toHaveBeenCalled();
  });

  it("can reconcile existing key when explicitly enabled", async () => {
    (client.ts.create as any).mockRejectedValueOnce(new Error("key already exists"));

    const store = new TimeseriesStore("test:key", {
      duplicatePolicy: "SUM",
      reconcileExisting: true,
    });
    await store.init();

    expect(client.ts.alter).toHaveBeenCalledWith(
      "test:key",
      expect.objectContaining({
        DUPLICATE_POLICY: "SUM",
      })
    );
  });

  it("init() initializes compactions", async () => {
    const store = new TimeseriesStore("test:key", { duplicatePolicy: "SUM" });
    store.compact("SUM", "h");
    await store.init();

    // ensureKey for the main key + compaction key
    expect(client.ts.create).toHaveBeenCalledTimes(2);
    expect(client.ts.createRule).toHaveBeenCalled();
  });

  it("compact() generates correct key", () => {
    const store = new TimeseriesStore("test:key", {});
    const compKey = store.compact("SUM", "h");
    expect(compKey).toBe("test:key:SUM");
  });

  it("compact() throws on duplicate", () => {
    const store = new TimeseriesStore("test:key", {});
    store.compact("SUM", "h");
    expect(() => store.compact("SUM", "h")).toThrow("exists");
  });

  it("record() sends points with collision handling", async () => {
    const store = new TimeseriesStore("test:key", {});
    const ts = new Date("2024-01-01T00:00:00Z");

    await store.record([
      { timestamp: ts, value: 1 },
      { timestamp: ts, value: 2 },
    ]);

    expect(client.ts.mAdd).toHaveBeenCalledWith([
      { key: "test:key", timestamp: ts.getTime(), value: 1 },
      { key: "test:key", timestamp: ts.getTime() - 1, value: 2 },
    ]);
  });

  it("record() does nothing for empty array", async () => {
    const store = new TimeseriesStore("test:key", {});
    await store.record([]);
    expect(client.ts.mAdd).not.toHaveBeenCalled();
  });
});

describe("HllStore", () => {
  let client: ReturnType<typeof createMockClient>;
  let multiMock: any;

  beforeEach(() => {
    multiMock = {
      pfAdd: vi.fn(() => undefined),
      pfCount: vi.fn(() => undefined),
      execAsPipeline: vi.fn(async () => undefined),
    };
    client = createMockClient();
    (client.multi as any) = vi.fn(() => multiMock);
    setRedisAnalyticsClient(client);
  });

  it("has correct key", () => {
    const store = new HllStore("test:users");
    expect(store.key).toBe("test:users");
  });

  it("lifetimeKey is key:all", () => {
    const store = new HllStore("test:users");
    expect(store.lifetimeKey).toBe("test:users:all");
  });

  it("init() is a no-op", async () => {
    const store = new HllStore("test:users");
    await store.init();
    // Should not throw
  });

  it("record() sends points to multiple bucket keys", async () => {
    const store = new HllStore("test:users");
    const ts = new Date("2024-03-15T14:30:00Z");

    await store.record([{ id: "user1", timestamp: ts }]);

    // Should call addMulti via pipeline
    expect(multiMock.pfAdd).toHaveBeenCalled();
    expect(multiMock.execAsPipeline).toHaveBeenCalled();
  });

  it("record() does nothing for empty array", async () => {
    const store = new HllStore("test:users");
    await store.record([]);
    expect(multiMock.pfAdd).not.toHaveBeenCalled();
  });

  it("get() with lifetime calls pfCount on lifetime key", async () => {
    (client.pfCount as any).mockResolvedValue(42);

    const store = new HllStore("test:users");
    const result = await store.get("lifetime");
    expect(result).toBe(42);
    expect(client.pfCount).toHaveBeenCalledWith(["test:users:all"]);
  });

  it("get() with timeframe resolves range and counts", async () => {
    (client.pfCount as any).mockResolvedValue(10);

    const store = new HllStore("test:users");
    const result = await store.get("24h");
    expect(typeof result).toBe("number");
  });

  it("total() counts unique over range", async () => {
    (client.pfCount as any).mockResolvedValue(5);

    const store = new HllStore("test:users");
    const range = { start: new Date("2024-01-01"), end: new Date("2024-01-02") };
    const result = await store.total(range);
    expect(typeof result).toBe("number");
  });
});

describe("BloomCounterStore", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    setRedisAnalyticsClient(client);
  });

  it("init() creates bloom filter and timeseries", async () => {
    const store = new BloomCounterStore("test:new-users");
    await store.init();

    expect(client.bf.reserve).toHaveBeenCalled();
    expect(client.ts.create).toHaveBeenCalled();
  });

  it("recordWithResult() checks bloom and records new items", async () => {
    // First call = all new (mAdd returns true for new items)
    (client.bf.mAdd as any).mockResolvedValue([true, true]);

    const store = new BloomCounterStore("test:new-users");
    const ts = new Date("2024-01-01");

    const result = await store.recordWithResult([
      { id: "u1", timestamp: ts },
      { id: "u2", timestamp: ts },
    ]);

    // checkAndRegister inverts: true from mAdd means NOT seen before
    // Actually looking at code: seenBefore = !x, so mAdd returning true means NOT seen
    // newPoints = filter where !seenBefore, seenBefore = !true = false, so new
    // Wait, re-reading: results.map(x => !x), mAdd returns [true, true]
    // seenBefore = [false, false], so all are new
    expect(result).toHaveLength(2);
  });

  it("get() with lifetime sums all counts", async () => {
    (client.ts.range as any).mockResolvedValue([{ timestamp: 0, value: 100 }]);

    const store = new BloomCounterStore("test:new-users");
    const result = await store.get("lifetime");
    expect(result).toBe(100);
  });

  it("get() with timeframe resolves range", async () => {
    (client.ts.range as any).mockResolvedValue([{ timestamp: 0, value: 25 }]);

    const store = new BloomCounterStore("test:new-users");
    const result = await store.get("1w");
    expect(result).toBe(25);
  });
});

describe("DimensionalTSStore", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    setRedisAnalyticsClient(client);
  });

  it("buildKey() generates correct key format", () => {
    const store = new DimensionalTSStore("base:key", [
      { name: "coin" },
      { name: "chain" },
    ]);

    const key = store.buildKey({ coin: "btc", chain: "solana" });
    expect(key).toBe("base:key:coin=btc:chain=solana");
  });

  it("buildKey() throws on missing dimension", () => {
    const store = new DimensionalTSStore("base:key", [
      { name: "coin" },
      { name: "chain" },
    ]);

    expect(() => store.buildKey({ coin: "btc" } as any)).toThrow("Missing dimension");
  });

  it("init() creates keys for all known combinations", async () => {
    const store = new DimensionalTSStore("base:key", [
      { name: "coin", knownValues: ["btc", "eth"] },
      { name: "chain", knownValues: ["solana"] },
    ]);

    await store.init();

    // 2 coins × 1 chain = 2 combinations
    expect(client.ts.create).toHaveBeenCalledTimes(2);
  });

  it("init() is no-op without known values", async () => {
    const store = new DimensionalTSStore("base:key", [{ name: "coin" }]);
    await store.init();
    expect(client.ts.create).not.toHaveBeenCalled();
  });

  it("record() creates missing keys before adding points", async () => {
    const store = new DimensionalTSStore("base:key", [{ name: "coin" }]);
    const ts = new Date("2024-01-01");

    await store.record([{ timestamp: ts, value: 100, dimensions: { coin: "btc" } }]);

    expect(client.ts.create).toHaveBeenCalledTimes(1);
    expect(client.ts.mAdd).toHaveBeenCalledTimes(1);
  });

  it("record() does nothing for empty array", async () => {
    const store = new DimensionalTSStore("base:key", [{ name: "coin" }]);
    await store.record([]);
    expect(client.ts.mAdd).not.toHaveBeenCalled();
  });

  it("filter() returns correct filter object", () => {
    const store = new DimensionalTSStore("base:key", [
      { name: "coin" },
      { name: "chain" },
    ]);

    const f = store.filter({ coin: "btc" });
    expect(f).toEqual({ baseKey: "base:key", coin: "btc" });
  });

  it("filter() without dimensions returns baseKey only", () => {
    const store = new DimensionalTSStore("base:key", [{ name: "coin" }]);
    const f = store.filter();
    expect(f).toEqual({ baseKey: "base:key" });
  });
});
