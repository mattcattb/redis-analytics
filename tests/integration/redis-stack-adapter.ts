import type { RedisClientType } from "redis";

import type { RedisAnalyticsClient } from "../../src/client";

function parseRangeReply(reply: unknown): Array<{ timestamp: number; value: number | null }> {
  if (!Array.isArray(reply)) return [];
  return reply.map((row) => {
    const pair = row as [unknown, unknown];
    const ts = Number(pair[0]);
    const rawValue = pair[1];
    if (rawValue === null) return { timestamp: ts, value: null };
    return { timestamp: ts, value: Number(rawValue) };
  });
}

function parseMRangeReply(
  reply: unknown
): Record<
  string,
  {
    labels: Record<string, string>;
    samples: Array<{ timestamp: number; value: number | null }>;
  }
> {
  if (!Array.isArray(reply)) return {};
  const output: Record<
    string,
    {
      labels: Record<string, string>;
      samples: Array<{ timestamp: number; value: number | null }>;
    }
  > = {};

  for (const row of reply) {
    if (!Array.isArray(row) || row.length < 3) continue;
    const key = String(row[0]);
    const labelsArr = Array.isArray(row[1]) ? row[1] : [];
    const samplesArr = parseRangeReply(row[2]);
    const labels = Object.fromEntries(
      labelsArr.map((pair) => [String((pair as [unknown, unknown])[0]), String((pair as [unknown, unknown])[1])])
    );
    output[key] = { labels, samples: samplesArr };
  }

  return output;
}

function appendTsAgg(
  cmd: string[],
  options?: {
    AGGREGATION?: { type: string; timeBucket: number; ALIGN?: number; EMPTY?: boolean };
  }
) {
  const agg = options?.AGGREGATION;
  if (!agg) return;

  if (agg.ALIGN !== undefined) {
    cmd.push("ALIGN", String(agg.ALIGN));
  }
  cmd.push("AGGREGATION", agg.type, String(agg.timeBucket));
  if (agg.EMPTY) {
    cmd.push("EMPTY");
  }
}

export function createRedisStackAnalyticsClient(
  redis: RedisClientType
): RedisAnalyticsClient {
  return {
    bf: {
      reserve: async (key, errorRate, capacity) => {
        await redis.sendCommand([
          "BF.RESERVE",
          key,
          String(errorRate),
          String(capacity),
        ]);
      },
      mAdd: async (key, items) => {
        const reply = await redis.sendCommand(["BF.MADD", key, ...items]);
        return (reply as unknown[]).map((value) => Number(value) === 1);
      },
      mExists: async (key, items) => {
        const reply = await redis.sendCommand(["BF.MEXISTS", key, ...items]);
        return (reply as unknown[]).map((value) => Number(value) === 1);
      },
    },
    ts: {
      create: async (key, options) => {
        const cmd = ["TS.CREATE", key];
        if (typeof options.RETENTION === "number") {
          cmd.push("RETENTION", String(options.RETENTION));
        }
        if (typeof options.DUPLICATE_POLICY === "string") {
          cmd.push("DUPLICATE_POLICY", options.DUPLICATE_POLICY);
        }
        if (options.LABELS && typeof options.LABELS === "object") {
          const labels = options.LABELS as Record<string, string>;
          if (Object.keys(labels).length > 0) {
            cmd.push(
              "LABELS",
              ...Object.entries(labels).flatMap(([k, v]) => [k, v])
            );
          }
        }
        await redis.sendCommand(cmd);
      },
      alter: async (key, options) => {
        const cmd = ["TS.ALTER", key];
        if (typeof options.RETENTION === "number") {
          cmd.push("RETENTION", String(options.RETENTION));
        }
        if (typeof options.DUPLICATE_POLICY === "string") {
          cmd.push("DUPLICATE_POLICY", options.DUPLICATE_POLICY);
        }
        if (options.LABELS && typeof options.LABELS === "object") {
          const labels = options.LABELS as Record<string, string>;
          if (Object.keys(labels).length > 0) {
            cmd.push(
              "LABELS",
              ...Object.entries(labels).flatMap(([k, v]) => [k, v])
            );
          }
        }
        await redis.sendCommand(cmd);
      },
      createRule: async (sourceKey, destKey, aggregation, bucketMs, align) => {
        await redis.sendCommand([
          "TS.CREATERULE",
          sourceKey,
          destKey,
          "AGGREGATION",
          aggregation,
          String(bucketMs),
          String(align),
        ]);
      },
      mAdd: async (points) => {
        const args = points.flatMap((point) => [
          point.key,
          String(point.timestamp),
          String(point.value),
        ]);
        await redis.sendCommand(["TS.MADD", ...args]);
      },
      range: async (key, from, to, options) => {
        const cmd = ["TS.RANGE", key, String(from), String(to)];
        appendTsAgg(cmd, options as any);
        const reply = await redis.sendCommand(cmd);
        return parseRangeReply(reply);
      },
      mRangeWithLabels: async (from, to, filters, options) => {
        const cmd = ["TS.MRANGE", String(from), String(to)];
        appendTsAgg(cmd, options as any);
        cmd.push("WITHLABELS", "FILTER", ...filters);
        const reply = await redis.sendCommand(cmd);
        return parseMRangeReply(reply);
      },
      mRangeWithLabelsGroupBy: async (from, to, filters, groupBy, options) => {
        const cmd = ["TS.MRANGE", String(from), String(to)];
        appendTsAgg(cmd, options as any);
        cmd.push(
          "WITHLABELS",
          "FILTER",
          ...filters,
          "GROUPBY",
          String(groupBy.label),
          "REDUCE",
          String((groupBy as { REDUCE: string }).REDUCE)
        );
        const reply = await redis.sendCommand(cmd);
        return parseMRangeReply(reply);
      },
    },
    pfAdd: async (key, ids) => {
      await redis.sendCommand(["PFADD", key, ...ids]);
    },
    pfCount: async (keys) => {
      const value = await redis.sendCommand(["PFCOUNT", ...keys]);
      return Number(value);
    },
    pfMerge: async (destKey, sourceKeys) => {
      await redis.sendCommand(["PFMERGE", destKey, ...sourceKeys]);
    },
    expire: async (key, ttlSeconds) => {
      await redis.sendCommand(["EXPIRE", key, String(ttlSeconds)]);
    },
    multi: () => {
      const jobs: Array<() => Promise<number>> = [];
      return {
        pfAdd: (key, ids) => {
          jobs.push(async () => {
            const value = await redis.sendCommand(["PFADD", key, ...ids]);
            return Number(value);
          });
          return undefined;
        },
        pfCount: (key) => {
          jobs.push(async () => {
            const value = await redis.sendCommand(["PFCOUNT", key]);
            return Number(value);
          });
          return undefined;
        },
        execAsPipeline: async () => {
          const out: number[] = [];
          for (const run of jobs) {
            out.push(await run());
          }
          return out;
        },
        execAsPipelineTyped: async () => {
          const out: number[] = [];
          for (const run of jobs) {
            out.push(await run());
          }
          return out;
        },
      };
    },
  };
}
