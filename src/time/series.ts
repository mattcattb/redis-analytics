import type { Bucket, DateRange } from "../types";
import { addDaysUtc, addHoursUtc, addMonthsUtc, snapToDay, snapToHour } from "./utils";

export function generateTimeSeries(range: DateRange, bucket: Bucket): Date[] {
  const series: Date[] = [];

  let current: Date;
  switch (bucket) {
    case "h":
      current = snapToHour(range.start);
      break;
    case "d":
      current = snapToDay(range.start);
      break;
    case "m":
      current = snapToDay(range.start);
      current.setUTCDate(1);
      break;
    default:
      throw new Error("Unsupported bucket");
  }

  while (current.getTime() < range.end.getTime()) {
    series.push(new Date(current));

    switch (bucket) {
      case "h":
        current = addHoursUtc(current, 1);
        break;
      case "d":
        current = addDaysUtc(current, 1);
        break;
      case "m":
        current = addMonthsUtc(current, 1);
        break;
      default:
        throw new Error("Unsupported bucket");
    }
  }

  return series;
}
