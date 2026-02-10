export type BootstrapTarget = {
  init: () => Promise<void>;
  backfillCompactions?: () => Promise<void>;
};

export type BootstrapOptions = {
  backfillCompactions?: boolean;
};

export async function bootstrapAnalytics(
  targets: BootstrapTarget[],
  options: BootstrapOptions = {}
): Promise<void> {
  if (targets.length === 0) return;

  await Promise.all(targets.map((target) => target.init()));

  if (!options.backfillCompactions) return;

  await Promise.all(
    targets.map(async (target) => {
      if (target.backfillCompactions) {
        await target.backfillCompactions();
      }
    })
  );
}
