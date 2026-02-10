# Query Builders

## Standard TS query

```ts
import { ts, tsQuery } from "redis-analytics";

const q = tsQuery({
  bets: ts("analytics:bets:count", "SUM"),
  volume: ts("analytics:bets:volume", "SUM"),
});

const totals = await q.timeframe("7d");
const buckets = await q.bucketsByTimeframe("30d", "d");
```

## Dimensional query

```ts
import { dimensionalQuery } from "redis-analytics";

const q = dimensionalQuery({
  filter: { metric: "bets", env: "prod" },
  agg: "SUM",
  reducer: "SUM",
});

const total = await q.timeframe("24h");
const series = await q.bucketsByTimeframe("7d", "h");
```

## Grouped query

```ts
import { groupedQuery } from "redis-analytics";

const q = groupedQuery({
  filter: { metric: "bets", env: "prod" },
  agg: "SUM",
  groupBy: "chain",
  values: ["solana", "ethereum"] as const,
});

const totalsByChain = await q.timeframe("7d");
```
