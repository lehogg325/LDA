import { describe, expect, it } from "vitest";
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
