import {
  TimeSeriesService,
  type TSAggregation,
  type TSCompactionRule,
  type TSConfig,
} from "../redis/timeseries.service";
import { BUCKET_MS } from "../time";

import type { Bucket } from "../types";

type TSRecordPoint = { timestamp: Date; value: number };

export class TimeseriesStore {
  public readonly key: string;
  public compactions: Map<string, TimeseriesCompactedStore> = new Map();

  constructor(
    key: string,
    public config: TSConfig,
    private timeBuckets: Record<Bucket, number> = BUCKET_MS
  ) {
    this.key = key;
  }

  async init() {
    await TimeSeriesService.ensureKey(this.key, this.config);

    for (const compactionStore of this.compactions.values()) {
      await compactionStore.init();
    }
  }

  compact(agg: TSAggregation, bucket: Bucket = "h"): string {
    const compactionKey = `${this.key}:${agg}`;

    if (this.compactions.has(compactionKey)) {
      throw new Error(`Compaction key ${compactionKey} exists within ${this.key}`);
    }

    const bucketMs = this.timeBuckets[bucket];

    const store = new TimeseriesCompactedStore(this.key, compactionKey, {
      agg,
      bucketMs,
    });

    this.compactions.set(compactionKey, store);

    return compactionKey;
  }

  async record(points: TSRecordPoint[]): Promise<void> {
    if (points.length === 0) return;
    const seen = new Map<number, number>();

    return TimeSeriesService.add(
      points.map((t) => {
        const baseTs = t.timestamp.getTime();
        const collisionIndex = seen.get(baseTs) ?? 0;
        seen.set(baseTs, collisionIndex + 1);

        return {
          key: this.key,
          timestamp: baseTs - collisionIndex,
          value: t.value,
        };
      })
    );
  }

  async backfillCompactions() {
    const promises: Promise<void>[] = [];
    for (const [cKey, comp] of this.compactions) {
      promises.push(
        TimeSeriesService.backfillCompaction(
          this.key,
          cKey,
          comp.config.agg,
          comp.config.bucketMs ?? BUCKET_MS["h"]
        )
      );
    }
    await Promise.all(promises);
  }
}

export class TimeseriesCompactedStore {
  constructor(
    public sourceKey: string,
    public key: string,
    public config: TSCompactionRule
  ) {}

  async init() {
    await TimeSeriesService.ensureCompactionRule(this.sourceKey, this.key, this.config);
  }
}
