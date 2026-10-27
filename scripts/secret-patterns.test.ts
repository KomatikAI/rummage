import { describe, expect, it } from "vitest";
import { findSecrets, isBinary } from "./secret-patterns.mjs";

// Samples are assembled at runtime so this file passes the check itself.
const j = (...parts: string[]) => parts.join("");

describe("findSecrets", () => {
  it("flags each secret marker with its line number", () => {
    const text = [
      "const a = 1;",
      j("key = '", "sb_", "secret_", "abc'"),
      j("token: ", "sk-", "ant-", "xyz"),
      j("-----", "BEGIN RSA ", "PRIVATE", " KEY-----"),
      j("auth = ", "eyJhbG", "ciOiJIUzI1NiJ9"),
    ].join("\n");
    expect(findSecrets(text)).toEqual([
      { line: 2, pattern: "Supabase secret key" },
      { line: 3, pattern: "Anthropic API key" },
      { line: 4, pattern: "private key block" },
      { line: 5, pattern: "JWT" },
    ]);
  });

  it("flags secret variables assigned a value", () => {
    for (const line of [
      j("PAYPAL_CLIENT", "_SECRET=abc123"),
      j("export SUPABASE_SERVICE", "_ROLE_KEY='abc'"),
      j("ANTHROPIC_API", '_KEY = "abc"'),
    ]) {
      expect(findSecrets(line)).toEqual([{ line: 1, pattern: "secret variable assignment" }]);
    }
  });

  it("allows empty assignments, names and comparisons", () => {
    const text = [
      j("PAYPAL_CLIENT", "_SECRET="),
      j("ANTHROPIC_API", '_KEY=""'),
      j("SUPABASE_SERVICE", "_ROLE_KEY= # filled in locally"),
      "Set ANTHROPIC_API_KEY in .env.local.",
      j("if (process.env.ANTHROPIC_API", '_KEY === "x") {}'),
    ].join("\n");
    expect(findSecrets(text)).toEqual([]);
  });
});

describe("isBinary", () => {
  it("detects a NUL byte", () => {
    expect(isBinary(new Uint8Array([0x89, 0x50, 0x00, 0x47]))).toBe(true);
    expect(isBinary(new TextEncoder().encode("plain text"))).toBe(false);
  });
});
