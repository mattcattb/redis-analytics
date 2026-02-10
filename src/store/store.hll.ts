import { HLLService, type HLLPoint } from "../redis/hll.service";
import type { AnalyticBucket, Bucket, DateRange, Timeframe } from "../types";
import { TIMEFRAME_TO_DEFAULT_BUCKET } from "../types";
import { getBucketKey, resolveRange, generateTimeSeries, snapToDay, snapToHour, addDaysUtc, addHoursUtc, addMonthsUtc } from "../time";

type HllStoreOptions = {
  lifetimeSeriesTimeframe?: Exclude<Timeframe, "lifetime">;
};

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function groupByBucket(points: HLLPoint[], keyFn: (point: HLLPoint) => string) {
  const map = new Map<string, HLLPoint[]>();
  for (const point of points) {
    const key = keyFn(point);
    const arr = map.get(key) ?? [];
    arr.push(point);
    map.set(key, arr);
  }
  return map;
}

export class HllStore {
  private options: Required<HllStoreOptions>;

  constructor(public readonly key: string, options: HllStoreOptions = {}) {
    this.options = {
      lifetimeSeriesTimeframe: options.lifetimeSeriesTimeframe ?? "1y",
    };
  }

  private hourlyKey(date: Date): string {
    return `${this.key}:h:${getBucketKey(date, "h")}`;
  }

  private dailyKey(date: Date): string {
    return `${this.key}:d:${getBucketKey(date, "d")}`;
  }

  private monthlyKey(date: Date): string {
    return `${this.key}:m:${getBucketKey(date, "m")}`;
  }

  private monthStart(date: Date): Date {
    const day = snapToDay(date);
    day.setUTCDate(1);
    return day;
  }

  private ceilToBucketBoundary(date: Date, bucket: Bucket): Date {
    switch (bucket) {
      case "h": {
        const start = snapToHour(date);
        return start.getTime() === date.getTime() ? start : addHoursUtc(start, 1);
      }
      case "d": {
        const start = snapToDay(date);
        return start.getTime() === date.getTime() ? start : addDaysUtc(start, 1);
      }
      case "m": {
        const start = this.monthStart(date);
        return start.getTime() === date.getTime() ? start : addMonthsUtc(start, 1);
      }
      default:
        throw new Error("Unsupported bucket");
    }
  }

  private floorToBucketBoundary(date: Date, bucket: Bucket): Date {
    switch (bucket) {
      case "h":
        return snapToHour(date);
      case "d":
        return snapToDay(date);
      case "m":
        return this.monthStart(date);
      default:
        throw new Error("Unsupported bucket");
    }
  }

  private normalizeRangeForBucket(range: DateRange, bucket: Bucket): DateRange {
    const start = this.floorToBucketBoundary(range.start, bucket);
    const end = this.ceilToBucketBoundary(range.end, bucket);
    return { start, end };
  }

  private keyForBucket(bucket: Bucket, date: Date): string {
    switch (bucket) {
      case "h":
        return this.hourlyKey(date);
      case "d":
        return this.dailyKey(date);
      case "m":
        return this.monthlyKey(date);
      default:
        throw new Error("Unsupported bucket");
    }
  }

  async init() {}

  get lifetimeKey(): string {
    return `${this.key}:all`;
  }

  async record(points: HLLPoint[]): Promise<void> {
    if (points.length === 0) return;

    const byHour = groupByBucket(points, (p) => getBucketKey(snapToHour(p.timestamp), "h"));
    const byDay = groupByBucket(points, (p) => getBucketKey(snapToDay(p.timestamp), "d"));
    const byMonth = groupByBucket(points, (p) => getBucketKey(this.monthStart(p.timestamp), "m"));

    const entries: Array<{ key: string; ids: string[] }> = [];

    for (const [hourStr, hourPoints] of byHour.entries()) {
      entries.push({ key: `${this.key}:h:${hourStr}`, ids: unique(hourPoints.map((p) => p.id)) });
    }

    for (const [dayStr, dayPoints] of byDay.entries()) {
      entries.push({ key: `${this.key}:d:${dayStr}`, ids: unique(dayPoints.map((p) => p.id)) });
    }

    for (const [monthStr, monthPoints] of byMonth.entries()) {
      entries.push({ key: `${this.key}:m:${monthStr}`, ids: unique(monthPoints.map((p) => p.id)) });
    }

    entries.push({ key: this.lifetimeKey, ids: unique(points.map((p) => p.id)) });

    await HLLService.addMulti(entries);
  }

  async total(range: DateRange): Promise<number> {
    return this.totalByBucket(range, "d");
  }

  async totalByBucket(range: DateRange, bucket: Bucket): Promise<number> {
    const normalized = this.normalizeRangeForBucket(range, bucket);
    const periods = generateTimeSeries(normalized, bucket);
    if (periods.length === 0) return 0;

    const keys = periods.map((period: Date) => this.keyForBucket(bucket, period));
    return await HLLService.count(keys);
  }

  async lifetime(): Promise<number> {
    return await HLLService.count(this.lifetimeKey);
  }

  async buckets(range: DateRange, bucket: Bucket = "d"): Promise<AnalyticBucket[]> {
    const normalized = this.normalizeRangeForBucket(range, bucket);
    const periods = generateTimeSeries(normalized, bucket);
    if (periods.length === 0) return [];

    const keys = periods.map((period: Date) => this.keyForBucket(bucket, period));
    const counts = await HLLService.countEach(keys);

    return periods.map((period: Date, i: number) => [period, counts[i] ?? 0]);
  }

  async get(timeframe: Timeframe): Promise<number> {
    if (timeframe === "lifetime") {
      return this.lifetime();
    }

    return this.totalByBucket(
      resolveRange(timeframe),
      TIMEFRAME_TO_DEFAULT_BUCKET[timeframe]
    );
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
