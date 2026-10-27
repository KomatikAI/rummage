import { describe, expect, it } from "vitest";

import { DEFAULT_AFTER_SIGN_IN, friendlyAuthError, safeNext, validateCredentials } from "./auth-helpers";

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/seller")).toBe("/seller");
    expect(safeNext("/sale/demo?item=3#map")).toBe("/sale/demo?item=3#map");
  });

  it("falls back for anything that could leave the site", () => {
    expect(safeNext("https://elsewhere.example")).toBe(DEFAULT_AFTER_SIGN_IN);
    expect(safeNext("//elsewhere.example")).toBe(DEFAULT_AFTER_SIGN_IN);
    expect(safeNext("/\\elsewhere.example")).toBe(DEFAULT_AFTER_SIGN_IN);
    expect(safeNext("javascript:alert(1)")).toBe(DEFAULT_AFTER_SIGN_IN);
    expect(safeNext("/a\nb")).toBe(DEFAULT_AFTER_SIGN_IN);
    expect(safeNext("")).toBe(DEFAULT_AFTER_SIGN_IN);
    expect(safeNext(null)).toBe(DEFAULT_AFTER_SIGN_IN);
  });

  it("uses the given fallback", () => {
    expect(safeNext(undefined, "/")).toBe("/");
  });
});

describe("validateCredentials", () => {
  it("passes a good email and password", () => {
    expect(validateCredentials("pat@example.com", "longenough", "sign-up")).toBeNull();
    expect(validateCredentials("pat@example.com", "short", "sign-in")).toBeNull();
  });

  it("names each missing or malformed field", () => {
    expect(validateCredentials("", "", "sign-in")).toEqual({
      email: "Enter your email.",
      password: "Enter your password.",
    });
    expect(validateCredentials("pat", "x", "sign-in")).toEqual({ email: "That email does not look right." });
  });

  it("asks for a longer password only on sign-up", () => {
    expect(validateCredentials("pat@example.com", "short", "sign-up")).toEqual({
      password: "Use at least 8 characters.",
    });
  });
});

describe("friendlyAuthError", () => {
  it("explains a wrong password plainly", () => {
    expect(friendlyAuthError({ code: "invalid_credentials" })).toBe("That email and password do not match. Try again.");
    expect(friendlyAuthError({ message: "Invalid login credentials" })).toBe(
      "That email and password do not match. Try again.",
    );
  });

  it("covers confirmation, duplicates and rate limits", () => {
    expect(friendlyAuthError({ code: "email_not_confirmed" })).toMatch(/confirm your email/);
    expect(friendlyAuthError({ message: "User already registered" })).toMatch(/Sign in instead/);
    expect(friendlyAuthError({ status: 429 })).toMatch(/Too many tries/);
  });

  it("never echoes raw error text and never uses exclamation marks", () => {
    const text = friendlyAuthError({ message: "AuthApiError: database exploded at row 7" });
    expect(text).toBe("Something went wrong. Try again in a moment.");
    expect(text).not.toContain("!");
  });
});
