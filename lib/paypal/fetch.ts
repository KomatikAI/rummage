/** The fetch implementation every PayPal module uses. Tests swap it out. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

let current: FetchLike = defaultFetch;

export function getPayPalFetch(): FetchLike {
  return current;
}

/** Replaces the fetch used by token.ts and client.ts. Pass undefined to restore the global fetch. */
export function setPayPalFetch(impl: FetchLike | undefined): void {
  current = impl ?? defaultFetch;
}
