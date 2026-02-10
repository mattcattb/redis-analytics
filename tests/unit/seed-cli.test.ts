import { describe, expect, it } from "vitest";

import { parseSeedCliArgs } from "../../src/seed/cli";

describe("seed cli arg parser", () => {
  it("parses seed args", () => {
    const args = parseSeedCliArgs([
      "node",
      "seed",
      "seed",
      "tx",
      "--module",
      "./seed.scenario.mjs",
      "--days",
      "90",
      "--scale",
      "4",
    ]);

    expect(args).toEqual({
      modulePath: "./seed.scenario.mjs",
      command: "seed",
      target: "tx",
      days: 90,
      scale: 4,
    });
  });

  it("requires --module", () => {
    expect(() =>
      parseSeedCliArgs(["node", "seed", "seed", "all"])
    ).toThrow(/Missing --module/);
  });
});
