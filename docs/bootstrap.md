# Bootstrap API

`bootstrapAnalytics()` provides one place to initialize stores at app startup.

```ts
import { bootstrapAnalytics } from "redis-analytics";

await bootstrapAnalytics([storeA, storeB, storeC], {
  backfillCompactions: true,
});
```

## Why use it

- Keeps startup sequencing consistent across services.
- Avoids missed `init()` calls when metrics are added.
- Optional compaction backfill for historical reads.
