import "@babylonjs/loaders/glTF/index.js";
import {
  LoadAssetContainerAsync,
} from "@babylonjs/core/Loading/sceneLoader.js";
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import {
  getAsset,
  loadAnimation,
  loadAsset,
  type LoadAssetOptions,
  type MetalootAsset,
} from "./assets.js";

export type NormalizeBabylonMaterialsOptions = {
  /** Normalization preset. "game" is currently the only preset. @default "game" */
  preset?: "game";
  /** Clamp metallic of materials without reflections available to at most this. @default 0.2 */
  maxMetalness?: number;
  /** Raise roughness to at least this floor. @default 0.6 */
  minRoughness?: number;
  /** Recolor materials by name: `{ grass: 0x4c9e45 }` or `{ grass: "#4c9e45" }`. */
  materialOverrides?: Readonly<Record<string, number | string>>;
};

export type LoadBabylonAssetOptions = LoadAssetOptions & {
  scene: Scene;
  animations?: readonly string[] | "available";
  baseAnimation?: string;
  targetHeight?: number;
  center?: boolean;
  ground?: boolean;
  receiveShadows?: boolean;
  shadowGenerator?: ShadowGenerator;
  autoPlay?: string;
  /**
   * Make hosted materials game-ready before the instance is returned: `true`
   * applies the "game" preset, or pass {@link NormalizeBabylonMaterialsOptions}
   * to tune it. @default false
   */
  normalizeMaterials?: boolean | NormalizeBabylonMaterialsOptions;
};

export type BabylonAssetInstance = {
  asset: MetalootAsset;
  container: AssetContainer;
  root: AbstractMesh;
  animationGroups: Readonly<Record<string, AnimationGroup>>;
  bounds: { min: Vector3; max: Vector3; size: Vector3 };
  play(name: string, options?: { loop?: boolean; speedRatio?: number }): AnimationGroup;
  stop(): void;
  dispose(): void;
};

/** Loads, places, sizes, animates, and disposes a Metaloot GLB in Babylon.js. */
export async function loadBabylonAsset(
  idOrSlug: string,
  options: LoadBabylonAssetOptions,
): Promise<BabylonAssetInstance> {
  const requestOptions: LoadAssetOptions = {
    origin: options.origin,
    token: options.token,
    fetch: options.fetch,
    signal: options.signal,
    preferProxy: options.preferProxy,
    variant: options.variant,
  };
  const asset = await getAsset(idOrSlug, requestOptions);
  const ready = Object.entries(asset.animations ?? {})
    .filter(([, state]) => state.status === "success")
    .map(([preset]) => preset);
  const requested = options.animations === "available" ? ready : [...(options.animations ?? [])];
  const presets = [...new Set(requested.map((preset) => preset.toLowerCase()))]
    .filter((preset) => ready.includes(preset));
  const basePreset = (options.baseAnimation ?? presets[0])?.toLowerCase();
  const baseBytes = basePreset
    ? await loadAnimation(idOrSlug, basePreset, requestOptions)
    : await loadAsset(idOrSlug, requestOptions);
  const container = await LoadAssetContainerAsync(
    new Uint8Array(baseBytes),
    options.scene,
    { pluginExtension: ".glb" },
  );
  const root = container.createRootMesh();
  container.addAllToScene();
  if (options.normalizeMaterials) {
    normalizeBabylonMaterials(
      container.materials,
      options.normalizeMaterials === true ? {} : options.normalizeMaterials,
    );
  }

  const groups: Record<string, AnimationGroup> = {};
  for (const group of container.animationGroups) {
    const name = basePreset ?? (group.name || "default");
    group.name = name;
    groups[name] = group;
  }
  await Promise.all(presets.filter((preset) => preset !== basePreset).map(async (preset) => {
    const bytes = await loadAnimation(idOrSlug, preset, requestOptions);
    const animationContainer = await LoadAssetContainerAsync(
      new Uint8Array(bytes),
      options.scene,
      { pluginExtension: ".glb" },
    );
    const merged = animationContainer.mergeAnimationsTo(
      options.scene,
      [],
      (target) => options.scene.getNodeByName(target.name),
    );
    if (merged[0]) {
      merged[0].name = preset;
      groups[preset] = merged[0];
    }
    animationContainer.dispose();
  }));

  normalizeBabylonRoot(root, options);
  for (const mesh of root.getChildMeshes()) {
    if (options.receiveShadows !== undefined) mesh.receiveShadows = options.receiveShadows;
    options.shadowGenerator?.addShadowCaster(mesh, true);
  }
  const vectors = root.getHierarchyBoundingVectors(true);
  const bounds = {
    min: vectors.min.clone(),
    max: vectors.max.clone(),
    size: vectors.max.subtract(vectors.min),
  };
  let current: AnimationGroup | null = null;
  const instance: BabylonAssetInstance = {
    asset,
    container,
    root,
    animationGroups: groups,
    bounds,
    play(name, playOptions = {}) {
      const group = groups[name];
      if (!group) throw new Error(`Metaloot animation "${name}" was not loaded.`);
      if (current && current !== group) current.stop();
      group.start(playOptions.loop ?? true, playOptions.speedRatio ?? 1);
      current = group;
      return group;
    },
    stop() {
      current?.stop();
      current = null;
    },
    dispose() {
      for (const group of Object.values(groups)) group.stop();
      container.dispose();
    },
  };
  if (options.autoPlay) instance.play(options.autoPlay);
  return instance;
}

