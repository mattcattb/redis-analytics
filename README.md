# redis-analytics

Reusable Redis analytics primitives for TS/HLL/Bloom backed metrics.

## Includes

- Redis client adapter injection
- TimeSeries helpers
- HyperLogLog helpers
- Bloom helpers
- Stores: timeseries, dimensional TS, HLL, bloom-counter
- Query builders: standard TS and dimensional TS

## Setup

```ts
import { setRedisAnalyticsClient } from "redis-analytics";

setRedisAnalyticsClient(client);
```
