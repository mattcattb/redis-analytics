# redis-analytics

Reusable Redis analytics primitives for TS/HLL/Bloom backed metrics.

Docs: https://mattcattb.github.io/redis-analytics/

## Install

```bash
npm install redis-analytics
```

## Client setup

```ts
import { setRedisAnalyticsClient } from "redis-analytics";

setRedisAnalyticsClient(client);
```

## Quick start — `defineMetrics` (Recommended)

The `defineMetrics` API lets you declare all metrics for a domain in a single definition and get back a fully-typed, ready-to-use analytics object.

```ts
import { defineMetrics } from "redis-analytics/schema";

const tippingMetrics = defineMetrics({
  prefix: "analytics:tipping",
  metrics: {
    tips: {
      type: "timeseries",
      config: { duplicatePolicy: "SUM" },
      aggregations: { tips_usd_total: "SUM", tips_total: "COUNT", tips_usd_avg: "AVG" },
    },
    fees: {
      type: "timeseries",
      config: { duplicatePolicy: "SUM" },
      aggregations: { fees_usd_total: "SUM", fees_usd_avg: "AVG" },
    },
    unique_tippers: { type: "hll" },
    unique_tippees: { type: "hll" },
  },
});

// Initialize all stores
await tippingMetrics.init();

// Query stats — pass a timeframe string or a { start, end } range
const stats = await tippingMetrics.getStats("24h");
// → { tips_usd_total: number, tips_total: number, tips_usd_avg: number,
//    fees_usd_total: number, fees_usd_avg: number,
//    unique_tippers: number, unique_tippees: number }

// Or query by date range
const rangeStats = await tippingMetrics.getStats({ start, end });

// Query series — same keys, AnalyticBucket[] values
const series = await tippingMetrics.getSeries("1w", "d");

// Access individual stores for recording
await tippingMetrics.stores.tips.record([
  { timestamp: new Date(), value: 25.50 },
]);
```

**Supported metric types:**

| Type | Description | Stat key |
|------|-------------|----------|
| `timeseries` | Quantitative metrics (SUM, AVG, COUNT, etc.) | Each key in `aggregations` |
| `hll` | Approximate unique counting (HyperLogLog) | The metric name |
| `bloom-counter` | First-seen detection + counting (Bloom + TS) | The metric name |

## Advanced — Low-level APIs

### TimeSeries store

```ts
import { TimeseriesStore } from "redis-analytics";

const bets = new TimeseriesStore("analytics:bets:count", {
  duplicatePolicy: "SUM",
  labels: { metric: "bets", env: "prod" },
  retentionHrs: 24 * 365,
});

bets.compact("SUM", "h");
bets.compact("SUM", "d");
await bets.init();

await bets.record([
  { timestamp: new Date(), value: 1 },
  { timestamp: new Date(), value: 1 },
]);
```

### HLL and Bloom counters

```ts
import { HllStore, BloomCounterStore } from "redis-analytics";

const activeUsers = new HllStore("analytics:users:active");
await activeUsers.record([{ id: "u1", timestamp: new Date() }]);
const uniques7d = await activeUsers.get("1w");

const firstSeenUsers = new BloomCounterStore("analytics:users:first-seen");
await firstSeenUsers.init();
await firstSeenUsers.record([{ id: "u1", timestamp: new Date() }]);
const newUsers7d = await firstSeenUsers.get("1w");
```

### Query builders

```ts
import { ts, tsQuery, groupedQuery } from "redis-analytics";

const totals = tsQuery({
  bets: ts("analytics:bets:count", "SUM"),
  volume: ts("analytics:bets:volume", "SUM"),
});
const metrics = await totals.timeframe("1w");

const byChain = groupedQuery({
  filter: { metric: "bets", env: "prod" },
  agg: "SUM",
  groupBy: "chain",
  values: ["solana", "ethereum"] as const,
});
const grouped = await byChain.timeframe("1w");
```

### Typed metric registry

```ts
import { createDimensionalMetric } from "redis-analytics";

const txAmount = createDimensionalMetric({
  prefix: "ana:tx",
  suffix: "amount",
  dimensions: [
    { name: "coin", values: ["btc", "eth"] as const },
    { name: "category", values: ["deposit", "withdrawal"] as const },
  ] as const,
  config: { duplicatePolicy: "SUM" },
});

const store = txAmount.createStore();
```

### Bootstrap API

```ts
import { bootstrapAnalytics } from "redis-analytics";

await bootstrapAnalytics([storeA, storeB], { backfillCompactions: true });
```

### Seeding framework + CLI

```ts
import { createSeedScenario } from "redis-analytics/seed";

export default createSeedScenario({
  operations: {
    tx: async () => 120,
    user: async () => 300,
  },
});
```

```bash
redis-analytics-seed seed all --module ./scripts/seed/analytics.scenario.mjs --days 80 --scale 3
```

## Local docs

```bash
npm run docs:dev
```
