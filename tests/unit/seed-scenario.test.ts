import { describe, expect, it, vi } from "vitest";

import { createSeedScenario } from "../../src/seed/scenario";

describe("createSeedScenario", () => {
  it("runs all target operations", async () => {
    const init = vi.fn(async () => undefined);
    const seedUser = vi.fn(async () => 4);
    const seedTx = vi.fn(async () => 7);

    const scenario = createSeedScenario({
      init,
      operations: {
        user: seedUser,
        tx: seedTx,
      },
      status: async () => ({ ok: true }),
    });

    const ctx = scenario.createContext(30, 2);
    const results = await scenario.seed("all", ctx);
    const targets = results.map((r) => r.target).sort();

    expect(init).toHaveBeenCalledTimes(1);
    expect(seedUser).toHaveBeenCalledTimes(1);
    expect(seedTx).toHaveBeenCalledTimes(1);
    expect(targets).toEqual(["tx", "user"]);
  });

  it("runs a single target operation", async () => {
    const seedUser = vi.fn(async () => 2);
    const seedTx = vi.fn(async () => 5);

    const scenario = createSeedScenario({
      operations: {
        user: seedUser,
        tx: seedTx,
      },
    });

    const ctx = scenario.createContext(7, 1);
    const results = await scenario.seed("tx", ctx);

    expect(seedUser).toHaveBeenCalledTimes(0);
    expect(seedTx).toHaveBeenCalledTimes(1);
    expect(results).toEqual([{ target: "tx", count: 5 }]);
  });
});
