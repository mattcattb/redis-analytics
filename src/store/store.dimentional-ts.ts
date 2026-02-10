import {
  TimeSeriesService,
  type TSConfig,
  type TSFilter,
} from "../redis/timeseries.service";

export type DimensionalTSPoint<TDim extends string> = {
  timestamp: Date;
  value: number;
  dimensions: Record<TDim, string>;
};

export type DimensionDef<TDim extends string> = {
  name: TDim;
  knownValues?: readonly string[];
};

export class DimensionalTSStore<TDim extends string> {
  public readonly baseKey: string;
  private readonly dimNames: TDim[];
  private knownCombinations: Record<string, string>[] = [];
  private createdKeys = new Set<string>();

  constructor(
    baseKey: string,
    private dimensions: DimensionDef<TDim>[],
    private config: TSConfig = {}
  ) {
    this.baseKey = baseKey;
    this.dimNames = dimensions.map((d) => d.name);
    this.knownCombinations = this.computeKnownCombinations();
  }

  private computeKnownCombinations(): Record<string, string>[] {
    if (!this.dimensions.every((d) => d.knownValues?.length)) {
      return [];
    }

    let combinations: Record<string, string>[] = [{}];

    for (const dim of this.dimensions) {
      const newCombinations: Record<string, string>[] = [];
      for (const combo of combinations) {
        for (const value of dim.knownValues!) {
          newCombinations.push({ ...combo, [dim.name]: value });
        }
      }
      combinations = newCombinations;
    }

    return combinations;
  }

  buildKey(dimensions: Record<string, string>): string {
    const parts = this.dimNames.map((name) => {
      const value = dimensions[name];
      if (!value) throw new Error(`Missing dimension: ${name}`);
      return `${name}=${value}`;
    });
    return `${this.baseKey}:${parts.join(":")}`;
  }

  private buildLabels(dimensions: Record<string, string>): Record<string, string> {
    return { baseKey: this.baseKey, ...dimensions };
  }

  async init(): Promise<void> {
    if (this.knownCombinations.length === 0) return;

    await Promise.all(
      this.knownCombinations.map(async (dims) => {
        const key = this.buildKey(dims);
        const labels = this.buildLabels(dims);
        await TimeSeriesService.ensureKey(key, { ...this.config, labels });
        this.createdKeys.add(key);
      })
    );
  }

  async record(points: DimensionalTSPoint<TDim>[]): Promise<void> {
    if (points.length === 0) return;

    const byKey = new Map<string, { labels: Record<string, string> }>();

    for (const point of points) {
      const key = this.buildKey(point.dimensions);
      if (!byKey.has(key)) {
        byKey.set(key, { labels: this.buildLabels(point.dimensions) });
      }
    }

    const newKeys = [...byKey.entries()].filter(([key]) => !this.createdKeys.has(key));
    if (newKeys.length > 0) {
      await Promise.all(
        newKeys.map(async ([key, { labels }]) => {
          await TimeSeriesService.ensureKey(key, { ...this.config, labels });
          this.createdKeys.add(key);
        })
      );
    }

    const seen = new Map<string, number>();

    await TimeSeriesService.add(
      points.map((p) => {
        const key = this.buildKey(p.dimensions);
        const baseTs = p.timestamp.getTime();
        const collisionKey = `${key}:${baseTs}`;
        const collisionIndex = seen.get(collisionKey) ?? 0;
        seen.set(collisionKey, collisionIndex + 1);

        return {
          key,
          timestamp: baseTs - collisionIndex,
          value: p.value,
        };
      })
    );
  }

  filter(dimensions?: Partial<Record<TDim, string | string[]>>): TSFilter {
    const filter: TSFilter = { baseKey: this.baseKey };

    if (dimensions) {
      for (const [k, v] of Object.entries(dimensions)) {
        if (v !== undefined) filter[k] = v as string | string[];
      }
    }
    return filter;
  }
}
