// Hosted 3D assets from Metaloot Studio (studio.metaloot.app).
//
// Games don't have to bundle GLB files: every public studio asset has a
// stable URL that serves the binary with CORS enabled, and games deployed on
// Metaloot hosting additionally get a same-origin, edge-cached proxy at
// /__metaloot/assets/<idOrSlug>.glb. This module resolves those URLs and
// fetches metadata/bytes with plain fetch — no engine dependency; feed the
// result to three.js, Babylon, PlayCanvas, or anything else that loads GLB.

import type { FetchLike } from "./types.js";

/** Default origin of Metaloot Studio, which serves the asset APIs. */
export const DEFAULT_STUDIO_ORIGIN = "https://studio.metaloot.app";

export type AssetVisibility = "public" | "private";
export type AssetKind =
  | "model3d"
  | "image"
  | "video"
  | "audio"
  | "sprite"
  | "texture"
  | "animation";
export type AssetStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "cancelled";
export type LodStatus = "queued" | "running" | "success" | "failed";
export type AnimationStatus = "queued" | "running" | "success" | "failed";
/** Rigging phase (prerigcheck + auto-rig) of the animation pipeline. */
export type RigStatus = AnimationStatus;

/** One animated GLB variant (e.g. the "walk" clip) of a rigged asset. */
export type AssetAnimation = {
  status: AnimationStatus;
  /** Absolute URL of the animated GLB (only once status is "success"). */
  url?: string;
};

/**
 * Which model file to serve:
 * - `"auto"` (default): the game-ready LOD (~15k faces) once ready, else the
 *   full-resolution source. The response carries an `X-Metaloot-Variant:
 *   lod|source` header telling you which one you got.
 * - `"source"`: always the full-resolution original.
 * - `"lod"`: the LOD only — 404 until it's ready.
 */
export type AssetVariant = "auto" | "source" | "lod";

/**
 * An asset as returned by the studio JSON APIs
 * (GET /api/assets and GET /api/assets/:idOrSlug).
 */
export type MetalootAsset = {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  description: string;
  visibility: AssetVisibility;
  kind: AssetKind;
  category: string;
  provider: string;
  providerTaskId: string | null;
  status: AssetStatus;
  prompt: string;
  sourceImageKey: string | null;
  fileKey: string | null;
  /** @deprecated Upstream URLs are ingestion-only; the API always returns null. */
  externalFileUrl: null;
  modelKey: string | null;
  previewKey: string | null;
  modelFormat: string | null;
  /** Format returned by `fileUrl`, such as zip, ogg, png, or glb. */
  fileFormat: string | null;
  fileName: string | null;
  /** Curated grouping shown in Explore. */
  collection: string;
  creator: string;
  sourceUrl: string | null;
  license: string;
  licenseUrl: string | null;
  attribution: string | null;
  /** A pack's represented file count; 1/null for individual assets. */
  fileCount: number | null;
  /** Actual number of individually addressable files hosted by Metaloot. */
  hostedFileCount?: number;
  tags: string[];
  creditsUsed: number;
  progress: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  /**
   * Absolute URL of the GLB (resolved against the studio origin). Serves the
   * `auto` variant: the game-ready LOD once ready, else the source model.
   */
  modelUrl?: string;
  /** Universal hosted URL for this asset or pack, regardless of media kind. */
  fileUrl?: string;
  /** Absolute URL of this hosted pack's file inventory. */
  manifestUrl?: string;
  /** Absolute URL of the preview image (resolved against the studio origin). */
  previewUrl?: string;
  /** Absolute URL of the full-resolution source model (when one exists). */
  sourceModelUrl?: string;
  /** Absolute URL of the game-ready LOD (only once `lodStatus` is "success"). */
  lodModelUrl?: string;
  /** Progress of the LOD build; `null` when no LOD has been requested. */
  lodStatus?: LodStatus | null;
  /**
   * Progress of the rigging phase of the animation pipeline; `null` when
   * animations were never requested for this asset.
   */
  rigStatus?: RigStatus | null;
  /**
   * Animated GLB variants keyed by preset ("idle", "walk", "run", …). Each
   * ready entry carries an absolute `url` streaming a GLB that contains the
   * rigged model plus that preset's `AnimationClip` — clips from sibling
   * presets share the same skeleton, so they can drive one mixer.
   */
  animations?: { [preset: string]: AssetAnimation };
};

