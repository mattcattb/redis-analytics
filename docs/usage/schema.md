# Declarative Metrics with `defineMetrics`

`defineMetrics` is the recommended high-level API for creating analytics domains. It takes a typed metric definition and returns a fully-wired object with stores, initialization, and query methods — all with inferred TypeScript types.

## Basic usage

```ts
import { defineMetrics } from "redis-analytics/schema";

const tippingMetrics = defineMetrics({
  prefix: "analytics:tipping",
  metrics: {
    tips: {
      type: "timeseries",
      config: { duplicatePolicy: "SUM" },
      aggregations: {
        tips_usd_total: "SUM",
        tips_total: "COUNT",
        tips_usd_avg: "AVG",
      },
    },
    fees: {
      type: "timeseries",
      config: { duplicatePolicy: "SUM" },
      aggregations: {
        fees_usd_total: "SUM",
        fees_usd_avg: "AVG",
      },
    },
    unique_tippers: { type: "hll" },
    unique_tippees: { type: "hll" },
  },
});
```

## Fluent alternative with `metricsSchema`

```ts
import { metricsSchema } from "redis-analytics/schema";

const tippingMetrics = metricsSchema("analytics:tipping")
  .timeseries("tips", (m) =>
    m
      .duplicatePolicy("SUM")
      .sum("tips_usd_total")
      .count("tips_total")
      .avg("tips_usd_avg")
      .compact("SUM", "h")
  )
  .timeseries("fees", (m) =>
    m
      .withConfig({ duplicatePolicy: "SUM" })
      .sum("fees_usd_total")
      .avg("fees_usd_avg")
  )
  .hll("unique_tippers")
  .build();
```

## What you get

### `stores`

Direct access to each store instance, typed by metric type:

```ts
tippingMetrics.stores.tips       // → TimeseriesStore
tippingMetrics.stores.fees       // → TimeseriesStore
tippingMetrics.stores.unique_tippers  // → HllStore
tippingMetrics.stores.unique_tippees  // → HllStore
```

### `init()`

Initializes all stores in parallel:

```ts
await tippingMetrics.init();
```

### `getStats(scope)`

Returns aggregated stats for all metrics. Pass a timeframe string or a date range object. The return type is fully inferred from your definition:

```ts
// By timeframe
const stats = await tippingMetrics.getStats("24h");
// Type: {
//   tips_usd_total: number;
//   tips_total: number;
//   tips_usd_avg: number;
//   fees_usd_total: number;
//   fees_usd_avg: number;
//   unique_tippers: number;
//   unique_tippees: number;
// }

// By date range
const rangeStats = await tippingMetrics.getStats({
  start: new Date("2024-01-01"),
  end: new Date("2024-01-31"),
});
```

### `getSeries(scope, bucket)`

Returns bucketed time series for all metrics:

```ts
const series = await tippingMetrics.getSeries("1w", "d");
// Type: {
//   tips_usd_total: AnalyticBucket[];
//   tips_total: AnalyticBucket[];
//   ...
// }

// By date range
const rangeSeries = await tippingMetrics.getSeries(
  { start: new Date("2024-01-01"), end: new Date("2024-01-31") },
  "d"
);
```

## Metric types

### `timeseries`

Wraps a `TimeseriesStore`. Each key in `aggregations` becomes a stat key in the output.

```ts
events: {
  type: "timeseries",
  config: { duplicatePolicy: "SUM" },
  aggregations: {
    events_total: "COUNT",
    events_sum: "SUM",
    events_avg: "AVG",
  },
  compactions: [{ agg: "SUM", bucket: "h" }],
}
```

### `hll`

Wraps an `HllStore` for approximate unique counting. The metric name is the stat key.

```ts
unique_users: { type: "hll" }
// → stats.unique_users: number
```

### `bloom-counter`

Wraps a `BloomCounterStore` for first-seen detection. The metric name is the stat key.

```ts
new_users: {
  type: "bloom-counter",
  bloom: { error_rate: 0.01, space: 1_000_000 },
}
// → stats.new_users: number
```

## Query scope

Both `getStats` and `getSeries` accept a `MetricScope` — either a timeframe string or a date range:

```ts
type MetricScope = Timeframe | DateRange;
```

Where:
- `Timeframe` = `"24h" | "1w" | "1m" | "1y" | "lifetime"`
- `DateRange` = `{ start: Date; end: Date }`
- `Bucket` = `"h" | "d" | "m"` (for `getSeries` only)

## Migration from manual stores

**Before:**

```ts
const tipsStore = new TimeseriesStore("analytics:tipping:tips", { duplicatePolicy: "SUM" });
const feesStore = new TimeseriesStore("analytics:tipping:fees", { duplicatePolicy: "SUM" });
const uniqueTippersStore = new HllStore("analytics:tipping:tippers");

const tippingQuery = tsQuery({
  tips_total: ts(tipsStore.key, "COUNT"),
  tips_usd_total: ts(tipsStore.key, "SUM"),
  fees_usd_total: ts(feesStore.key, "SUM"),
});

// init
await Promise.all([tipsStore.init(), feesStore.init()]);

// stats - manual branching + manual merging
async function getStats(query) {
  if (query.type === "timeframe") {
    const [tsStats, tippers] = await Promise.all([
      tippingQuery.timeframe(query.params),
      uniqueTippersStore.get(query.params),
    ]);
    return { ...tsStats, unique_tippers: tippers };
  } else {
    const [tsStats, tippers] = await Promise.all([
      tippingQuery.range(query.params),
      uniqueTippersStore.total(query.params),
    ]);
    return { ...tsStats, unique_tippers: tippers };
  }
}
```

**After:**

```ts
const tippingMetrics = defineMetrics({
  prefix: "analytics:tipping",
  metrics: {
    tips: {
      type: "timeseries",
      config: { duplicatePolicy: "SUM" },
      aggregations: { tips_total: "COUNT", tips_usd_total: "SUM" },
    },
    fees: {
      type: "timeseries",
      config: { duplicatePolicy: "SUM" },
      aggregations: { fees_usd_total: "SUM" },
    },
    unique_tippers: { type: "hll" },
  },
});

await tippingMetrics.init();
const stats = await tippingMetrics.getStats("24h");
const series = await tippingMetrics.getSeries("1w", "d");
```
