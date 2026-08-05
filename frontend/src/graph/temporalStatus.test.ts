import { describe, expect, it } from "vitest";
import { seedPosition } from "./seed";
import { temporalStatus } from "./temporalStatus";

describe("temporalStatus", () => {
  // (presentNow, presentPrev, hasPrevQuarter) -> status
  const table: [boolean, boolean, boolean, string][] = [
    [true, true, true, "persisting"],
    [true, false, true, "new"],
    [false, true, true, "dropped"],
    [false, false, true, "hidden"],
    [true, false, false, "persisting"],  // first visible quarter is neutral, not "new"
    [false, false, false, "hidden"],
  ];
  it.each(table)("(%s, %s, %s) -> %s", (now, prev, hasPrev, expected) => {
    expect(temporalStatus(now, prev, hasPrev)).toBe(expected);
  });
});

describe("layout determinism", () => {
  it("same node key always seeds the same position", () => {
    const a = seedPosition("client:108509");
    const b = seedPosition("client:108509");
    expect(a).toEqual(b);
  });
  it("different keys seed different positions", () => {
    expect(seedPosition("client:1")).not.toEqual(seedPosition("client:2"));
  });
  it("positions are inside the unit disc", () => {
    for (const key of ["registrant:1", "lobbyist:999", "gov_entity:2"]) {
      const { x, y } = seedPosition(key);
      expect(x * x + y * y).toBeLessThanOrEqual(1.0001);
    }
  });
});
