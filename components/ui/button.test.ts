import { describe, expect, it } from "vitest";

import { buttonClasses } from "./button";

describe("buttonClasses", () => {
  it("defaults to a primary, medium, 44 px button", () => {
    const classes = buttonClasses();
    expect(classes).toContain("bg-accent");
    expect(classes).toContain("min-h-tap");
  });

  it("keeps the 44 px target at the small size", () => {
    expect(buttonClasses({ size: "sm" })).toContain("min-h-tap");
  });

  it("applies the variant, full width and extra classes", () => {
    const classes = buttonClasses({ variant: "danger", fullWidth: true, className: "mt-4" });
    expect(classes).toContain("bg-danger");
    expect(classes).not.toContain("bg-accent");
    expect(classes).toContain("w-full");
    expect(classes.endsWith("mt-4")).toBe(true);
  });
});
