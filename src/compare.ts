export type PercentChangeStatus =
  | "increase"
  | "decrease"
  | "no_change"
  | "new"
  | "vanished"
  | "stable_at_zero"
  | "unavailable";

export type PercentChange = {
  status: PercentChangeStatus;
  value: number | null;
};

export type MetricPercentChange<T> = T extends number
  ? PercentChange
  : T extends Record<string, unknown>
    ? { [K in keyof T]: MetricPercentChange<T[K]> }
    : PercentChange;

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function calculatePercentChange(
  current: unknown,
  previous: unknown
): PercentChange {
  const currentValue = toNumber(current);
  const previousValue = toNumber(previous);

  if (currentValue === null || previousValue === null) {
    return { status: "unavailable", value: null };
  }

  if (previousValue === 0) {
    if (currentValue > 0) return { status: "new", value: null };
    return { status: "stable_at_zero", value: 0 };
  }

  if (currentValue === 0) {
    return { status: "vanished", value: -100 };
  }

  if (currentValue === previousValue) {
    return { status: "no_change", value: 0 };
  }

  const pct = ((currentValue - previousValue) / previousValue) * 100;
  return { status: pct > 0 ? "increase" : "decrease", value: pct };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildPercentChangeTree<T>(
  current: T,
  previous: T
): MetricPercentChange<T> {
  if (!isRecord(current) || !isRecord(previous)) {
    return calculatePercentChange(current, previous) as MetricPercentChange<T>;
  }

  const keys = new Set([
    ...Object.keys(current as Record<string, unknown>),
    ...Object.keys(previous as Record<string, unknown>),
  ]);

  const out: Record<string, unknown> = {};
  for (const key of keys) {
    out[key] = buildPercentChangeTree(
      (current as Record<string, unknown>)[key],
      (previous as Record<string, unknown>)[key]
    );
  }

  return out as MetricPercentChange<T>;
}
