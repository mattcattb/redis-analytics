# redis-analytics

Reusable Redis analytics primitives for TS/HLL/Bloom backed metrics.

Docs: https://mattcattb.github.io/redis-analytics/

## Includes

- Redis client adapter injection
- TimeSeries helpers
- HyperLogLog helpers
- Bloom helpers
- Stores: timeseries, dimensional TS, HLL, bloom-counter
- Query builders: standard TS and dimensional TS

## Install

```bash
npm install redis-analytics
```

## Client setup

```ts
import { setRedisAnalyticsClient } from "redis-analytics";

setRedisAnalyticsClient(client);
```

## Usage examples

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
const uniques7d = await activeUsers.get("7d");

const firstSeenUsers = new BloomCounterStore("analytics:users:first-seen");
await firstSeenUsers.init();
await firstSeenUsers.record([{ id: "u1", timestamp: new Date() }]);
const newUsers7d = await firstSeenUsers.get("7d");
```

### Query builders

```ts
import { ts, tsQuery, groupedQuery } from "redis-analytics";

const totals = tsQuery({
  bets: ts("analytics:bets:count", "SUM"),
  volume: ts("analytics:bets:volume", "SUM"),
});
const metrics = await totals.timeframe("7d");

const byChain = groupedQuery({
  filter: { metric: "bets", env: "prod" },
  agg: "SUM",
  groupBy: "chain",
  values: ["solana", "ethereum"] as const,
});
const grouped = await byChain.timeframe("7d");
```

## Local docs

```bash
npm run docs:dev
```
