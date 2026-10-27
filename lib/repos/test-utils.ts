/**
 * Test-only in-memory stand-in for the Supabase client: just the PostgREST chains and
 * `.rpc()` the repos and routes use, evaluated against plain row arrays, plus
 * `auth.getClaims()`. Every query and RPC is recorded in `calls`.
 */

import type { RummageClient } from "@/lib/supabase/server";

export type FakeRow = Record<string, unknown>;
export interface FakeError {
  code?: string;
  message: string;
}
export interface FakeResult {
  data: unknown;
  error: FakeError | null;
}
export type FakeRpcHandler = (args: Record<string, unknown>, db: FakeSupabase) => FakeResult;

export interface FakeCall {
  kind: "select" | "insert" | "rpc";
  table: string;
  /** Filters in call order, e.g. "eq:sale_id:s1", "or:title.ilike.%lamp%". */
  filters: string[];
  args?: unknown;
}

type Predicate = (row: FakeRow) => boolean;

function likeToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[%*]/g, ".*");
  return new RegExp(`^${escaped}$`, "is");
}

function compare(value: unknown, other: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && typeof other === "number") return value - other;
  return String(value).localeCompare(String(other));
}

function predicateFor(column: string, op: string, value: unknown): Predicate {
  switch (op) {
    case "eq":
      return (row) => row[column] === value;
    case "neq":
      return (row) => row[column] !== value;
    case "lte":
      return (row) => (compare(row[column], value) ?? 1) <= 0;
    case "gte":
      return (row) => (compare(row[column], value) ?? -1) >= 0;
    case "ilike":
    case "like": {
      const re = likeToRegExp(String(value));
      return (row) => typeof row[column] === "string" && re.test(row[column] as string);
    }
    default:
      throw new Error(`FakeSupabase: unsupported filter operator "${op}"`);
  }
}

/** Parses a flat PostgREST `or` expression: "col.op.value,col.op.value". */
function parseOr(expression: string): Predicate {
  const terms = expression.split(",").map((term) => {
    const [column, op, ...rest] = term.split(".");
    const raw = rest.join(".");
    const value = op === "lte" || op === "gte" ? Number(raw) : raw;
    return predicateFor(column, op, value);
  });
  return (row) => terms.some((term) => term(row));
}

function project(row: FakeRow, columns: string): FakeRow {
  if (columns.trim() === "*") return { ...row };
  const out: FakeRow = {};
  for (const column of columns.split(",").map((c) => c.trim()).filter(Boolean)) {
    out[column] = row[column];
  }
  return out;
}

