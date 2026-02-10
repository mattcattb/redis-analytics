import { TimeseriesStore } from "./store.timeseries";
import { BloomService, type BloomConfig } from "../redis/bloom.service";
import { FOREVER_MS, TimeSeriesService } from "../redis/timeseries.service";
import type { HLLPoint } from "../redis/hll.service";
import type { AnalyticBucket, Bucket, Timeframe } from "../types";
import { resolveRange, BUCKET_MS, timestampToUtc } from "../time";

type BloomCounterStoreOptions = {
  bloom?: BloomConfig;
  lifetimeSeriesTimeframe?: Exclude<Timeframe, "lifetime">;
};

export class BloomCounterStore {
  private bloomKey: string;
  private countStore: TimeseriesStore;
  private options: Required<BloomCounterStoreOptions>;

  constructor(baseKey: string, options: BloomCounterStoreOptions = {}) {
    this.bloomKey = `${baseKey}:bloom`;
    this.countStore = new TimeseriesStore(`${baseKey}:count`, {
      duplicatePolicy: "SUM",
    });
    this.options = {
      bloom: {
        error_rate: options.bloom?.error_rate ?? 0.01,
        space: options.bloom?.space ?? 1_000_000,
      },
      lifetimeSeriesTimeframe: options.lifetimeSeriesTimeframe ?? "1y",
    };
  }

  async init() {
    await Promise.all([
      BloomService.reserveFirst(this.bloomKey, this.options.bloom),
      this.countStore.init(),
    ]);
  }

  async recordWithResult(points: HLLPoint[]): Promise<HLLPoint[]> {
    if (points.length === 0) return [];

    const ids = points.map((p) => p.id);
    const seenBefore = await BloomService.checkAndRegister(this.bloomKey, ids);
    const newPoints = points.filter((_, i) => !seenBefore[i]);

    if (newPoints.length > 0) {
      const byTimestamp = new Map<number, number>();
      for (const point of newPoints) {
        const ts = point.timestamp.getTime();
        byTimestamp.set(ts, (byTimestamp.get(ts) ?? 0) + 1);
      }

      await TimeSeriesService.add(
        Array.from(byTimestamp.entries()).map(([timestamp, value]) => ({
          key: this.countStore.key,
          timestamp,
          value,
        }))
      );
    }

    return newPoints;
  }

  async record(points: HLLPoint[]): Promise<void> {
    await this.recordWithResult(points);
  }

  async total(range: { start: Date; end: Date }): Promise<number> {
    const start = range.start.getTime();
    const end = range.end.getTime();
    if (end <= start) return 0;

    const samples = await TimeSeriesService.range(
      this.countStore.key,
      start,
      end - 1,
      FOREVER_MS,
      "SUM"
    );
    return samples[0]?.value ?? 0;
  }

  async lifetime(): Promise<number> {
    const samples = await TimeSeriesService.range(
      this.countStore.key,
      "-",
      "+",
      FOREVER_MS,
      "SUM"
    );
    return samples[0]?.value ?? 0;
  }

  async buckets(
    range: { start: Date; end: Date },
    bucket: Bucket = "d"
  ): Promise<AnalyticBucket[]> {
    const start = range.start.getTime();
    const end = range.end.getTime();
    if (end <= start) return [];

    const samples = await TimeSeriesService.range(
      this.countStore.key,
      start,
      end - 1,
      BUCKET_MS[bucket],
      "SUM",
      { empty: true }
    );

    return samples.map((s) => [timestampToUtc(s.timestamp), s.value]);
  }

  async get(timeframe: Timeframe): Promise<number> {
    if (timeframe === "lifetime") return this.lifetime();
    return this.total(resolveRange(timeframe));
  }

  async getBuckets(
    timeframe: Timeframe,
    bucket: Bucket = "d"
  ): Promise<AnalyticBucket[]> {
    if (timeframe === "lifetime") {
      return this.buckets(resolveRange(this.options.lifetimeSeriesTimeframe), bucket);
    }

    return this.buckets(resolveRange(timeframe), bucket);
  }
}
