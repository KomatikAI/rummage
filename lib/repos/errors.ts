/**
 * Errors the Supabase repos throw. Expected refusals (an item already held, a release
 * that does not apply) are returned as typed results instead; RepoError is for reads
 * that failed or for callers who may not see the record at all.
 */

export type RepoErrorCode =
  | "query_failed"
  | "cart_not_found"
  | "cart_not_allowed"
  | "sale_not_found"
  | "not_organizer"
  | "invalid_summary";

export class RepoError extends Error {
  readonly code: RepoErrorCode;
  readonly operation: string;
  /** The Postgres / PostgREST error code, when there was one. */
  readonly dbCode: string | undefined;

  constructor(
    code: RepoErrorCode,
    operation: string,
    message: string,
    dbCode?: string,
  ) {
    super(`${operation}: ${message}`);
    this.name = "RepoError";
    this.code = code;
    this.operation = operation;
    this.dbCode = dbCode;
  }
}

export interface DbError {
  code?: string;
  message: string;
}

export function queryFailed(operation: string, error: DbError): RepoError {
  return new RepoError("query_failed", operation, error.message, error.code);
}
