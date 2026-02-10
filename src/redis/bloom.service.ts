import { getRedisAnalyticsClient } from "../client";

export type BloomConfig = { error_rate: number; space: number };

export const BloomService = {
  async reserveFirst(key: string, options: BloomConfig) {
    try {
      await this.reserve(key, options);
    } catch (e: any) {
      const message = e?.message ?? "";
      if (
        message.includes("item exists") ||
        message.includes("key already exists")
      ) {
        return;
      }
      throw e;
    }
  },

  async reserve(
    key: string,
    { error_rate = 0.01, space = 1000000 }: BloomConfig
  ) {
    if (error_rate >= 1 || error_rate <= 0) {
      throw new Error("incorrect bloom reservations given");
    }

    if (!Number.isFinite(space) || space <= 0) {
      throw new Error("incorrect bloom reservations given");
    }

    const capacity = Math.ceil(space);

    await getRedisAnalyticsClient().bf.reserve(key, error_rate, capacity);
  },

  async checkAndRegister(key: string, ids: string[]): Promise<boolean[]> {
    if (ids.length === 0) {
      return [];
    }

    const results = await getRedisAnalyticsClient().bf.mAdd(key, ids);
    return results.map((x) => !x);
  },

  async exists(key: string, ids: string[]): Promise<boolean[]> {
    return await getRedisAnalyticsClient().bf.mExists(key, ids);
  },
};
