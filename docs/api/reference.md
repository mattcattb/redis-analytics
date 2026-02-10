# API Reference

Core exports:

- `setRedisAnalyticsClient`, `getRedisAnalyticsClient`
- `bootstrapAnalytics`
- `createDimensionalMetric`, `mapMetricConfig`
- `createSeedScenario` and seed utilities from `redis-analytics/seed`
- Time helpers from `redis-analytics/time`
- `TimeSeriesService`, `HLLService`, `BloomService`
- Stores: `TimeseriesStore`, `DimensionalTimeseriesStore`, `HllStore`, `BloomCounterStore`
- Query builders: `ts`, `tsQuery`, `dimensionalQuery`, `groupedQuery`

Main types:

- `Timeframe`, `Bucket`, `DateRange`
- `AnalyticBucket`
- `TSAggregation`, `TSConfig`, `TSFilter`

Subpath exports:

- `redis-analytics/client`
- `redis-analytics/bootstrap`
- `redis-analytics/metric-registry`
- `redis-analytics/seed`
- `redis-analytics/types`
- `redis-analytics/time`
- `redis-analytics/redis/bloom`
- `redis-analytics/redis/hll`
- `redis-analytics/redis/timeseries`
- `redis-analytics/store`
- `redis-analytics/query`
