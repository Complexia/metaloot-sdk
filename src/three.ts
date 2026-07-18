import {
  AnimationMixer,
  Box3,
  Group,
  LoopOnce,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type Object3D,
} from "three";
import {
  GLTFLoader,
  type GLTF,
} from "three/addons/loaders/GLTFLoader.js";
import {
  getAsset,
  loadAnimation,
  loadAsset,
  type LoadAssetOptions,
  type MetalootAsset,
} from "./assets.js";

export type ThreeShadowOptions = boolean | {
  cast?: boolean;
  receive?: boolean;
};

export type LoadThreeAssetOptions = LoadAssetOptions & {
  /** Scene or group that receives the loaded root automatically. */
  scene?: Object3D;
  /** Reuse a configured loader (DRACO/KTX2 plugins, custom manager, etc.). */
  loader?: GLTFLoader;
  /** Presets to load, or "available" for every ready Metaloot animation. */
  animations?: readonly string[] | "available";
  /** Rigged preset whose scene becomes the character root. Defaults to the first requested preset. */
  baseAnimation?: string;
  /** Uniformly scale the model to this world-space height. */
  targetHeight?: number;
  /** Move the horizontal center of the model to x=0,z=0. @default true */
  center?: boolean;
  /** Move the model's lowest point to y=0. @default true */
  ground?: boolean;
  /** Configure castShadow/receiveShadow on every mesh. */
  shadows?: ThreeShadowOptions;
  /** Start this animation after loading. */
  autoPlay?: string;
  /** Default fade duration used by play(). @default 0.2 */
  crossFadeSeconds?: number;
};

export type ThreeAssetInstance = {
  asset: MetalootAsset;
  gltf: GLTF;
  root: Object3D;
  bounds: Box3;
  clips: Readonly<Record<string, AnimationClip>>;
  actions: Readonly<Record<string, AnimationAction>>;
  mixer: AnimationMixer | null;
  play(name: string, options?: { fadeSeconds?: number; loop?: boolean }): AnimationAction;
  stop(fadeSeconds?: number): void;
  update(deltaSeconds: number): void;
  dispose(): void;
};

/**
 * Loads a Metaloot GLB into Three.js and handles the integration work agents
 * otherwise repeat: GLTFLoader setup, rigged variants, clips/actions, mixer,
 * scaling, centering, grounding, shadows, crossfades, bounds, and disposal.
 */
export async function loadThreeAsset(
  idOrSlug: string,
  options: LoadThreeAssetOptions = {},
): Promise<ThreeAssetInstance> {
  const loader = options.loader ?? new GLTFLoader();
  const assetOptions: LoadAssetOptions = {
    origin: options.origin,
    token: options.token,
    fetch: options.fetch,
    signal: options.signal,
    preferProxy: options.preferProxy,
    variant: options.variant,
  };
  const asset = await getAsset(idOrSlug, assetOptions);
  const availablePresets = Object.entries(asset.animations ?? {})
    .filter(([, state]) => state.status === "success")
    .map(([preset]) => preset);
  const requestedPresets = options.animations === "available"
    ? availablePresets
    : [...(options.animations ?? [])];
  const presets = [...new Set(requestedPresets.map((preset) => preset.toLowerCase()))]
    .filter((preset) => availablePresets.includes(preset));
  const basePreset = (options.baseAnimation ?? presets[0])?.toLowerCase();
  const baseGltf = basePreset
    ? await loadAnimationGltf(loader, idOrSlug, basePreset, assetOptions)
    : await loadModelGltf(loader, idOrSlug, assetOptions);
  // Keep placement transforms on a stable wrapper. Some animation GLBs keyframe
  // the imported scene root, which would otherwise overwrite agent-requested
  // scale/centering/grounding as soon as the mixer advances.
  const root = new Group();
  root.name = `${asset.slug}-metaloot-root`;
  root.add(baseGltf.scene);

  const clips: Record<string, AnimationClip> = {};
  for (const clip of baseGltf.animations) {
    const name = basePreset ?? (clip.name || "default");
    clips[name] = namedClip(clip, name);
  }
  await Promise.all(presets.filter((preset) => preset !== basePreset).map(async (preset) => {
    const gltf = await loadAnimationGltf(loader, idOrSlug, preset, assetOptions);
    const clip = gltf.animations[0];
    if (clip) clips[preset] = namedClip(clip, preset);
  }));

  const shadowOptions = typeof options.shadows === "boolean"
    ? { cast: options.shadows, receive: options.shadows }
    : options.shadows;
  if (shadowOptions) {
    root.traverse((node) => {
      const mesh = node as Object3D & { isMesh?: boolean; castShadow: boolean; receiveShadow: boolean };
      if (!mesh.isMesh) return;
      if (shadowOptions.cast !== undefined) mesh.castShadow = shadowOptions.cast;
      if (shadowOptions.receive !== undefined) mesh.receiveShadow = shadowOptions.receive;
    });
  }

  const mixer = Object.keys(clips).length ? new AnimationMixer(root) : null;
  const actions: Record<string, AnimationAction> = {};
  if (mixer) {
    for (const [name, clip] of Object.entries(clips)) actions[name] = mixer.clipAction(clip);
  }
  const referenceAction = actions[options.autoPlay ?? basePreset ?? Object.keys(actions)[0]];
  if (referenceAction && mixer) {
    // Skinned meshes can report bind-pose bounds until their first mixer tick.
    // Sample the first requested pose before calculating placement and scale.
    referenceAction.reset().play();
    mixer.update(0);
  }

  normalizeRoot(root, options);
  const bounds = new Box3().setFromObject(root, true);
  options.scene?.add(root);

  if (referenceAction && !options.autoPlay) referenceAction.stop();
  let current: AnimationAction | null = options.autoPlay ? referenceAction ?? null : null;
  const defaultFade = options.crossFadeSeconds ?? 0.2;

  const instance: ThreeAssetInstance = {
    asset,
    gltf: baseGltf,
    root,
    bounds,
    clips,
    actions,
    mixer,
    play(name, playOptions = {}) {
      const action = actions[name];
      if (!action) throw new Error(`Metaloot animation "${name}" was not loaded.`);
      const fade = playOptions.fadeSeconds ?? defaultFade;
      action.enabled = true;
      action.setLoop(playOptions.loop === false ? LoopOnce : action.loop, playOptions.loop === false ? 1 : Infinity);
      action.clampWhenFinished = playOptions.loop === false;
      action.reset().fadeIn(fade).play();
      if (current && current !== action) current.fadeOut(fade);
      current = action;
      return action;
    },
    stop(fadeSeconds = defaultFade) {
      current?.fadeOut(fadeSeconds);
      current = null;
    },
    update(deltaSeconds) {
      mixer?.update(deltaSeconds);
    },
    dispose() {
      mixer?.stopAllAction();
      mixer?.uncacheRoot(root);
      root.removeFromParent();
      root.traverse((node) => disposeThreeNode(node));
    },
  };

  return instance;
}

