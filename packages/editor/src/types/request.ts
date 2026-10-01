/** Publication decision for work guarded by a latest-request boundary. */
export type LatestRequestResult<T> =
  | { readonly status: "current"; readonly result: T }
  | { readonly status: "stale" };
