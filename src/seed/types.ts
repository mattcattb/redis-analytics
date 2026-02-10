export type SeedTarget = string;

export type SeedResult<TTarget extends SeedTarget = SeedTarget> = {
  target: TTarget;
  count: number;
};

export type SeedContext = {
  range: { start: Date; end: Date };
  scale: number;
};

export type SeedHandler<TContext, TTarget extends SeedTarget> = (
  target: TTarget,
  context: TContext
) => Promise<SeedResult<TTarget>[]>;

export type BackfillHandler = () => Promise<void>;
export type StatusHandler<TStatus> = () => Promise<TStatus>;

export type SeedScenario<TContext, TTarget extends SeedTarget, TStatus> = {
  createContext: (days: number, scale: number) => TContext;
  seed: SeedHandler<TContext, TTarget>;
  backfill: BackfillHandler;
  status: StatusHandler<TStatus>;
};

export type SeedModule<TContext, TTarget extends SeedTarget, TStatus> =
  | SeedScenario<TContext, TTarget, TStatus>
  | {
      default: SeedScenario<TContext, TTarget, TStatus>;
    }
  | {
      scenario: SeedScenario<TContext, TTarget, TStatus>;
    };