function namedClip(clip: AnimationClip, name: string): AnimationClip {
  const copy = clip.clone();
  copy.name = name;
  return copy;
}

async function loadModelGltf(loader: GLTFLoader, id: string, options: LoadAssetOptions) {
  return loader.parseAsync(await loadAsset(id, options), "");
}

async function loadAnimationGltf(
  loader: GLTFLoader,
  id: string,
  preset: string,
  options: LoadAssetOptions,
) {
  return loader.parseAsync(await loadAnimation(id, preset, options), "");
}

function normalizeRoot(root: Object3D, options: LoadThreeAssetOptions) {
  root.updateWorldMatrix(true, true);
  let box = new Box3().setFromObject(root, true);
  const size = box.getSize(new Vector3());
  if (options.targetHeight && options.targetHeight > 0 && size.y > 0) {
    const originalScale = root.scale.clone();
    let low = 0;
    let high = Math.max(1, options.targetHeight / size.y);
    let highHeight = measureHeight(root, originalScale, high);
    while (highHeight < options.targetHeight && high < 1024) {
      high *= 2;
      highHeight = measureHeight(root, originalScale, high);
    }
    for (let iteration = 0; iteration < 16; iteration += 1) {
      const multiplier = (low + high) / 2;
      const height = measureHeight(root, originalScale, multiplier);
      if (height < options.targetHeight) low = multiplier;
      else high = multiplier;
    }
    root.scale.copy(originalScale).multiplyScalar((low + high) / 2);
    root.updateWorldMatrix(true, true);
    box = new Box3().setFromObject(root, true);
  }
  const center = box.getCenter(new Vector3());
  if (options.center !== false) {
    root.position.x -= center.x;
    root.position.z -= center.z;
  }
  if (options.ground !== false) root.position.y -= box.min.y;
  root.updateWorldMatrix(true, true);
}

function measureHeight(root: Object3D, originalScale: Vector3, multiplier: number) {
  root.scale.copy(originalScale).multiplyScalar(multiplier);
  root.updateWorldMatrix(true, true);
  const box = new Box3().setFromObject(root, true);
  return box.max.y - box.min.y;
}

function disposeThreeNode(node: Object3D) {
  const mesh = node as Object3D & {
    geometry?: { dispose(): void };
    material?: { dispose(): void } | Array<{ dispose(): void }>;
  };
  mesh.geometry?.dispose();
  if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
  else mesh.material?.dispose();
}
