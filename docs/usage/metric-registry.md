# Metric Registry (Key/Label Drift Prevention)

Use `createDimensionalMetric()` to define keys, labels, and allowed dimension values in one typed place.

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
  staticLabels: { service: "tx" },
});

const store = txAmount.createStore();

await store.record(
  txAmount.points([
    {
      timestamp: new Date(),
      value: 100,
      dimensions: { coin: "btc", category: "deposit" },
    },
  ])
);
```

## What this protects against

- Unknown dimension names.
- Invalid dimension values.
- Inconsistent key/label formatting across services.

The registry enforces key shape like:

`ana:tx:amount:coin=btc:category=deposit`
