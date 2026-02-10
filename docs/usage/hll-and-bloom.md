# HLL and Bloom Usage

## Approximate uniques with HLL

```ts
import { HllStore } from "redis-analytics";

const uniques = new HllStore("analytics:users:active");
await uniques.record([
  { id: "u1", timestamp: new Date() },
  { id: "u2", timestamp: new Date() },
  { id: "u1", timestamp: new Date() },
]);

const last30d = await uniques.get("30d");
const dailySeries = await uniques.getBuckets("30d", "d");
```

## First-seen counters with Bloom

```ts
import { BloomCounterStore } from "redis-analytics";

const firstSeen = new BloomCounterStore("analytics:users:first-seen");
await firstSeen.init();

await firstSeen.record([
  { id: "u1", timestamp: new Date() },
  { id: "u2", timestamp: new Date() },
  { id: "u1", timestamp: new Date() }, // duplicate; ignored by bloom check
]);

const uniqueNewUsers = await firstSeen.get("7d");
```
