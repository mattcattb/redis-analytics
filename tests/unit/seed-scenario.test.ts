import { describe, expect, it, vi } from "vitest";

import { createSeedScenario, runSeedScenario } from "../../src/seed/scenario";

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

describe("runSeedScenario", () => {
  it("executes seed command using scenario context builder", async () => {
    const scenario = createSeedScenario({
      operations: {
        tx: async () => 3,
      },
    });

    const result = await runSeedScenario(scenario, {
      command: "seed",
      target: "tx",
      days: 14,
      scale: 2,
    });

    expect(result.command).toBe("seed");
    if (result.command !== "seed") return;

    expect(result.context.scale).toBe(2);
    expect(result.results).toEqual([{ target: "tx", count: 3 }]);
  });

  it("executes backfill and status commands", async () => {
    const backfill = vi.fn(async () => undefined);
    const status = vi.fn(async () => ({ ok: true }));
    const scenario = createSeedScenario({
      operations: {
        tx: async () => 1,
      },
      backfill,
      status,
    });

    const backfillResult = await runSeedScenario(scenario, {
      command: "backfill",
      target: "all",
      days: 1,
      scale: 1,
    });
    expect(backfillResult).toEqual({ command: "backfill", ok: true });
    expect(backfill).toHaveBeenCalledTimes(1);

    const statusResult = await runSeedScenario(scenario, {
      command: "status",
      target: "all",
      days: 1,
      scale: 1,
    });
    expect(statusResult).toEqual({ command: "status", status: { ok: true } });
    expect(status).toHaveBeenCalledTimes(1);
  });
});
