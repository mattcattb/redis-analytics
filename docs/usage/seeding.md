# Seeding and CLI

The package includes a generic seed framework so each app can provide its own generators
and record handlers while reusing a common `seed/backfill/status` flow.

## Build a scenario module

```ts
import { createSeedScenario } from "redis-analytics/seed";

export default createSeedScenario({
  init: async () => {
    // initialize stores/services
  },
  createContext(days, scale) {
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    return { range: { start, end }, scale };
  },
  operations: {
    user: async (ctx) => {
      // generate + record user events
      return 100;
    },
    tx: async (ctx) => {
      // generate + record tx events
      return 50;
    },
  },
  backfill: async () => {
    // optional compaction backfill
  },
  status: async () => {
    return { ok: true };
  },
});
```

## Run CLI

```bash
redis-analytics-seed seed all --module ./scripts/seed/analytics.scenario.mjs --days 80 --scale 3
redis-analytics-seed seed tx --module ./scripts/seed/analytics.scenario.mjs --days 30 --scale 2
redis-analytics-seed backfill all --module ./scripts/seed/analytics.scenario.mjs
redis-analytics-seed status all --module ./scripts/seed/analytics.scenario.mjs
```
