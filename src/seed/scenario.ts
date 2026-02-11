import { defaultRangeFromDays } from "./utils";
import type { SeedContext, SeedResult, SeedScenario, SeedTarget } from "./types";

export type SeedOperation<
  TContext extends SeedContext,
  TTarget extends SeedTarget,
> = {
  target: TTarget;
  run: (context: TContext) => Promise<number>;
};

export type SeedCommand = "seed" | "backfill" | "status";

export type RunSeedScenarioOptions<TTarget extends SeedTarget> = {
  command: SeedCommand;
  target: TTarget;
  days: number;
  scale: number;
};

export type RunSeedScenarioResult<
  TContext,
  TTarget extends SeedTarget,
  TStatus,
> =
  | {
      command: "seed";
      target: TTarget;
      context: TContext;
      results: SeedResult<TTarget>[];
    }
  | {
      command: "backfill";
      ok: true;
    }
  | {
      command: "status";
      status: TStatus;
    };

export function createSeedScenario<
  TContext extends SeedContext,
  TTarget extends SeedTarget,
  TStatus,
>(config: {
  init?: () => Promise<void>;
  createContext?: (days: number, scale: number) => TContext;
  operations: Record<TTarget, (context: TContext) => Promise<number>>;
  backfill?: () => Promise<void>;
  status?: () => Promise<TStatus>;
  allTargetName?: TTarget | "all";
}): SeedScenario<TContext, TTarget | "all", TStatus | Record<string, never>> {
  let initPromise: Promise<void> | null = null;
  const allTargetName = config.allTargetName ?? "all";

  const ensureInit = async () => {
    if (!config.init) return;
    if (!initPromise) {
      initPromise = config.init();
    }
    await initPromise;
  };

  const operationKeys = Object.keys(config.operations) as TTarget[];

  return {
    createContext(days: number, scale: number): TContext {
      if (config.createContext) {
        return config.createContext(days, scale);
      }
      const range = defaultRangeFromDays(days);
      return { range, scale } as TContext;
    },

    async seed(target, context): Promise<SeedResult<TTarget | "all">[]> {
      await ensureInit();
      const results: SeedResult<TTarget | "all">[] = [];

      if (target === allTargetName) {
        await Promise.all(
          operationKeys.map(async (name) => {
            const count = await config.operations[name](context);
            results.push({ target: name, count });
          })
        );
        return results;
      }

      const operation = config.operations[target as TTarget];
      if (!operation) {
        throw new Error(
          `Unknown seed target "${String(target)}". Known targets: ${operationKeys.join(", ")}`
        );
      }

      const count = await operation(context);
      results.push({ target, count });
      return results;
    },

    async backfill(): Promise<void> {
      await ensureInit();
      if (config.backfill) {
        await config.backfill();
      }
    },

    async status(): Promise<TStatus | Record<string, never>> {
      await ensureInit();
      if (config.status) {
        return await config.status();
      }
      return {};
    },
  };
}

export async function runSeedScenario<
  TContext,
  TTarget extends SeedTarget,
  TStatus,
>(
  scenario: SeedScenario<TContext, TTarget, TStatus>,
  options: RunSeedScenarioOptions<TTarget>
): Promise<RunSeedScenarioResult<TContext, TTarget, TStatus>> {
  if (options.command === "seed") {
    const context = scenario.createContext(options.days, options.scale);
    const results = await scenario.seed(options.target, context);
    return {
      command: "seed",
      target: options.target,
      context,
      results,
    };
  }

  if (options.command === "backfill") {
    await scenario.backfill();
    return { command: "backfill", ok: true };
  }

  const status = await scenario.status();
  return { command: "status", status };
}
