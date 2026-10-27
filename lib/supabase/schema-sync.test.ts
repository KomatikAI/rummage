import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { TABLE_COLUMNS, type TableName } from "./types";

/*
 * Static checks on the SQL so the hand-written types and the migrations cannot drift,
 * and the security invariants stay visible in review. These read the files; they do not
 * need a database.
 */

const root = fileURLToPath(new URL("../../supabase", import.meta.url));
const migrationsDir = join(root, "migrations");
const migrationSql = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(join(migrationsDir, file), "utf8"))
  .join("\n");
const seedSql = readFileSync(join(root, "seed.sql"), "utf8");

const COLUMN_LINE =
  /^([a-z_]+)\s+(uuid|text|date|time|timestamptz|double precision|integer|numeric|boolean|jsonb)\b/;

function createTableColumns(sql: string): Map<string, string[]> {
  const tables = new Map<string, string[]>();
  for (const match of sql.matchAll(/create table public\.(\w+) \(([\s\S]*?)\n\);/g)) {
    const columns = match[2]
      .split("\n")
      .map((line) => line.trim())
      .map((line) => COLUMN_LINE.exec(line)?.[1])
      .filter((name): name is string => name !== undefined);
    tables.set(match[1], columns);
  }
  return tables;
}

describe("migration vs types.ts", () => {
  const tables = createTableColumns(migrationSql);

  it("creates exactly the tables types.ts knows", () => {
    expect([...tables.keys()].sort()).toEqual(Object.keys(TABLE_COLUMNS).sort());
  });

  for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
    it(`has the same columns for ${table}`, () => {
      expect(tables.get(table)).toEqual([...columns]);
    });
  }

  it("enables and forces RLS on every table", () => {
    for (const table of Object.keys(TABLE_COLUMNS) as TableName[]) {
      expect(migrationSql).toContain(`alter table public.${table} enable row level security;`);
      expect(migrationSql).toContain(`alter table public.${table} force row level security;`);
    }
  });

  it("revokes default access on every SECURITY DEFINER function", () => {
    const chunks = migrationSql.split(/create or replace function /).slice(1);
    const definers = chunks
      .filter((chunk) => /\bsecurity definer\b/.test(chunk.slice(0, chunk.indexOf("as $$"))))
      .map((chunk) => chunk.slice(0, chunk.indexOf("(")));
    expect(definers.length).toBeGreaterThanOrEqual(12);
    for (const name of definers) {
      const revoke = new RegExp(
        `revoke all on function ${name.replace(".", "\\.")}\\([^)]*\\) from public, anon, authenticated;`,
      );
      expect(migrationSql, name).toMatch(revoke);
    }
  });

  it("grants the service-only functions to service_role alone", () => {
    for (const fn of ["release_expired_holds()", "mark_units_captured(uuid, jsonb)"]) {
      const grants = [...migrationSql.matchAll(/grant execute on function public\.([a-z_]+\([^)]*\)) to ([^;]+);/g)]
        .filter((m) => m[1] === fn)
        .map((m) => m[2]);
      expect(grants, fn).toEqual(["service_role"]);
    }
  });

  it("never exposes exact coordinates through the public view", () => {
    const view = /create view public\.public_listings[\s\S]*?;\n/.exec(migrationSql)?.[0] ?? "";
    expect(view).not.toBe("");
    expect(view).not.toMatch(/exact_/);
    expect(view).not.toMatch(/pickup_code/);
  });
});

describe("seed.sql", () => {
  // Forest Park, St. Louis (OpenStreetMap bounding box), shrunk by ~400 m on every side
  // so the 60-180 m public jitter cannot leave the park.
  const park = { south: 38.6289, north: 38.6477, west: -90.3043, east: -90.2633 };
  const marginLat = 400 / 111320;
  const marginLng = 400 / (111320 * Math.cos((38.638 * Math.PI) / 180));

  const households = [
    ...seedSql.matchAll(
      /\('(b0000000-[0-9a-f-]+)', 'a0000000-[0-9a-f-]+', null,\s*'[^']+', (-?\d+\.\d+), (-?\d+\.\d+), (?:'SANDBOX_SELLER_\d'|null), '(ready|unlinked)'/g,
    ),
  ];
  const items = [...seedSql.matchAll(/\('(c0000000-[0-9a-f-]+)', '(b0000000-[0-9a-f-]+)',/g)];
  const itemStatuses = [...seedSql.matchAll(/'seed\/[a-z0-9-]+\.jpg', '([a-z_]+)'\)/g)].map((m) => m[1]);

  it("seeds six households, three of them ready", () => {
    expect(households).toHaveLength(6);
    expect(households.filter((h) => h[4] === "ready")).toHaveLength(3);
  });

  it("puts every household pin well inside the park", () => {
    for (const [, id, lngText, latText] of households) {
      const lng = Number(lngText);
      const lat = Number(latText);
      expect(lat, id).toBeGreaterThan(park.south + marginLat);
      expect(lat, id).toBeLessThan(park.north - marginLat);
      expect(lng, id).toBeGreaterThan(park.west + marginLng);
      expect(lng, id).toBeLessThan(park.east - marginLng);
    }
  });

  it("seeds about 40 items with unique ids on known households", () => {
    const householdIds = new Set(households.map((h) => h[1]));
    expect(items).toHaveLength(40);
    expect(new Set(items.map((m) => m[1])).size).toBe(40);
    for (const [, , householdId] of items) {
      expect(householdIds.has(householdId)).toBe(true);
    }
  });

  it("lists everything except two sold and one cash_sold item", () => {
    expect(itemStatuses).toHaveLength(40);
    expect(itemStatuses.filter((s) => s === "sold")).toHaveLength(2);
    expect(itemStatuses.filter((s) => s === "cash_sold")).toHaveLength(1);
    expect(itemStatuses.filter((s) => s === "listed")).toHaveLength(37);
  });

  it("is idempotent", () => {
    const inserts = seedSql.match(/insert into /g) ?? [];
    const guarded = seedSql.match(/on conflict do nothing;/g) ?? [];
    expect(guarded.length).toBe(inserts.length);
  });
});
