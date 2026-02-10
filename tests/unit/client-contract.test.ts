import { describe, expect, it } from "vitest";

import { assertRedisAnalyticsClientContract } from "../../src/client-contract";
import type { RedisAnalyticsClient } from "../../src/client";

function makeValidClient(): RedisAnalyticsClient {
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
      mAdd: async () => undefined,
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

describe("assertRedisAnalyticsClientContract", () => {
  it("accepts a valid client", () => {
    expect(() => assertRedisAnalyticsClientContract(makeValidClient())).not.toThrow();
  });

  it("throws on missing required methods", () => {
    const invalid = makeValidClient() as any;
    delete invalid.ts.range;

    expect(() => assertRedisAnalyticsClientContract(invalid)).toThrow(
      /contract violation/
    );
  });
});
