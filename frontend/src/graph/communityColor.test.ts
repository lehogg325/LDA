import { describe, expect, it } from "vitest";
import { communityColor } from "./communityColor";

describe("communityColor", () => {
  it("returns the neutral gray for no community", () => {
    expect(communityColor(null)).toBe("#8C8C8C");
  });
  it("is deterministic for a given community id", () => {
    expect(communityColor(3)).toBe(communityColor(3));
  });
  it("wraps around the palette instead of throwing for large ids", () => {
    expect(() => communityColor(9999)).not.toThrow();
  });
  it("gives different colors to different communities (no collision in a small sample)", () => {
    const colors = new Set([0, 1, 2, 3, 4].map(communityColor));
    expect(colors.size).toBe(5);
  });
});
