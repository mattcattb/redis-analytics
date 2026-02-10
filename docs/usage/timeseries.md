# TimeSeries Usage

```ts
import { TimeseriesStore } from "redis-analytics";

const betsStore = new TimeseriesStore("analytics:bets:count", {
  duplicatePolicy: "SUM",
  labels: { metric: "bets", env: "prod" },
  retentionHrs: 24 * 365,
});

betsStore.compact("SUM", "h");
betsStore.compact("SUM", "d");

await betsStore.init();

await betsStore.record([
  { timestamp: new Date(), value: 1 },
  { timestamp: new Date(), value: 1 },
]);
```

## Notes

- Use `duplicatePolicy: "SUM"` for counter-like metrics.
- Add compaction rules for long-range charts to reduce query cost.
- Keep labels stable to make `mRange` filtering predictable.
