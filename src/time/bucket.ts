import type { Bucket } from "../types";
import { formatBucketKey, toUTC } from "./utils";

export const BUCKET_MS: Record<Bucket, number> = {
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  m: 28 * 24 * 60 * 60 * 1000,
};

export const getBucketKey = (date: Date | number, bucket: Bucket): string => {
  const utc = toUTC(date);
  return formatBucketKey(utc, bucket);
};

export const getBucketTTLSeconds = (bucket: Bucket) => {
  switch (bucket) {
    case "h":
      return 3600;
    case "d":
      return 86400;
    case "m":
      return 2678400;
    default:
      throw new Error("Unsupported bucket");
  }
};

export function getBucketExpiration(bucket: Bucket, retentionCount: number): number {
  const seconds = getBucketTTLSeconds(bucket);
  return seconds * (retentionCount + 1);
}
