import { describe, expect, it } from "vitest";
import {
  getBucketKey,
  resolveRange,
  generateTimeSeries,
  snapToHour,
  snapToDay,
  formatBucketKey,
  addHoursUtc,
  addDaysUtc,
  addMonthsUtc,
  toUTC,
  timestampToUtc,
  BUCKET_MS,
  getBucketTTLSeconds,
  getBucketExpiration,
} from "../../src/time";

describe("toUTC", () => {
  it("returns a Date with the same UTC values", () => {
    const d = new Date("2024-06-15T10:30:00Z");
    const utc = toUTC(d);
    expect(utc.getUTCFullYear()).toBe(2024);
    expect(utc.getUTCMonth()).toBe(5);
    expect(utc.getUTCDate()).toBe(15);
    expect(utc.getUTCHours()).toBe(10);
    expect(utc.getUTCMinutes()).toBe(30);
  });

  it("accepts a numeric timestamp", () => {
    const ts = Date.UTC(2024, 0, 1, 12, 0, 0);
    const utc = toUTC(ts);
    expect(utc.getUTCFullYear()).toBe(2024);
    expect(utc.getUTCMonth()).toBe(0);
    expect(utc.getUTCDate()).toBe(1);
    expect(utc.getUTCHours()).toBe(12);
  });
});

describe("snapToDay", () => {
  it("snaps to midnight UTC", () => {
    const d = new Date("2024-03-15T14:30:45.123Z");
    const snapped = snapToDay(d);
    expect(snapped.getUTCHours()).toBe(0);
    expect(snapped.getUTCMinutes()).toBe(0);
    expect(snapped.getUTCSeconds()).toBe(0);
    expect(snapped.getUTCMilliseconds()).toBe(0);
    expect(snapped.getUTCDate()).toBe(15);
  });

  it("keeps midnight unchanged", () => {
    const d = new Date("2024-03-15T00:00:00Z");
    const snapped = snapToDay(d);
    expect(snapped.getTime()).toBe(d.getTime());
  });
});

describe("snapToHour", () => {
  it("snaps to the start of the hour", () => {
    const d = new Date("2024-03-15T14:30:45.123Z");
    const snapped = snapToHour(d);
    expect(snapped.getUTCHours()).toBe(14);
    expect(snapped.getUTCMinutes()).toBe(0);
    expect(snapped.getUTCSeconds()).toBe(0);
    expect(snapped.getUTCMilliseconds()).toBe(0);
  });

  it("keeps exact hour unchanged", () => {
    const d = new Date("2024-03-15T14:00:00.000Z");
    const snapped = snapToHour(d);
    expect(snapped.getTime()).toBe(d.getTime());
  });
});

describe("timestampToUtc", () => {
  it("converts a Unix ms timestamp to a UTC Date", () => {
    const ts = Date.UTC(2024, 5, 15, 10, 0, 0);
    const result = timestampToUtc(ts);
    expect(result.getUTCFullYear()).toBe(2024);
    expect(result.getUTCMonth()).toBe(5);
    expect(result.getUTCHours()).toBe(10);
  });
});

describe("addHoursUtc", () => {
  it("adds hours to a date", () => {
    const d = new Date("2024-01-01T10:00:00Z");
    const result = addHoursUtc(d, 5);
    expect(result.getUTCHours()).toBe(15);
  });

  it("wraps across days", () => {
    const d = new Date("2024-01-01T23:00:00Z");
    const result = addHoursUtc(d, 2);
    expect(result.getUTCDate()).toBe(2);
    expect(result.getUTCHours()).toBe(1);
  });
});

describe("addDaysUtc", () => {
  it("adds days to a date", () => {
    const d = new Date("2024-01-01T10:00:00Z");
    const result = addDaysUtc(d, 3);
    expect(result.getUTCDate()).toBe(4);
  });
});

describe("addMonthsUtc", () => {
  it("adds months to a date", () => {
    const d = new Date("2024-01-15T10:00:00Z");
    const result = addMonthsUtc(d, 2);
    expect(result.getUTCMonth()).toBe(2);
    expect(result.getUTCDate()).toBe(15);
  });

  it("wraps across years", () => {
    const d = new Date("2024-11-15T10:00:00Z");
    const result = addMonthsUtc(d, 3);
    expect(result.getUTCFullYear()).toBe(2025);
    expect(result.getUTCMonth()).toBe(1);
  });
});

