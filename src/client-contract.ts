import type { RedisAnalyticsClient } from "./client";

function assertFunction(
  value: unknown,
  path: string
): asserts value is (...args: unknown[]) => unknown {
  if (typeof value !== "function") {
    throw new Error(`Redis analytics client contract violation at "${path}"`);
  }
}

export function assertRedisAnalyticsClientContract(
  client: RedisAnalyticsClient
): RedisAnalyticsClient {
  assertFunction(client.bf?.reserve, "bf.reserve");
  assertFunction(client.bf?.mAdd, "bf.mAdd");
  assertFunction(client.bf?.mExists, "bf.mExists");

  assertFunction(client.ts?.create, "ts.create");
  assertFunction(client.ts?.alter, "ts.alter");
  assertFunction(client.ts?.createRule, "ts.createRule");
  assertFunction(client.ts?.mAdd, "ts.mAdd");
  assertFunction(client.ts?.range, "ts.range");
  assertFunction(client.ts?.mRangeWithLabels, "ts.mRangeWithLabels");
  assertFunction(
    client.ts?.mRangeWithLabelsGroupBy,
    "ts.mRangeWithLabelsGroupBy"
  );

  assertFunction(client.pfAdd, "pfAdd");
  assertFunction(client.pfCount, "pfCount");
  assertFunction(client.pfMerge, "pfMerge");
  assertFunction(client.expire, "expire");
  assertFunction(client.multi, "multi");

  const pipeline = client.multi();
  assertFunction(pipeline.pfAdd, "multi().pfAdd");
  assertFunction(pipeline.pfCount, "multi().pfCount");
  assertFunction(pipeline.execAsPipeline, "multi().execAsPipeline");

  return client;
}
