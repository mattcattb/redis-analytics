import type { RedisAnalyticsClient } from "./client";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function getPath(record: UnknownRecord, key: string): unknown {
  return record[key];
}

function assertRecord(value: unknown, path: string): asserts value is UnknownRecord {
  if (!isRecord(value)) {
    throw new Error(`Redis analytics client contract violation at "${path}"`);
  }
}

function assertFunction(
  value: unknown,
  path: string
): asserts value is (...args: unknown[]) => unknown {
  if (typeof value !== "function") {
    throw new Error(`Redis analytics client contract violation at "${path}"`);
  }
}

export function assertRedisAnalyticsClientContract(
  client: unknown
): RedisAnalyticsClient {
  assertRecord(client, "client");

  const bf = getPath(client, "bf");
  assertRecord(bf, "bf");
  assertFunction(getPath(bf, "reserve"), "bf.reserve");
  assertFunction(getPath(bf, "mAdd"), "bf.mAdd");
  assertFunction(getPath(bf, "mExists"), "bf.mExists");

  const ts = getPath(client, "ts");
  assertRecord(ts, "ts");
  assertFunction(getPath(ts, "create"), "ts.create");
  assertFunction(getPath(ts, "alter"), "ts.alter");
  assertFunction(getPath(ts, "createRule"), "ts.createRule");
  assertFunction(getPath(ts, "mAdd"), "ts.mAdd");
  assertFunction(getPath(ts, "range"), "ts.range");
  assertFunction(getPath(ts, "mRangeWithLabels"), "ts.mRangeWithLabels");
  assertFunction(
    getPath(ts, "mRangeWithLabelsGroupBy"),
    "ts.mRangeWithLabelsGroupBy"
  );

  assertFunction(getPath(client, "pfAdd"), "pfAdd");
  assertFunction(getPath(client, "pfCount"), "pfCount");
  assertFunction(getPath(client, "pfMerge"), "pfMerge");
  assertFunction(getPath(client, "expire"), "expire");
  assertFunction(getPath(client, "multi"), "multi");

  const multi = getPath(client, "multi") as () => unknown;
  const pipeline = multi();
  assertRecord(pipeline, "multi()");
  assertFunction(getPath(pipeline, "pfAdd"), "multi().pfAdd");
  assertFunction(getPath(pipeline, "pfCount"), "multi().pfCount");
  assertFunction(getPath(pipeline, "execAsPipeline"), "multi().execAsPipeline");

  return client as RedisAnalyticsClient;
}