export type AssetUrlOptions = {
  /**
   * Studio origin override. When set, the URL always points at
   * `<origin>/api/assets/<idOrSlug>/file` (the proxy is never used).
   */
  origin?: string;
  /**
   * On a `<slug>.metaloot.app` game origin, `assetUrl` returns the relative,
   * same-origin proxy path `/__metaloot/assets/<idOrSlug>.glb` (edge-cached,
   * zero CORS concerns). Pass `false` to always use the studio URL.
   * @default true
   */
  preferProxy?: boolean;
  /**
   * Model variant to serve. `"source"` and `"lod"` always use the studio URL
   * (the proxy only serves the default `auto` variant).
   * @default "auto"
   */
  variant?: AssetVariant;
};

export type AssetRequestOptions = {
  /** Studio origin. @default "https://studio.metaloot.app" */
  origin?: string;
  /**
   * Scoped API token (`mtl_api_…`, from metaloot.app/settings/api-tokens) or
   * CLI token (`mtl_cli_…`), sent as an `Authorization: Bearer` header. Only
   * needed for private assets — public assets are served without auth.
   */
  token?: string;
  /** Custom fetch implementation. @default globalThis.fetch */
  fetch?: FetchLike;
  signal?: AbortSignal;
};

export type ListAssetsOptions = AssetRequestOptions & {
  /** Free-text filter over name, category, and tags. */
  query?: string;
  /**
   * `"public"` (default) lists the community gallery; `"private"` lists the
   * authenticated owner's assets and requires `token`.
   */
  scope?: "public" | "private";
  /** Exact category filter (case-insensitive), e.g. `"Characters"`. */
  category?: string;
  /** Asset kind filter, e.g. `"model3d"`. */
  kind?: AssetKind;
};

export type LoadAssetOptions = AssetRequestOptions &
  Pick<AssetUrlOptions, "preferProxy" | "variant">;

export type AssetFileUrlOptions = Pick<AssetUrlOptions, "origin"> & {
  /** Manifest-relative path for one hosted pack file; omit for the pack ZIP. */
  path?: string;
};

export type LoadAssetFileOptions = AssetRequestOptions & {
  /** Manifest-relative path for one hosted pack file; omit for the pack ZIP. */
  path?: string;
  /** MIME type used by `loadAssetFileObjectUrl`. */
  contentType?: string;
};

export type AssetPackFile = {
  path: string;
  bytes: number;
  contentType: string;
  sha256: string;
};

export type AssetPackManifest = {
  schemaVersion: 1;
  id: string;
  slug: string;
  name: string;
  creator: string;
  license: string;
  archive: { url: string; bytes: number; sha256: string };
  files: AssetPackFile[];
};

/** Request options for one rigged animation GLB. */
export type LoadAnimationOptions = AssetRequestOptions;

// Mirrors metaloot-hosting: these subdomains never serve a game, so the
// same-origin proxy does not exist there.
const RESERVED_HOSTS = new Set([
  "www", "api", "app", "auth", "oauth", "admin", "mail", "smtp", "docs",
  "cdn", "assets", "static", "media", "staging", "dev", "test", "play",
  "portal", "metaloot", "blog", "status", "help", "support", "dashboard",
  "studio",
]);

const ROOT_DOMAIN = "metaloot.app";

/** True when running in a browser on a `<slug>.metaloot.app` game origin. */
export function onMetalootHosting(): boolean {
  if (typeof location === "undefined" || !location.hostname) return false;
  const hostname = location.hostname.toLowerCase();
  if (!hostname.endsWith(`.${ROOT_DOMAIN}`)) return false;
  const label = hostname.slice(0, -(ROOT_DOMAIN.length + 1));
  if (!label || label.includes(".") || RESERVED_HOSTS.has(label)) return false;
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label);
}

/**
 * Stable hosted URL for an asset's GLB. Accepts an asset id or slug.
 *
 * - On a `<slug>.metaloot.app` game origin (and unless `preferProxy: false`
 *   or `origin` is set): the relative proxy path
 *   `/__metaloot/assets/<idOrSlug>.glb` — same-origin and edge-cached.
 * - Everywhere else: `<studio origin>/api/assets/<idOrSlug>/file`, which
 *   serves public assets with `Access-Control-Allow-Origin: *`.
 *
 * Both serve the `auto` variant by default (the game-ready LOD once ready,
 * else the source model). Pass `variant: "source"` or `"lod"` for a specific
 * file — those always use the studio URL, since the proxy only serves `auto`.
 */
export function assetUrl(idOrSlug: string, options: AssetUrlOptions = {}): string {
  const encoded = encodeURIComponent(idOrSlug);
  const variant = options.variant ?? "auto";
  if (
    variant === "auto" &&
    !options.origin &&
    options.preferProxy !== false &&
    onMetalootHosting()
  ) {
    return `/__metaloot/assets/${encoded}.glb`;
  }
  const query = variant === "auto" ? "" : `?variant=${variant}`;
  return `${studioOrigin(options.origin)}/api/assets/${encoded}/file${query}`;
}