class FakeQuery implements PromiseLike<FakeResult> {
  private op: "select" | "insert" = "select";
  private columns = "*";
  private readonly predicates: Predicate[] = [];
  private readonly filters: string[] = [];
  private orderBy: { column: string; ascending: boolean }[] = [];
  private limitTo: number | null = null;
  private mode: "many" | "single" | "maybe" = "many";
  private inserted: FakeRow[] = [];

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string,
  ) {}

  select(columns = "*") {
    this.columns = columns;
    return this;
  }
  insert(rows: FakeRow | FakeRow[]) {
    this.op = "insert";
    this.inserted = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  private filter(op: string, column: string, value: unknown) {
    this.filters.push(`${op}:${column}:${JSON.stringify(value)}`);
    this.predicates.push(predicateFor(column, op, value));
    return this;
  }
  eq(column: string, value: unknown) {
    return this.filter("eq", column, value);
  }
  neq(column: string, value: unknown) {
    return this.filter("neq", column, value);
  }
  lte(column: string, value: unknown) {
    return this.filter("lte", column, value);
  }
  gte(column: string, value: unknown) {
    return this.filter("gte", column, value);
  }
  ilike(column: string, value: string) {
    return this.filter("ilike", column, value);
  }
  in(column: string, values: readonly unknown[]) {
    this.filters.push(`in:${column}:${JSON.stringify(values)}`);
    this.predicates.push((row) => values.includes(row[column]));
    return this;
  }
  or(expression: string) {
    this.filters.push(`or:${expression}`);
    this.predicates.push(parseOr(expression));
    return this;
  }
  order(column: string, options: { ascending?: boolean } = {}) {
    this.orderBy.push({ column, ascending: options.ascending ?? true });
    return this;
  }
  limit(count: number) {
    this.limitTo = count;
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }

  then<T1 = FakeResult, T2 = never>(
    onfulfilled?: ((value: FakeResult) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve()
      .then(() => this.execute())
      .then(onfulfilled, onrejected);
  }

  private execute(): FakeResult {
    this.db.calls.push({ kind: this.op, table: this.table, filters: [...this.filters] });
    const failure = this.db.takeFailure(this.table, this.op);
    if (failure) return { data: null, error: failure };

    let rows: FakeRow[];
    if (this.op === "insert") {
      const defaults = this.db.insertDefaults[this.table];
      rows = this.inserted.map((row) => ({ ...(defaults ? defaults(row) : {}), ...row }));
      (this.db.tables[this.table] ??= []).push(...rows);
    } else {
      rows = (this.db.tables[this.table] ?? []).filter((row) =>
        this.predicates.every((p) => p(row)),
      );
      for (const { column, ascending } of [...this.orderBy].reverse()) {
        rows = [...rows].sort((a, b) => {
          const c = compare(a[column], b[column]) ?? 0;
          return ascending ? c : -c;
        });
      }
      if (this.limitTo !== null) rows = rows.slice(0, this.limitTo);
    }
    const data = rows.map((row) => project(row, this.columns));

    if (this.mode === "many") return { data, error: null };
    if (data.length > 1) {
      return { data: null, error: { code: "PGRST116", message: "multiple rows returned" } };
    }
    if (data.length === 0) {
      return this.mode === "maybe"
        ? { data: null, error: null }
        : { data: null, error: { code: "PGRST116", message: "no rows returned" } };
    }
    return { data: data[0], error: null };
  }
}

export class FakeSupabase {
  tables: Record<string, FakeRow[]>;
  rpcHandlers: Record<string, FakeRpcHandler> = {};
  insertDefaults: Record<string, (row: FakeRow) => FakeRow> = {};
  userId: string | null;
  readonly calls: FakeCall[] = [];
  private readonly failures = new Map<string, FakeError[]>();

  constructor(options: { tables?: Record<string, FakeRow[]>; userId?: string | null } = {}) {
    this.tables = options.tables ?? {};
    this.userId = options.userId === undefined ? "user-1" : options.userId;
  }

  /** Makes the next `op` on `table` (or the next call of rpc `table`) return `error`. */
  failNext(table: string, op: "select" | "insert" | "rpc", error: FakeError): this {
    const key = `${op}:${table}`;
    this.failures.set(key, [...(this.failures.get(key) ?? []), error]);
    return this;
  }

  takeFailure(table: string, op: "select" | "insert" | "rpc"): FakeError | undefined {
    const queue = this.failures.get(`${op}:${table}`);
    return queue?.shift();
  }

  callsTo(table: string): FakeCall[] {
    return this.calls.filter((call) => call.table === table);
  }

  get client(): RummageClient {
    const client = {
      from: (table: string) => new FakeQuery(this, table),
      rpc: (fn: string, args: Record<string, unknown> = {}) => {
        this.calls.push({ kind: "rpc", table: fn, filters: [], args });
        const failure = this.takeFailure(fn, "rpc");
        if (failure) return Promise.resolve({ data: null, error: failure });
        const handler = this.rpcHandlers[fn];
        return Promise.resolve(
          handler
            ? handler(args, this)
            : { data: null, error: { code: "PGRST202", message: `no rpc ${fn}` } },
        );
      },
      auth: {
        getClaims: () =>
          Promise.resolve(
            this.userId
              ? { data: { claims: { sub: this.userId } }, error: null }
              : { data: null, error: null },
          ),
      },
    };
    // The one boundary cast: the stub covers only the surface the repos use.
    return client as unknown as RummageClient;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const SALE_ID = "a0000000-0000-4000-8000-000000000001";
export const OTHER_SALE_ID = "a0000000-0000-4000-8000-000000000002";
export const CART_ID = "c0000000-0000-4000-8000-000000000001";
export const BUYER_ID = "d0000000-0000-4000-8000-000000000001";
export const ORGANIZER_ID = "d0000000-0000-4000-8000-000000000009";

export function itemId(n: number): string {
  return `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export function listing(n: number, overrides: FakeRow = {}): FakeRow {
  return {
    item_id: itemId(n),
    sale_id: SALE_ID,
    sale_slug: "forest-park",
    household_id: "b0000000-0000-4000-8000-000000000001",
    household_label: "The Alvarez table",
    public_lng: -90.29,
    public_lat: 38.64,
    accepts_paypal: true,
    title: `Item ${n}`,
    description: null,
    category: "other",
    condition: "good",
    price: 5,
    price_low: null,
    price_high: null,
    price_reason: null,
    photo_path: null,
    status: "listed",
    created_at: `2026-10-27T10:00:${String(n).padStart(2, "0")}Z`,
    ...overrides,
  };
}

export function summaryJson(overrides: FakeRow = {}): FakeRow {
  return {
    sale_id: SALE_ID,
    households: 2,
    households_linked: 1,
    items_listed: 5,
    items_held: 1,
    items_sold: 3,
    items_collected: 1,
    items_cash_sold: 1,
    gross_total: 42.5,
    cash_total: 4,
    fundraiser_total: 10,
    per_household: [
      {
        household_id: "b0000000-0000-4000-8000-000000000001",
        label: "Oak corner",
        paypal_status: "ready",
        paused: false,
        items_listed: 3,
        items_held: 1,
        items_sold: 3,
        items_collected: 1,
        items_cash_sold: 0,
        cash_total: 0,
        gross: 42.5,
      },
      {
        household_id: "b0000000-0000-4000-8000-000000000002",
        label: "The Lindqvist stall",
        paypal_status: "unlinked",
        paused: false,
        items_listed: 2,
        items_held: 0,
        items_sold: 0,
        items_collected: 0,
        items_cash_sold: 1,
        cash_total: 4,
        gross: 0,
      },
    ],
    ...overrides,
  };
}