describe("formatBucketKey", () => {
  it("formats hourly key", () => {
    const d = new Date("2024-03-15T14:00:00Z");
    expect(formatBucketKey(d, "h")).toBe("2024-03-15:14");
  });

  it("formats daily key", () => {
    const d = new Date("2024-03-15T14:00:00Z");
    expect(formatBucketKey(d, "d")).toBe("2024-03-15");
  });

  it("formats monthly key", () => {
    const d = new Date("2024-03-15T14:00:00Z");
    expect(formatBucketKey(d, "m")).toBe("2024-03");
  });
});

describe("getBucketKey", () => {
  it("generates a bucket key for a given date and bucket", () => {
    const d = new Date("2024-03-15T14:30:00Z");
    expect(getBucketKey(d, "h")).toBe("2024-03-15:14");
    expect(getBucketKey(d, "d")).toBe("2024-03-15");
    expect(getBucketKey(d, "m")).toBe("2024-03");
  });
});

describe("BUCKET_MS", () => {
  it("has correct ms values", () => {
    expect(BUCKET_MS.h).toBe(3600000);
    expect(BUCKET_MS.d).toBe(86400000);
    expect(BUCKET_MS.m).toBe(28 * 86400000);
  });
});

describe("getBucketTTLSeconds", () => {
  it("returns correct TTL for each bucket", () => {
    expect(getBucketTTLSeconds("h")).toBe(3600);
    expect(getBucketTTLSeconds("d")).toBe(86400);
    expect(getBucketTTLSeconds("m")).toBe(2678400);
  });
});

describe("getBucketExpiration", () => {
  it("calculates expiration correctly", () => {
    expect(getBucketExpiration("h", 24)).toBe(3600 * 25);
    expect(getBucketExpiration("d", 7)).toBe(86400 * 8);
  });
});

describe("resolveRange", () => {
  it("resolves 24h timeframe", () => {
    const now = new Date();
    const range = resolveRange("24h", now);
    const diff = range.end.getTime() - range.start.getTime();
    expect(diff).toBe(24 * 60 * 60 * 1000);
  });

  it("resolves 1w timeframe", () => {
    const now = new Date();
    const range = resolveRange("1w", now);
    const diff = range.end.getTime() - range.start.getTime();
    expect(diff).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("resolves lifetime timeframe", () => {
    const range = resolveRange("lifetime");
    expect(range.start.getTime()).toBe(0);
  });

  it("resolves a Date as start/end", () => {
    const d = new Date("2024-01-01");
    const range = resolveRange(d);
    expect(range.start.getTime()).toBe(d.getTime());
    expect(range.end.getTime()).toBe(d.getTime());
  });

  it("resolves a Date with an end date", () => {
    const start = new Date("2024-01-01");
    const end = new Date("2024-02-01");
    const range = resolveRange(start, end);
    expect(range.start).toEqual(start);
    expect(range.end).toEqual(end);
  });
});

describe("generateTimeSeries", () => {
  it("generates hourly series", () => {
    const range = {
      start: new Date("2024-01-01T00:00:00Z"),
      end: new Date("2024-01-01T03:00:00Z"),
    };
    const series = generateTimeSeries(range, "h");
    expect(series).toHaveLength(3);
    expect(series[0].getUTCHours()).toBe(0);
    expect(series[1].getUTCHours()).toBe(1);
    expect(series[2].getUTCHours()).toBe(2);
  });

  it("generates daily series", () => {
    const range = {
      start: new Date("2024-01-01T00:00:00Z"),
      end: new Date("2024-01-04T00:00:00Z"),
    };
    const series = generateTimeSeries(range, "d");
    expect(series).toHaveLength(3);
    expect(series[0].getUTCDate()).toBe(1);
    expect(series[1].getUTCDate()).toBe(2);
    expect(series[2].getUTCDate()).toBe(3);
  });

  it("generates monthly series", () => {
    const range = {
      start: new Date("2024-01-01T00:00:00Z"),
      end: new Date("2024-04-01T00:00:00Z"),
    };
    const series = generateTimeSeries(range, "m");
    expect(series).toHaveLength(3);
    expect(series[0].getUTCMonth()).toBe(0);
    expect(series[1].getUTCMonth()).toBe(1);
    expect(series[2].getUTCMonth()).toBe(2);
  });

  it("returns empty for zero-width range", () => {
    const d = new Date("2024-01-01T00:00:00Z");
    const series = generateTimeSeries({ start: d, end: d }, "h");
    expect(series).toHaveLength(0);
  });
});
