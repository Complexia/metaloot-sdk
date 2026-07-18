import "@babylonjs/loaders/glTF/index.js";
import {
  LoadAssetContainerAsync,
} from "@babylonjs/core/Loading/sceneLoader.js";
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import {
  getAsset,
  loadAnimation,
  loadAsset,
  type LoadAssetOptions,
  type MetalootAsset,
} from "./assets.js";

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