/**
 * Universal file URL for any Metaloot catalog entry: GLB, image, audio,
 * animation, texture, or downloadable pack. Unlike `assetUrl`, this always
 * uses Studio because the game-hosting proxy is deliberately GLB-only.
 */
export function assetFileUrl(
  idOrSlug: string,
  options: AssetFileUrlOptions = {}
): string {
  const url = new URL(`/api/assets/${encodeURIComponent(idOrSlug)}/file`, studioOrigin(options.origin));
  if (options.path) url.searchParams.set("path", options.path);
  return url.toString();
}

/** Stable Metaloot-hosted manifest URL for a pack. */
export function assetManifestUrl(
  idOrSlug: string,
  options: Pick<AssetUrlOptions, "origin"> = {}
): string {
  return `${studioOrigin(options.origin)}/api/assets/${encodeURIComponent(idOrSlug)}/manifest`;
}

/**
 * Stable hosted URL for one animated GLB variant of an asset (e.g. the
 * "walk" clip): `<studio origin>/api/assets/<idOrSlug>/animation/<preset>`.
 * Public assets are served with `Access-Control-Allow-Origin: *`; the URL
 * 404s until that preset's animation has finished building. Prefer the
 * `animations` map on `getAsset()` when you need readiness info.
 */
export function animationUrl(
  idOrSlug: string,
  preset: string,
  options: Pick<AssetUrlOptions, "origin"> = {}
): string {
  return `${studioOrigin(options.origin)}/api/assets/${encodeURIComponent(idOrSlug)}/animation/${encodeURIComponent(preset)}`;
}

/** Typed metadata for one asset (GET /api/assets/:idOrSlug). */
export async function getAsset(
  idOrSlug: string,
  options: AssetRequestOptions = {}
): Promise<MetalootAsset> {
  const origin = studioOrigin(options.origin);
  const response = await studioFetch(
    `${origin}/api/assets/${encodeURIComponent(idOrSlug)}`,
    options
  );
  if (!response.ok) {
    throw new Error(`Metaloot asset "${idOrSlug}" not found (HTTP ${response.status}).`);
  }
  const body = (await response.json()) as { asset: MetalootAsset };
  return resolveAssetUrls(body.asset, origin);
}

/** Typed metadata for many assets (GET /api/assets). */
export async function listAssets(
  options: ListAssetsOptions = {}
): Promise<MetalootAsset[]> {
  const origin = studioOrigin(options.origin);
  const url = new URL("/api/assets", origin);
  if (options.scope) url.searchParams.set("scope", options.scope);
  if (options.query) url.searchParams.set("q", options.query);
  if (options.category) url.searchParams.set("category", options.category);
  if (options.kind) url.searchParams.set("kind", options.kind);
  const response = await studioFetch(url.toString(), options);
  if (!response.ok) {
    throw new Error(`Could not list Metaloot assets (HTTP ${response.status}).`);
  }
  const body = (await response.json()) as { assets: MetalootAsset[] };
  return body.assets.map((asset) => resolveAssetUrls(asset, origin));
}

/** Fetch the inventory for a hosted pack, including paths, MIME types and hashes. */
export async function getAssetManifest(
  idOrSlug: string,
  options: AssetRequestOptions = {}
): Promise<AssetPackManifest> {
  const response = await studioFetch(assetManifestUrl(idOrSlug, { origin: options.origin }), options);
  if (!response.ok) {
    throw new Error(`Could not load Metaloot pack manifest "${idOrSlug}" (HTTP ${response.status}).`);
  }
  const manifest = await response.json() as AssetPackManifest;
  return {
    ...manifest,
    archive: {
      ...manifest.archive,
      url: new URL(manifest.archive.url, studioOrigin(options.origin)).toString(),
    },
  };
}

/**
 * Fetches an asset's GLB and returns the raw bytes. Engine-agnostic: pass the
 * ArrayBuffer to three.js `GLTFLoader.parse`, Babylon, etc. — or use
 * `loadAssetObjectUrl` for loaders that want a URL.
 */
export async function loadAsset(
  idOrSlug: string,
  options: LoadAssetOptions = {}
): Promise<ArrayBuffer> {
  // The proxy serves public assets without auth, so a token means we must
  // talk to the studio origin directly.
  const url = options.token
    ? assetUrl(idOrSlug, { origin: studioOrigin(options.origin), variant: options.variant })
    : assetUrl(idOrSlug, options);
  const response = await studioFetch(url, options);
  if (!response.ok) {
    throw new Error(
      `Could not load Metaloot asset "${idOrSlug}" (HTTP ${response.status}). ` +
        "Private assets need a token; hot-linking works for public assets."
    );
  }
  return response.arrayBuffer();
}

