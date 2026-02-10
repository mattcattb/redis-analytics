# Migration From Existing API Analytics

This package supports the same strategy pattern currently used in your API codebase:

- metric config map
- strategy builder
- dimensional/grouped query pairs

## Existing pattern

Your API uses:

- `mapMetricConfig(...)`
- `createQueryPair(...)`
- `dimensionalQuery(...)` + `groupedQuery(...)`

## Equivalent with this package

```ts
import {
  createDimensionalMetric,
  mapMetricConfig,
  dimensionalQuery,
  groupedQuery,
} from "redis-analytics";

const txAmount = createDimensionalMetric({
  prefix: "ana:tx",
  suffix: "amount",
  dimensions: [
    { name: "coin", values: ["btc", "eth"] as const },
    { name: "category", values: ["deposit", "withdrawal"] as const },
  ] as const,
  config: { duplicatePolicy: "SUM" },
});

const createQueryPair = (category: "deposit" | "withdrawal", agg: "SUM" | "COUNT") => ({
  overall: dimensionalQuery({
    filter: txAmount.filter({ category }),
    agg,
    reducer: "SUM",
  }),
  breakdown: groupedQuery({
    filter: txAmount.filter({ category }),
    agg,
    groupBy: "coin",
    values: ["btc", "eth"] as const,
  }),
});

const strategies = mapMetricConfig(
  {
    deposits_total: { category: "deposit", agg: "COUNT" as const },
    withdrawals_total: { category: "withdrawal", agg: "COUNT" as const },
  },
  ({ category, agg }) => createQueryPair(category, agg)
);
```

## Migration recommendation

1. Start by replacing ad-hoc string key construction with `createDimensionalMetric()`.
2. Move all metric configs into one registry file per domain (tx/user/tipping).
3. Keep query strategy shape unchanged to avoid behavioral regressions.
4. Add integration tests for each domain registry before switching writes.
