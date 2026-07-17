/** The Metaloot player, as returned by /auth/metaloot/session. */
export type MetalootUser = {
  id: string;
  email?: string;
  name?: string;
  imageUrl?: string;
};

/**
 * Response shape of GET /auth/metaloot/session (the endpoint every game on
 * Metaloot hosting has, and that @metaloot/auth provides for self-hosted
 * games). Matches @metaloot/auth's MetalootSessionResponse.
 */
export type MetalootSessionResponse =
  | {
      signedIn: true;
      user: MetalootUser;
      scope: string;
      expiresAt: string;
    }
  | {
      signedIn: false;
    };

/** A fetch-compatible function; lets callers inject a custom fetch. */
export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;
