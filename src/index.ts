// @metaloot/sdk — hosted game assets, player auth, and multiplayer rooms for
// games on Metaloot (https://metaloot.app).
//
//   import { createMetaloot } from "@metaloot/sdk";
//
//   const ml = createMetaloot();
//   const session = await ml.auth.getSession();
//   const glb = await ml.assets.loadAsset("treasure-chest-1a2b3c4d");
//   const room = await ml.multiplayer.joinRoom("lobby");

import {
  animationUrl,
  assetFileUrl,
  assetManifestUrl,
  assetUrl,
  getAssetManifest,
  getAsset,
  listAssets,
  loadAnimation,
  loadAnimationObjectUrl,
  loadAsset,
  loadAssetFile,
  loadAssetFileObjectUrl,
  loadAssetObjectUrl,
} from "./assets.js";
import type {
  AssetRequestOptions,
  AssetFileUrlOptions,
  AssetUrlOptions,
  ListAssetsOptions,
  LoadAnimationOptions,
  LoadAssetFileOptions,
  LoadAssetOptions,
  MetalootAsset,
} from "./assets.js";
import { getSession, signIn, signOut } from "./auth.js";
import { joinRoom } from "./multiplayer.js";
import type { JoinRoomOptions, Room } from "./multiplayer.js";
import type { FetchLike, MetalootSessionResponse } from "./types.js";

export type MetalootOptions = {
  /** Studio origin for asset APIs. @default "https://studio.metaloot.app" */
  studioOrigin?: string;
  /**
   * Metaloot CLI token (`mlt_…`) for private-asset access; never needed in
   * browser game code for public assets.
   */
  token?: string;
  /** Path prefix of the game's auth endpoints. @default "/auth/metaloot" */
  authBasePath?: string;
  /** Custom fetch implementation. @default globalThis.fetch */
  fetch?: FetchLike;
};

export type Metaloot = {
  auth: {
    getSession(): Promise<MetalootSessionResponse>;
    signIn(): void;
    signOut(): void;
  };
  assets: {
    assetUrl(idOrSlug: string, options?: AssetUrlOptions): string;
    assetFileUrl(idOrSlug: string, options?: AssetFileUrlOptions): string;
    assetManifestUrl(idOrSlug: string, options?: Pick<AssetUrlOptions, "origin">): string;
    animationUrl(idOrSlug: string, preset: string, options?: Pick<AssetUrlOptions, "origin">): string;
    getAsset(idOrSlug: string, options?: AssetRequestOptions): Promise<MetalootAsset>;
    getAssetManifest(idOrSlug: string, options?: AssetRequestOptions): Promise<import("./assets.js").AssetPackManifest>;
    listAssets(options?: ListAssetsOptions): Promise<MetalootAsset[]>;
    loadAnimation(idOrSlug: string, preset: string, options?: LoadAnimationOptions): Promise<ArrayBuffer>;
    loadAnimationObjectUrl(idOrSlug: string, preset: string, options?: LoadAnimationOptions): Promise<string>;
    loadAsset(idOrSlug: string, options?: LoadAssetOptions): Promise<ArrayBuffer>;
    loadAssetFile(idOrSlug: string, options?: LoadAssetFileOptions): Promise<ArrayBuffer>;
    loadAssetFileObjectUrl(idOrSlug: string, options?: LoadAssetFileOptions): Promise<string>;
    loadAssetObjectUrl(idOrSlug: string, options?: LoadAssetOptions): Promise<string>;
  };
  multiplayer: {
    joinRoom(roomId?: string, options?: JoinRoomOptions): Promise<Room>;
  };
};

