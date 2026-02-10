const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0)
  );
}

export function defaultRangeFromDays(days: number): { start: Date; end: Date } {
  const now = new Date();
  const safeDays = Math.max(1, Math.floor(days));
  const start = new Date(now.getTime() - safeDays * DAY_MS);
  return { start, end: now };
}

export function getDaySlices(range: {
  start: Date;
  end: Date;
}): Array<{ start: Date; end: Date }> {
  const start = startOfUtcDay(range.start);
  const endMs = range.end.getTime();
  const slices: Array<{ start: Date; end: Date }> = [];

  for (let cursor = start.getTime(); cursor < endMs; cursor += DAY_MS) {
    const next = Math.min(cursor + DAY_MS, endMs);
    slices.push({ start: new Date(cursor), end: new Date(next) });
  }

  return slices;
}

export function randomDateInSlice(slice: { start: Date; end: Date }): Date {
  const startMs = slice.start.getTime();
  const endMs = slice.end.getTime();
  if (endMs <= startMs) return new Date(startMs);
  return new Date(startMs + Math.random() * (endMs - startMs));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function dayMultiplier(dayIndex: number, totalDays: number): number {
  const progress = totalDays > 1 ? dayIndex / (totalDays - 1) : 0;
  const trend = (progress - 0.5) * 0.25;
  const weekly = Math.sin((dayIndex / 7) * Math.PI * 2) * 0.1;
  const noise = (Math.random() - 0.5) * 0.08;
  return clamp(1 + trend + weekly + noise, 0.4, 1.8);
}

export function pickWeighted<T>(options: { value: T; weight: number }[]): T {
  const total = options.reduce((sum, o) => sum + o.weight, 0);
  let r = Math.random() * total;
  for (const option of options) {
    r -= option.weight;
    if (r <= 0) return option.value;
  }
  return options[0].value;
}
