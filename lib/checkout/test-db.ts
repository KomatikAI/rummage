import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";

/**
 * Test-only stand-ins for the Supabase clients used by the PayPal routes. Every
 * PostgREST chain is recorded as a FakeQuery and answered by a resolver, so tests
 * can assert on what was read and written without a database.
 */

export type FakeFilter = { column: string; op: "eq" | "in" | "is"; value: unknown };

export type FakeQuery = {
  table: string;
  action: "select" | "update" | "insert" | "upsert" | "delete";
  columns: string | undefined;
  payload: unknown;
  filters: FakeFilter[];
  single: boolean;
};

export type FakeResult = { data: unknown; error: { code?: string; message: string } | null };

export type QueryResolver = (query: FakeQuery) => FakeResult | undefined;
export type RpcResolver = (fn: string, args: unknown) => FakeResult | undefined;

export type RpcCall = { fn: string; args: unknown };

export function fakeDb(resolve: QueryResolver = () => undefined, resolveRpc: RpcResolver = () => undefined) {
  const queries: FakeQuery[] = [];
  const rpcs: RpcCall[] = [];

  const from = (table: string) => {
    const query: FakeQuery = { table, action: "select", columns: undefined, payload: undefined, filters: [], single: false };
    let mutating = false;
    const builder: Record<string, unknown> = {};
    const chain = (fn: (...args: unknown[]) => void) => (...args: unknown[]) => {
      fn(...args);
      return builder;
    };
    const mutate = (action: FakeQuery["action"]) =>
      chain((payload) => {
        query.action = action;
        query.payload = payload;
        mutating = true;
      });
    builder.select = chain((columns) => {
      if (!mutating) query.action = "select";
      query.columns = typeof columns === "string" ? columns : undefined;
    });
    builder.update = mutate("update");
    builder.insert = mutate("insert");
    builder.upsert = mutate("upsert");
    builder.delete = chain(() => {
      query.action = "delete";
      mutating = true;
    });
    builder.eq = chain((column, value) => query.filters.push({ column: String(column), op: "eq", value }));
    builder.in = chain((column, value) => query.filters.push({ column: String(column), op: "in", value }));
    builder.is = chain((column, value) => query.filters.push({ column: String(column), op: "is", value }));
    builder.order = chain(() => undefined);
    builder.limit = chain(() => undefined);
    builder.maybeSingle = chain(() => {
      query.single = true;
    });
    builder.single = builder.maybeSingle;
    builder.then = (onFulfilled: (value: FakeResult) => unknown, onRejected?: (reason: unknown) => unknown) => {
      queries.push(query);
      const result = resolve(query) ?? { data: query.single ? null : [], error: null };
      return Promise.resolve(result).then(onFulfilled, onRejected);
    };
    return builder;
  };

  const client = {
    from,
    rpc: (fn: string, args?: unknown) => {
      rpcs.push({ fn, args });
      return Promise.resolve(resolveRpc(fn, args) ?? { data: null, error: null });
    },
  };

  return { client: client as unknown as SupabaseClient<Database>, queries, rpcs };
}

/** A cookie client whose getClaims returns `userId` (or signed out for null). */
export function fakeSessionClient(userId: string | null): SupabaseClient<Database> {
  const client = {
    auth: {
      getClaims: () =>
        Promise.resolve(userId ? { data: { claims: { sub: userId } }, error: null } : { data: null, error: null }),
    },
  };
  return client as unknown as SupabaseClient<Database>;
}

/** The value of an eq filter on `column`, if any. */
export function eqValue(query: FakeQuery, column: string): unknown {
  return query.filters.find((filter) => filter.column === column && filter.op === "eq")?.value;
}

export const ok = (data: unknown): FakeResult => ({ data, error: null });
export const dbFail = (code = "XX000"): FakeResult => ({ data: null, error: { code, message: "boom" } });

/** A JSON POST request. */
export function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
