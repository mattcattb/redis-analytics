# Getting Started

## Install

```bash
npm install redis-analytics
```

## Configure client

Provide a Redis client adapter once during app bootstrap.

```ts
import { setRedisAnalyticsClient } from "redis-analytics";

setRedisAnalyticsClient({
  bf: {
    reserve: async () => undefined,
    mAdd: async () => [],
    mExists: async () => [],
  },
  ts: {
    create: async () => undefined,
    alter: async () => undefined,
    createRule: async () => undefined,
    mAdd: async () => undefined,
    range: async () => [],
    mRangeWithLabels: async () => ({}),
    mRangeWithLabelsGroupBy: async () => ({}),
  },
  pfAdd: async () => undefined,
  pfCount: async () => 0,
  pfMerge: async () => undefined,
  expire: async () => undefined,
  multi: () => ({
    pfAdd: () => undefined,
    pfCount: () => undefined,
    execAsPipeline: async () => undefined,
  }),
});
```

## Development scripts

```bash
npm run typecheck
npm run docs:dev
npm run docs:build
```
