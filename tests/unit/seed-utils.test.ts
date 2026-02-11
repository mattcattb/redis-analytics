import { describe, expect, it } from "vitest";

import { calcDailyCount, pickRandom } from "../../src/seed/utils";

describe("seed utils", () => {
  it("calcDailyCount scales and rounds daily volume", () => {
    expect(calcDailyCount(10, 2, 1)).toBe(20);
    expect(calcDailyCount(10, 2, 1.25)).toBe(25);
    expect(calcDailyCount(3, 1, 0.49)).toBe(1);
  });

  it("calcDailyCount respects min/max guardrails", () => {
    expect(calcDailyCount(0, 1, 0, { min: 2 })).toBe(2);
    expect(calcDailyCount(1000, 1, 2, { max: 10 })).toBe(10);
  });

  it("pickRandom returns one of the provided values", () => {
    const values = ["a", "b", "c"] as const;
    const picked = pickRandom(values);
    expect(values.includes(picked)).toBe(true);
  });

  it("pickRandom throws for empty values", () => {
    expect(() => pickRandom([])).toThrow(/empty collection/i);
  });
});
