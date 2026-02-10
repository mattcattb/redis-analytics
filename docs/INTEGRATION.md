# Integration Strategy

## Goal

Use a single analytics primitive package across multiple repositories without copy drift.

## Recommended

1. Keep `redis-analytics` as the shared primitive package.
2. Keep product/business analytics services in each app repository.
3. Bind the app Redis client via `setRedisAnalyticsClient()` during bootstrap.

## App Wiring

```ts
import { setRedisAnalyticsClient } from "redis-analytics";

setRedisAnalyticsClient(analyticsClient);
```

## Separation Boundary

- Package contains TS/HLL/Bloom primitives, stores, queries, and bucket/time helpers.
- App contains event semantics, metric definitions, controller logic, and business rules.

## Multi-repo reuse options

- Publish package to npm and consume with semver.
- Consume directly from a git tag as a temporary option.
- Avoid copy-paste across repositories except for short-lived bootstrapping.