/** Creates a Metaloot client with shared defaults for all three modules. */
export function createMetaloot(options: MetalootOptions = {}): Metaloot {
  const authOptions = { basePath: options.authBasePath, fetch: options.fetch };
  const assetDefaults: AssetRequestOptions = {
    origin: options.studioOrigin,
    token: options.token,
    fetch: options.fetch,
  };

  return {
    auth: {
      getSession: () => getSession(authOptions),
      signIn: () => signIn(authOptions),
      signOut: () => signOut(authOptions),
    },
    assets: {
      assetUrl: (idOrSlug, urlOptions) =>
        assetUrl(idOrSlug, { origin: options.studioOrigin, ...urlOptions }),
      assetFileUrl: (idOrSlug, urlOptions) =>
        assetFileUrl(idOrSlug, { origin: options.studioOrigin, ...urlOptions }),
      assetManifestUrl: (idOrSlug, urlOptions) =>
        assetManifestUrl(idOrSlug, { origin: options.studioOrigin, ...urlOptions }),
      animationUrl: (idOrSlug, preset, urlOptions) =>
        animationUrl(idOrSlug, preset, { origin: options.studioOrigin, ...urlOptions }),
      getAsset: (idOrSlug, requestOptions) =>
        getAsset(idOrSlug, { ...assetDefaults, ...requestOptions }),
      getAssetManifest: (idOrSlug, requestOptions) =>
        getAssetManifest(idOrSlug, { ...assetDefaults, ...requestOptions }),
      listAssets: (listOptions) => listAssets({ ...assetDefaults, ...listOptions }),
      loadAnimation: (idOrSlug, preset, loadOptions) =>
        loadAnimation(idOrSlug, preset, { ...assetDefaults, ...loadOptions }),
      loadAnimationObjectUrl: (idOrSlug, preset, loadOptions) =>
        loadAnimationObjectUrl(idOrSlug, preset, { ...assetDefaults, ...loadOptions }),
      loadAsset: (idOrSlug, loadOptions) =>
        loadAsset(idOrSlug, { ...assetDefaults, ...loadOptions }),
      loadAssetFile: (idOrSlug, loadOptions) =>
        loadAssetFile(idOrSlug, { ...assetDefaults, ...loadOptions }),
      loadAssetFileObjectUrl: (idOrSlug, loadOptions) =>
        loadAssetFileObjectUrl(idOrSlug, { ...assetDefaults, ...loadOptions }),
      loadAssetObjectUrl: (idOrSlug, loadOptions) =>
        loadAssetObjectUrl(idOrSlug, { ...assetDefaults, ...loadOptions }),
    },
    multiplayer: {
      joinRoom: (roomId, joinOptions) =>
        joinRoom(roomId, {
          authBasePath: options.authBasePath,
          fetch: options.fetch,
          ...joinOptions,
        }),
    },
  };
}

/** A ready-made client with default options. */
export const metaloot: Metaloot = createMetaloot();

export {
  DEFAULT_STUDIO_ORIGIN,
  animationUrl,
  assetFileUrl,
  assetManifestUrl,
  assetUrl,
  getAsset,
  getAssetManifest,
  listAssets,
  loadAnimation,
  loadAnimationObjectUrl,
  loadAsset,
  loadAssetFile,
  loadAssetFileObjectUrl,
  loadAssetObjectUrl,
  onMetalootHosting,
} from "./assets.js";
export type {
  AnimationStatus,
  AssetFileUrlOptions,
  AssetPackFile,
  AssetPackManifest,
  AssetAnimation,
  AssetKind,
  AssetRequestOptions,
  AssetStatus,
  AssetUrlOptions,
  AssetVariant,
  AssetVisibility,
  ListAssetsOptions,
  LoadAnimationOptions,
  LoadAssetFileOptions,
  LoadAssetOptions,
  LodStatus,
  MetalootAsset,
  RigStatus,
} from "./assets.js";
export { DEFAULT_AUTH_BASE_PATH, getSession, signIn, signOut } from "./auth.js";
export type { AuthOptions } from "./auth.js";
export {
  MULTIPLAYER_PROTOCOL_VERSION,
  MetalootAuthRequiredError,
  Room,
  joinRoom,
} from "./multiplayer.js";
export type {
  JoinRoomOptions,
  RoomCloseEvent,
  RoomError,
  RoomEventMap,
  RoomMessage,
  RoomPlayer,
  RoomResync,
  RoomState,
  RoomStateUpdate,
} from "./multiplayer.js";
export type { FetchLike, MetalootSessionResponse, MetalootUser } from "./types.js";
