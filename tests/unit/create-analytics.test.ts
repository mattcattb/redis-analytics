import { describe, expect, it } from "vitest";

import { createAnalytics } from "../../src/app";
import { getRedisAnalyticsCapabilities, setRedisAnalyticsClient } from "../../src/client";
import type { RedisAnalyticsClient } from "../../src/client";

function createMockClient(onTsAdd: (points: Array<{ key: string; timestamp: number; value: number }>) => void): RedisAnalyticsClient {
  return {
    bf: {
      reserve: async () => undefined,
      mAdd: async () => [true],
      mExists: async () => [true],
    },
    ts: {
      create: async () => undefined,
      alter: async () => undefined,
      createRule: async () => undefined,
      mAdd: async (points) => {
        onTsAdd(points);
      },
      range: async () => [],
      mRangeWithLabels: async () => ({}),
      mRangeWithLabelsGroupBy: async () => ({}),
    },
    pfAdd: async () => undefined,
    pfCount: async () => 0,
    pfMerge: async () => undefined,
    expire: async () => undefined,
    multi: () => ({
      pfAdd: () => undefined,
      pfCount: () => undefined,
      execAsPipeline: async () => undefined,
    }),
  };
}

describe("createAnalytics", () => {
  it("binds service calls to the instance client context", async () => {
    const callsA: string[] = [];
    const callsB: string[] = [];

    const analyticsA = createAnalytics({
      client: createMockClient((points) => callsA.push(points[0].key)),
    });
    const analyticsB = createAnalytics({
      client: createMockClient((points) => callsB.push(points[0].key)),
    });

    await analyticsA.services.timeseries.add([
      { key: "a:key", timestamp: 1, value: 1 },
    ]);
    await analyticsB.services.timeseries.add([
      { key: "b:key", timestamp: 1, value: 1 },
    ]);

    expect(callsA).toEqual(["a:key"]);
    expect(callsB).toEqual(["b:key"]);
  });

  it("applies per-instance capabilities", () => {
    setRedisAnalyticsClient(
      createMockClient(() => undefined)
    );

    const analytics = createAnalytics({
      client: createMockClient(() => undefined),
      capabilities: { supportsNativeGroupBy: false },
    });

    const globalCaps = getRedisAnalyticsCapabilities();
    const localCaps = analytics.run(() => getRedisAnalyticsCapabilities());

    expect(globalCaps.supportsNativeGroupBy).toBe(true);
    expect(localCaps.supportsNativeGroupBy).toBe(false);
  });
});
