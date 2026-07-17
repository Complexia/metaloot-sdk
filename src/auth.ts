// Browser-side Metaloot auth for games.
//
// Games deployed with `metaloot deploy` get these endpoints on their own
// origin, handled at the edge by Metaloot hosting (zero server code):
//
//   GET /auth/metaloot/start     — begins sign-in
//   GET /auth/metaloot/callback  — OAuth callback (never called directly)
//   GET /auth/metaloot/session   — returns { signedIn, user, ... }
//   GET /auth/metaloot/logout    — signs out
//
// Self-hosted games get the same endpoints by mounting the server adapters
// from @metaloot/auth (npm) — this module then works unchanged; pass
// `basePath` if you mounted them under a custom prefix such as
// "/api/auth/metaloot".

import type { FetchLike, MetalootSessionResponse } from "./types.js";

export type AuthOptions = {
  /** Path prefix of the auth endpoints. @default "/auth/metaloot" */
  basePath?: string;
  /** Custom fetch implementation. @default globalThis.fetch */
  fetch?: FetchLike;
};

export const DEFAULT_AUTH_BASE_PATH = "/auth/metaloot";

/**
 * The current player's session, or `{ signedIn: false }` when signed out
 * (or when the endpoint is unreachable — this never throws).
 */
export async function getSession(
  options: AuthOptions = {}
): Promise<MetalootSessionResponse> {
  const doFetch: FetchLike = options.fetch ?? fetch;
  try {
    const response = await doFetch(`${basePath(options)}/session`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return { signedIn: false };
    return (await response.json()) as MetalootSessionResponse;
  } catch {
    return { signedIn: false };
  }
}

/** Navigates to the sign-in flow (full-page redirect, returns to the game). */
export function signIn(options: AuthOptions = {}): void {
  window.location.href = `${basePath(options)}/start`;
}

/** Navigates to the logout endpoint (full-page redirect). */
export function signOut(options: AuthOptions = {}): void {
  window.location.href = `${basePath(options)}/logout`;
}

function basePath(options: AuthOptions): string {
  return (options.basePath ?? DEFAULT_AUTH_BASE_PATH).replace(/\/+$/, "");
}