/**
 * Browser helper: fetches the GLB and returns a `blob:` object URL, ready for
 * `new GLTFLoader().load(url, …)`. Call `URL.revokeObjectURL` when done.
 */
export async function loadAssetObjectUrl(
  idOrSlug: string,
  options: LoadAssetOptions = {}
): Promise<string> {
  const buffer = await loadAsset(idOrSlug, options);
  return URL.createObjectURL(new Blob([buffer], { type: "model/gltf-binary" }));
}

/** Fetch any catalog entry's primary file as raw bytes. */
export async function loadAssetFile(
  idOrSlug: string,
  options: LoadAssetFileOptions = {}
): Promise<ArrayBuffer> {
  const response = await studioFetch(assetFileUrl(idOrSlug, { origin: options.origin, path: options.path }), options);
  if (!response.ok) {
    throw new Error(
      `Could not load Metaloot file "${idOrSlug}" (HTTP ${response.status}).`
    );
  }
  return response.arrayBuffer();
}

/** Browser helper for images, audio, video, archives, and other non-GLB assets. */
export async function loadAssetFileObjectUrl(
  idOrSlug: string,
  options: LoadAssetFileOptions = {}
): Promise<string> {
  const buffer = await loadAssetFile(idOrSlug, options);
  return URL.createObjectURL(new Blob([buffer], {
    type: options.contentType ?? "application/octet-stream",
  }));
}

/**
 * Fetches one rigged animation GLB and returns its raw bytes. The GLB contains
 * the skinned model plus the requested animation clip. This mirrors
 * `loadAsset`, including token/custom-fetch/signal support, so games do not
 * need to bypass the SDK to consume animation variants.
 */
export async function loadAnimation(
  idOrSlug: string,
  preset: string,
  options: LoadAnimationOptions = {}
): Promise<ArrayBuffer> {
  const url = animationUrl(idOrSlug, preset, { origin: options.origin });
  // Studio may repair a provider retarget in place after pose validation.
  // Revalidate the stable URL so cached broken bytes do not survive a repair.
  const response = await studioFetch(url, options, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(
      `Could not load Metaloot animation "${preset}" for asset "${idOrSlug}" ` +
        `(HTTP ${response.status}). The preset must be ready; private assets need a token.`
    );
  }
  return response.arrayBuffer();
}

/**
 * Browser helper for animation-aware engine loaders. Call
 * `URL.revokeObjectURL` after the loader has consumed the returned URL.
 */
export async function loadAnimationObjectUrl(
  idOrSlug: string,
  preset: string,
  options: LoadAnimationOptions = {}
): Promise<string> {
  const buffer = await loadAnimation(idOrSlug, preset, options);
  return URL.createObjectURL(new Blob([buffer], { type: "model/gltf-binary" }));
}

function studioOrigin(origin?: string): string {
  return (origin ?? DEFAULT_STUDIO_ORIGIN).replace(/\/+$/, "");
}

function studioFetch(
  url: string,
  options: AssetRequestOptions,
  init: Pick<RequestInit, "cache"> = {},
): Promise<Response> {
  const doFetch: FetchLike = options.fetch ?? fetch;
  const headers: Record<string, string> = {};
  if (options.token) headers["Authorization"] = `Bearer ${options.token}`;
  return doFetch(url, { ...init, headers, signal: options.signal });
}

function resolveAssetUrls(asset: MetalootAsset, origin: string): MetalootAsset {
  let animations: MetalootAsset["animations"];
  for (const [preset, animation] of Object.entries(asset.animations ?? {})) {
    animations ??= {};
    animations[preset] = {
      ...animation,
      url: animation.url ? new URL(animation.url, origin).toString() : animation.url,
    };
  }
  return {
    ...asset,
    animations,
    fileUrl: asset.fileUrl ? new URL(asset.fileUrl, origin).toString() : asset.fileUrl,
    manifestUrl: asset.manifestUrl ? new URL(asset.manifestUrl, origin).toString() : asset.manifestUrl,
    modelUrl: asset.modelUrl ? new URL(asset.modelUrl, origin).toString() : asset.modelUrl,
    previewUrl: asset.previewUrl
      ? new URL(asset.previewUrl, origin).toString()
      : asset.previewUrl,
    sourceModelUrl: asset.sourceModelUrl
      ? new URL(asset.sourceModelUrl, origin).toString()
      : asset.sourceModelUrl,
    lodModelUrl: asset.lodModelUrl
      ? new URL(asset.lodModelUrl, origin).toString()
      : asset.lodModelUrl,
  };
}
