# Getting Started

## Install

```bash
npm install redis-analytics
```

## Configure client

Provide a Redis client adapter once during app bootstrap.

```ts
import { setRedisAnalyticsClient } from "redis-analytics";

setRedisAnalyticsClient(client);
```

## Define your metrics

Use `defineMetrics` to declare all metrics for a domain:

```ts
import { defineMetrics } from "redis-analytics/schema";

const metrics = defineMetrics({
  prefix: "analytics:myapp",
  metrics: {
    events: {
      type: "timeseries",
      config: { duplicatePolicy: "SUM" },
      aggregations: {
        events_total: "COUNT",
        events_sum: "SUM",
      },
    },
    unique_users: { type: "hll" },
  },
});

// Initialize stores (call once at app startup)
await metrics.init();

// Record data
await metrics.stores.events.record([
  { timestamp: new Date(), value: 1 },
]);

// Query stats — pass a timeframe string or { start, end } range
const stats = await metrics.getStats("24h");
// → { events_total: number, events_sum: number, unique_users: number }

// Query series
const series = await metrics.getSeries("1w", "d");
```

See [Schema guide](./usage/schema.md) for full documentation.

## Development scripts

```bash
npm run typecheck
npm run test
npm run docs:dev
npm run docs:build
```
