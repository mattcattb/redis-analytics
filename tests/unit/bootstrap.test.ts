import { describe, expect, it, vi } from "vitest";

import { bootstrapAnalytics } from "../../src/bootstrap";

describe("bootstrapAnalytics", () => {
  it("initializes all targets", async () => {
    const a = { init: vi.fn(async () => undefined) };
    const b = { init: vi.fn(async () => undefined) };

    await bootstrapAnalytics([a, b]);

    expect(a.init).toHaveBeenCalledTimes(1);
    expect(b.init).toHaveBeenCalledTimes(1);
  });

  it("can backfill compactions when enabled", async () => {
    const target = {
      init: vi.fn(async () => undefined),
      backfillCompactions: vi.fn(async () => undefined),
    };

    await bootstrapAnalytics([target], { backfillCompactions: true });

    expect(target.init).toHaveBeenCalledTimes(1);
    expect(target.backfillCompactions).toHaveBeenCalledTimes(1);
  });
});
