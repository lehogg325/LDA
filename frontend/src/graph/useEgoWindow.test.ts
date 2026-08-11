import { describe, expect, it } from "vitest";
import { allQuartersSettled } from "./useEgoWindow";

describe("allQuartersSettled", () => {
  // (loaded, failed, total) -> settled
  const table: [number, number, number, boolean][] = [
    [0, 0, 0, false],           // no anchor yet
    [5, 0, 5, true],            // everything loaded cleanly
    [4, 1, 5, true],            // one permanent failure — must not hang forever on it
    [4, 0, 5, false],           // still waiting on the last quarter
    [3, 1, 5, false],           // one settled failure, one still pending
    [0, 5, 5, true],            // every quarter failed — still "settled" (nothing left to wait for)
  ];
  it.each(table)("(%i loaded, %i failed, %i total) -> %s", (loaded, failed, total, expected) => {
    expect(allQuartersSettled(loaded, failed, total)).toBe(expected);
  });
});
