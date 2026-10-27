import { describe, expect, it } from "vitest";

import { progressSegments } from "./progress";

describe("progressSegments", () => {
  it("fills whole segments of the goal", () => {
    const result = progressSegments(250, 500);
    expect(result.filled).toBe(5);
    expect(result.segments).toEqual([true, true, true, true, true, false, false, false, false, false]);
    expect(result.percent).toBe(50);
    expect(result.reached).toBe(false);
  });

  it("shows a first donation as one segment", () => {
    const result = progressSegments(5, 500);
    expect(result.filled).toBe(1);
    expect(result.percent).toBe(1);
  });

  it("leaves every segment empty with nothing raised", () => {
    expect(progressSegments(0, 500).filled).toBe(0);
    expect(progressSegments(-3, 500).filled).toBe(0);
  });

  it("caps the segments but not the percent once the goal is passed", () => {
    const result = progressSegments(600, 500);
    expect(result.filled).toBe(10);
    expect(result.percent).toBe(120);
    expect(result.reached).toBe(true);
    expect(progressSegments(500, 500).reached).toBe(true);
  });

  it("has no percent without a goal", () => {
    const result = progressSegments(120, null);
    expect(result.percent).toBeNull();
    expect(result.segments).toHaveLength(10);
    expect(result.filled).toBe(0);
    expect(progressSegments(120, 0).percent).toBeNull();
  });

  it("avoids floating point drift and honours the segment count", () => {
    expect(progressSegments(0.3, 1, 10).filled).toBe(3);
    expect(progressSegments(70, 100, 4).segments).toEqual([true, true, false, false]);
    expect(progressSegments(1, 2, 0).segments).toHaveLength(1);
  });
});
