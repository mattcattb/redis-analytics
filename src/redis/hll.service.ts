import { getRedisAnalyticsClient } from "../client";

export type HLLPoint = {
  id: string;
  timestamp: Date;
};

export const HLLService = {
  async add(key: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await getRedisAnalyticsClient().pfAdd(key, ids);
  },

  async addMulti(
    entries: Array<{ key: string; ids: string[] }>
  ): Promise<void> {
    const nonEmpty = entries.filter((e) => e.ids.length > 0);
    if (nonEmpty.length === 0) return;

    const pipeline = getRedisAnalyticsClient().multi();
    for (const { key, ids } of nonEmpty) {
      pipeline.pfAdd(key, ids);
    }
    await pipeline.execAsPipeline();
  },

  async count(keys: string | string[]): Promise<number> {
    const keyArray = Array.isArray(keys) ? keys : [keys];
    if (keyArray.length === 0) return 0;
    return await getRedisAnalyticsClient().pfCount(keyArray);
  },

  async countEach(keys: string[]): Promise<number[]> {
    if (keys.length === 0) return [];

    const pipeline = getRedisAnalyticsClient().multi();
    for (const key of keys) {
      pipeline.pfCount(key);
    }

    if (pipeline.execAsPipelineTyped) {
      return (await pipeline.execAsPipelineTyped()) as number[];
    }

    return (await pipeline.execAsPipeline()) as number[];
  },

  async merge(
    destKey: string,
    sourceKeys: string[],
    ttlSeconds?: number
  ): Promise<void> {
    if (sourceKeys.length === 0) return;

    await getRedisAnalyticsClient().pfMerge(destKey, sourceKeys);
    if (ttlSeconds) {
      await getRedisAnalyticsClient().expire(destKey, ttlSeconds);
    }
  },
};
