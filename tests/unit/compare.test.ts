import { describe, expect, it } from "vitest";
import { buildPercentChangeTree, calculatePercentChange } from "../../src/compare";

describe("calculatePercentChange", () => {
  it("returns increase/decrease/no_change", () => {
    expect(calculatePercentChange(20, 10)).toEqual({ status: "increase", value: 100 });
    expect(calculatePercentChange(10, 20)).toEqual({ status: "decrease", value: -50 });
    expect(calculatePercentChange(10, 10)).toEqual({ status: "no_change", value: 0 });
  });

  it("handles zero edge cases", () => {
    expect(calculatePercentChange(5, 0)).toEqual({ status: "new", value: null });
    expect(calculatePercentChange(0, 0)).toEqual({ status: "stable_at_zero", value: 0 });
    expect(calculatePercentChange(0, 5)).toEqual({ status: "vanished", value: -100 });
  });

  it("returns unavailable for non-numeric values", () => {
    expect(calculatePercentChange("abc", 10)).toEqual({
      status: "unavailable",
      value: null,
    });
  });
});

describe("buildPercentChangeTree", () => {
  it("builds nested percent change results", () => {
    const current = {
      total: 200,
      users: {
        overall: 120,
        active: 80,
      },
    };

    const previous = {
      total: 100,
      users: {
        overall: 120,
        active: 40,
      },
    };

    expect(buildPercentChangeTree(current, previous)).toEqual({
      total: { status: "increase", value: 100 },
      users: {
        overall: { status: "no_change", value: 0 },
        active: { status: "increase", value: 100 },
      },
    });
  });
});
