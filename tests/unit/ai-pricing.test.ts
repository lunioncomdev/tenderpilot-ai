import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "@/server/ai/provider";

const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 };

describe("estimation du coût IA", () => {
  it("applique le tarif de gpt-5.6-luna (0,20 / 0,02 / 1,20 $ par million)", () => {
    expect(estimateCostUsd("gpt-5.6-luna", usage)).toBeCloseTo(1.42, 4);
  });
  it("rattache une variante datée à sa famille la plus précise", () => {
    expect(estimateCostUsd("gpt-5.6-luna-2026-09-01", usage)).toBeCloseTo(1.42, 4);
    expect(estimateCostUsd("gpt-5.5-2026-04-01", usage)).toBeCloseTo(35.5, 4);
  });
});
