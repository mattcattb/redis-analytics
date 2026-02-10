import type { Bucket } from "../types";

export function toUTC(date: Date | number) {
  const d = new Date(date);
  return new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate(),
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds()
    )
  );
}

export function snapToDay(date: Date | number): Date {
  const d = new Date(date);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0)
  );
}

export function snapToHour(date: Date | number): Date {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

export function timestampToUtc(timestamp: number): Date {
  return toUTC(new Date(timestamp));
}

export function addHoursUtc(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function addMonthsUtc(date: Date, months: number): Date {
  const out = new Date(date.getTime());
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
}

export function formatBucketKey(date: Date, bucket: Bucket): string {
  const y = String(date.getUTCFullYear());
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");

  switch (bucket) {
    case "h":
      return `${y}-${m}-${d}:${h}`;
    case "d":
      return `${y}-${m}-${d}`;
    case "m":
      return `${y}-${m}`;
    default:
      throw new Error("Unsupported bucket");
  }
}