/**
 * Makes hosted PBR materials game-ready — the Babylon mirror of the three.js
 * adapter's `normalizeMaterials`. Clamps `metallic` (skipping materials whose
 * scene provides reflections), raises the `roughness` floor, and applies
 * per-material-name albedo color overrides. Pass `container.materials`,
 * `scene.materials`, or any material list. Returns the number of materials
 * that were changed.
 */
export function normalizeBabylonMaterials(
  materials: readonly Material[],
  options: NormalizeBabylonMaterialsOptions = {},
): number {
  const maxMetalness = options.maxMetalness ?? 0.2;
  const minRoughness = options.minRoughness ?? 0.6;
  const overrides = options.materialOverrides ?? {};
  let normalized = 0;
  for (const material of materials) {
    let touched = false;
    const pbr = material as Material & {
      metallic?: number | null;
      roughness?: number | null;
      albedoColor?: Color3;
      reflectionTexture?: unknown;
    };
    const hasReflections = Boolean(
      pbr.reflectionTexture ?? material.getScene?.()?.environmentTexture,
    );
    if (!hasReflections && typeof pbr.metallic === "number" && pbr.metallic > maxMetalness) {
      pbr.metallic = maxMetalness;
      touched = true;
    }
    if (typeof pbr.roughness === "number" && pbr.roughness < minRoughness) {
      pbr.roughness = minRoughness;
      touched = true;
    }
    const override = overrides[material.name];
    if (override !== undefined && pbr.albedoColor) {
      pbr.albedoColor = toColor3(override);
      touched = true;
    }
    if (touched) normalized += 1;
  }
  return normalized;
}

function toColor3(value: number | string): Color3 {
  const hex = typeof value === "number"
    ? `#${value.toString(16).padStart(6, "0")}`
    : value.startsWith("#") ? value : `#${value}`;
  return Color3.FromHexString(hex);
}

function normalizeBabylonRoot(root: AbstractMesh, options: LoadBabylonAssetOptions) {
  root.computeWorldMatrix(true);
  let vectors = root.getHierarchyBoundingVectors(true);
  const height = vectors.max.y - vectors.min.y;
  if (options.targetHeight && options.targetHeight > 0 && height > 0) {
    root.scaling.scaleInPlace(options.targetHeight / height);
    root.computeWorldMatrix(true);
    vectors = root.getHierarchyBoundingVectors(true);
  }
  if (options.center !== false) {
    root.position.x -= (vectors.min.x + vectors.max.x) / 2;
    root.position.z -= (vectors.min.z + vectors.max.z) / 2;
  }
  if (options.ground !== false) root.position.y -= vectors.min.y;
  root.computeWorldMatrix(true);
}
