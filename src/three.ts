import {
  AnimationMixer,
  Box3,
  Group,
  LoopOnce,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
  type Skeleton,
  type SkinnedMesh,
} from "three";
import {
  GLTFLoader,
  type GLTF,
} from "three/addons/loaders/GLTFLoader.js";
import { retargetClip } from "three/addons/utils/SkeletonUtils.js";
import {
  getAsset,
  loadAnimation,
  loadAsset,
  loadAssetFile,
  type AssetRequestOptions,
  type LoadAssetOptions,
  type MetalootAsset,
} from "./assets.js";
import {
  TRIPO_BONE_MAP,
  autoMapBones,
  findHipBone,
  resolveBoneMap,
  type BoneDescriptor,
} from "./retarget.js";

export {
  TRIPO_BONE_MAP,
  autoMapBones,
  findHipBone,
  normalizeBoneName,
  resolveBoneMap,
} from "./retarget.js";
export type { BoneDescriptor, BoneMapResult, BoneVector } from "./retarget.js";

export type ThreeShadowOptions = boolean | {
  cast?: boolean;
  receive?: boolean;
};

export type NormalizeMaterialsOptions = {
  /** Normalization preset. "game" is currently the only preset. @default "game" */
  preset?: "game";
  /** Clamp metalness of materials without their own env map to at most this. @default 0.2 */
  maxMetalness?: number;
  /** Raise roughness to at least this floor. @default 0.6 */
  minRoughness?: number;
  /** Recolor materials by name: `{ grass: 0x4c9e45 }` or `{ grass: "#4c9e45" }`. */
  materialOverrides?: Readonly<Record<string, number | string>>;
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
  /**
   * Make hosted materials game-ready before the instance is returned: `true`
   * applies the "game" preset, or pass {@link NormalizeMaterialsOptions} to
   * tune it. @default false
   */
  normalizeMaterials?: boolean | NormalizeMaterialsOptions;
  /**
   * Borrow clips from a hosted animation library (e.g. the Quaternius
   * Universal Animation Library): the library GLB is downloaded, its clips
   * are retargeted onto this asset's skeleton, and the results are merged
   * into {@link ThreeAssetInstance.clips}/`actions` alongside the Metaloot
   * preset animations. The base model must be rigged — request at least one
   * Metaloot preset (or load a rigged GLB) so a skeleton exists. The mapping
   * report lands on {@link ThreeAssetInstance.retarget}.
   */
  animationLibrary?: AnimationLibraryOptions;
  /** Start this animation after loading. */
  autoPlay?: string;
  /** Default fade duration used by play(). @default 0.2 */
  crossFadeSeconds?: number;
};

export type AnimationLibraryOptions = Omit<RetargetClipsOptions, "clips"> & {
  /** Library pack id/slug to download, or an already-loaded library to reuse. */
  source: string | AnimationLibrary;
  /** Pack-relative GLB path when `source` is an id/slug (see {@link loadAnimationLibrary}). */
  path?: string;
  /** Library clip names to retarget; omit for every clip in the library. */
  clips?: readonly string[];
  /** Rename merged clips, e.g. `{ Idle_Loop: "idle" }`. */
  rename?: Readonly<Record<string, string>>;
  /** Let library clips replace Metaloot preset clips with the same name. @default false */
  overwrite?: boolean;
};

export type ThreeAssetInstance = {
  asset: MetalootAsset;
  gltf: GLTF;
  root: Object3D;
  bounds: Box3;
  clips: Readonly<Record<string, AnimationClip>>;
  actions: Readonly<Record<string, AnimationAction>>;
  mixer: AnimationMixer | null;
  /** Bone-mapping report when `animationLibrary` was used. */
  retarget?: RetargetReport;
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
  if (options.normalizeMaterials) {
    normalizeMaterials(root, options.normalizeMaterials === true ? {} : options.normalizeMaterials);
  }

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

  let retargetReport: RetargetReport | undefined;
  if (options.animationLibrary) {
    const { source, path, rename, overwrite, clips: clipNames, ...retargetOptions } =
      options.animationLibrary;
    const ownsLibrary = typeof source === "string";
    const library = typeof source === "string"
      ? await loadAnimationLibrary(source, { ...assetOptions, path, loader })
      : source;
    try {
      const { clips: retargeted, ...report } = retargetClips(root, library, {
        ...retargetOptions,
        clips: clipNames,
      });
      retargetReport = report;
      for (const [clipName, clip] of Object.entries(retargeted)) {
        const name = rename?.[clipName] ?? clipName;
        if (clips[name] && !overwrite) continue;
        clip.name = name;
        clips[name] = clip;
      }
    } finally {
      if (ownsLibrary) library.dispose();
    }
  }

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
    retarget: retargetReport,
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

/**
 * Makes the materials under an object game-ready. Hosted GLBs often ship
 * viewer-tuned PBR values — `metallicFactor: 1` with no env map renders
 * near-black in a typical scene, and some catalog packs carry off-palette
 * base colors. The "game" preset clamps metalness (skipping materials that
 * bring their own `envMap`), raises the roughness floor, and applies
 * caller-supplied per-material-name color overrides. Works with any loaded
 * GLTF scene, not just Metaloot assets. Returns the number of materials
 * that were changed.
 */
export function normalizeMaterials(
  object: Object3D,
  options: NormalizeMaterialsOptions = {},
): number {
  const maxMetalness = options.maxMetalness ?? 0.2;
  const minRoughness = options.minRoughness ?? 0.6;
  const overrides = options.materialOverrides ?? {};
  const seen = new Set<Material>();
  let normalized = 0;
  object.traverse((node) => {
    const mesh = node as Object3D & { material?: Material | Material[] };
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      if (seen.has(material)) continue;
      seen.add(material);
      if (normalizeMaterial(material, maxMetalness, minRoughness, overrides[material.name])) {
        normalized += 1;
      }
    }
  });
  return normalized;
}

function normalizeMaterial(
  material: Material,
  maxMetalness: number,
  minRoughness: number,
  override: number | string | undefined,
): boolean {
  let touched = false;
  const standard = material as MeshStandardMaterial;
  if (standard.isMeshStandardMaterial) {
    if (!standard.envMap && standard.metalness > maxMetalness) {
      standard.metalness = maxMetalness;
      touched = true;
    }
    if (standard.roughness < minRoughness) {
      standard.roughness = minRoughness;
      touched = true;
    }
  }
  const colored = material as Material & { color?: { set(value: number | string): unknown } };
  if (override !== undefined && colored.color) {
    colored.color.set(override);
    touched = true;
  }
  return touched;
}

/** Slug of the hosted Quaternius Universal Animation Library pack. */
export const UNIVERSAL_ANIMATION_LIBRARY_SLUG = "quaternius-universal-animation-library";

// Default GLB per known animation-library pack. The UAL Standard file holds a
// UE-Mannequin-style skeleton (root/pelvis/spine_01..03/neck_01/Head, arms
// clavicle/upperarm/lowerarm/hand + fingers, legs thigh/calf/foot/ball) with
// 43 clips; the _RM sibling is the root-motion variant, selectable via `path`.
const LIBRARY_DEFAULT_PATHS: Readonly<Record<string, string>> = {
  [UNIVERSAL_ANIMATION_LIBRARY_SLUG]:
    "Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb",
};

export type LoadAnimationLibraryOptions = AssetRequestOptions & {
  /**
   * Pack-relative path of the library GLB. Defaults to the UAL Standard file
   * for the {@link UNIVERSAL_ANIMATION_LIBRARY_SLUG} pack; required for other
   * packs (see `getAssetManifest` for available paths). Ignored when the
   * catalog entry is a single GLB rather than a pack.
   */
  path?: string;
  /** Reuse a configured loader (DRACO/KTX2 plugins, custom manager, etc.). */
  loader?: GLTFLoader;
};

export type AnimationLibrary = {
  /** Library clips by name, on the library's own skeleton. */
  clips: Map<string, AnimationClip>;
  clipNames: string[];
  /** The library GLB's scene, holding the skeleton in bind pose. */
  scene: Object3D;
  skeleton: Skeleton;
  dispose(): void;
};

/**
 * Downloads and parses a hosted animation-library GLB (by default the
 * Universal Animation Library Standard file when given its pack slug) and
 * returns its clips plus the skeleton they animate, ready for
 * {@link retargetClips}. Dispose it once the retargeted clips are made —
 * they are self-contained copies.
 */
export async function loadAnimationLibrary(
  idOrSlug: string,
  options: LoadAnimationLibraryOptions = {},
): Promise<AnimationLibrary> {
  const loader = options.loader ?? new GLTFLoader();
  const requestOptions: AssetRequestOptions = {
    origin: options.origin,
    token: options.token,
    fetch: options.fetch,
    signal: options.signal,
  };
  const path = options.path ?? LIBRARY_DEFAULT_PATHS[idOrSlug];
  const bytes = path
    ? await loadAssetFile(idOrSlug, { ...requestOptions, path })
    : await loadAsset(idOrSlug, requestOptions);
  const gltf = await loader.parseAsync(bytes, "");
  const skinned = findPrimarySkinnedMesh(gltf.scene);
  if (!skinned) {
    throw new Error(`Metaloot animation library "${idOrSlug}" contains no skinned mesh.`);
  }
  const clips = new Map(gltf.animations.map((clip) => [clip.name, clip]));
  return {
    clips,
    clipNames: [...clips.keys()],
    scene: gltf.scene,
    skeleton: skinned.skeleton,
    dispose() {
      gltf.scene.removeFromParent();
      gltf.scene.traverse((node) => disposeThreeNode(node));
    },
  };
}

export type RetargetClipsOptions = {
  /** Library clip names to retarget; omit for every clip in the library. */
  clips?: readonly string[];
  /**
   * Manual bone map, target bone → library bone. Names are matched after
   * normalization, so `"tripo::Root"` finds the GLTFLoader-sanitized
   * `tripoRoot`. Without `preset` it is used as-is; with a preset it
   * overrides the preset's entries (map a bone to `""` to unmap it).
   */
  boneMap?: Readonly<Record<string, string>>;
  /**
   * `"auto"` (default) maps bones heuristically from names plus the actual
   * bone hierarchy and bind pose — recommended, and required for real Tripo
   * rigs whose chain names are unreliable. `"tripo"` applies the static
   * {@link TRIPO_BONE_MAP} for the documented Tripo v2.5 naming scheme.
   */
  preset?: "auto" | "tripo";
  /** Library hip bone carrying root translation. Auto-detected by default. */
  hip?: string;
  /** Hip-translation scale. Defaults to target/library skeleton height ratio. */
  scale?: number;
  /** Start hip translation from zero instead of the clip's absolute position. */
  useFirstFramePosition?: boolean;
  /** Sampling rate override for the baked clips. */
  fps?: number;
  /** Retarget only this `[startSeconds, endSeconds]` window of each clip. */
  trim?: readonly [number, number];
};

export type RetargetReport = {
  /** The bone map that was applied, target bone → library bone. */
  boneMap: Record<string, string>;
  hip: { library: string | null; target: string | null; scale: number };
  /** Target bones left in bind pose (no library counterpart). */
  unmappedTargetBones: string[];
  /** Library bones whose motion was dropped (typically fingers/leaf ends). */
  unmappedLibraryBones: string[];
};

export type RetargetClipsResult = RetargetReport & {
  /** Retargeted clips by library clip name, ready for the target's mixer. */
  clips: Record<string, AnimationClip>;
};

/**
 * Retargets library clips onto a rigged target model and returns
 * self-contained `AnimationClip`s for the target's `AnimationMixer`, plus a
 * report of exactly which bones were (and were not) mapped. Scale differences
 * are handled automatically: hip translation is scaled by the skeletons'
 * height ratio and anchored so the target keeps its own bind-pose hip
 * position (so ground-level root bones do not float to pelvis height).
 * Track names are rewritten to plain node names, so the clips bind on any
 * mixer rooted at the model (matching Metaloot preset clips).
 */
export function retargetClips(
  target: Object3D,
  library: AnimationLibrary,
  options: RetargetClipsOptions = {},
): RetargetClipsResult {
  const targetMesh = findPrimarySkinnedMesh(target);
  if (!targetMesh) {
    throw new Error(
      "retargetClips needs a rigged target (no skinned mesh found). " +
        "For Metaloot assets, request at least one animation preset so the rigged variant is loaded.",
    );
  }
  const libraryMesh = findPrimarySkinnedMesh(library.scene);
  const source = libraryMesh ?? library.skeleton;
  const targetDescriptors = boneDescriptors(targetMesh, target);
  const sourceDescriptors = boneDescriptors(libraryMesh ?? library.skeleton.bones[0], library.scene);
  const targetNames = targetDescriptors.map((bone) => bone.name);
  const sourceNames = sourceDescriptors.map((bone) => bone.name);

  const auto = autoMapBones(targetDescriptors, sourceDescriptors);
  let boneMap: Record<string, string>;
  if (options.preset === "tripo") {
    boneMap = resolveBoneMap(TRIPO_BONE_MAP, targetNames, sourceNames);
  } else if (options.boneMap && !options.preset) {
    boneMap = {};
  } else {
    boneMap = { ...auto.boneMap };
  }
  if (options.boneMap) {
    const overrides = resolveBoneMap(
      Object.fromEntries(Object.entries(options.boneMap).filter(([, value]) => value)),
      targetNames,
      sourceNames,
    );
    Object.assign(boneMap, overrides);
    for (const [targetName, sourceName] of Object.entries(options.boneMap)) {
      if (!sourceName) {
        const resolved = resolveBoneMap({ [targetName]: targetName }, targetNames, targetNames);
        for (const name of Object.keys(resolved)) delete boneMap[name];
      }
    }
  }

  const libraryHip = options.hip ?? auto.sourceHip ?? findHipBone(sourceNames);
  const targetHip =
    Object.keys(boneMap).find((name) => libraryHip !== null && boneMap[name] === libraryHip) ?? null;

  // Hip translation: scale library motion to the target's proportions and
  // anchor it at the target's own bind-pose hip position. This keeps rigs
  // whose hip bone sits at ground level (real Tripo rigs) from being lifted
  // to the library's pelvis height.
  const scale = options.scale ?? heightRatio(targetDescriptors, sourceDescriptors);
  const retargetOptions: NonNullable<Parameters<typeof retargetClip>[3]> = {
    names: boneMap,
    scale,
    ...(libraryHip ? { hip: libraryHip } : {}),
    ...(options.useFirstFramePosition !== undefined
      ? { useFirstFramePosition: options.useFirstFramePosition }
      : {}),
    ...(options.fps !== undefined ? { fps: options.fps } : {}),
    ...(options.trim !== undefined ? { trim: [...options.trim] as [number, number] } : {}),
  };
  if (libraryHip && targetHip && scale > 0) {
    const targetHipPosition = findBonePosition(targetDescriptors, targetHip);
    const libraryHipPosition = findBonePosition(sourceDescriptors, libraryHip);
    if (targetHipPosition && libraryHipPosition) {
      retargetOptions.hipPosition = new Vector3(
        targetHipPosition.x / scale - libraryHipPosition.x,
        targetHipPosition.y / scale - libraryHipPosition.y,
        targetHipPosition.z / scale - libraryHipPosition.z,
      );
    }
  }

  const requested = options.clips ?? library.clipNames;
  const clips: Record<string, AnimationClip> = {};
  try {
    for (const name of requested) {
      const clip = library.clips.get(name);
      if (!clip) {
        throw new Error(
          `Animation library has no clip "${name}". Available: ${library.clipNames.join(", ")}`,
        );
      }
      const retargeted = retargetClip(targetMesh, source, clip, retargetOptions);
      for (const track of retargeted.tracks) {
        // `.bones[X].prop` tracks only bind when the mixer root is the skinned
        // mesh itself; plain node-name tracks bind anywhere in the hierarchy.
        const match = /^\.bones\[([^\]]+)\]\.(\w+)$/.exec(track.name);
        if (match && /^[\w-]+$/.test(match[1])) track.name = `${match[1]}.${match[2]}`;
      }
      retargeted.name = name;
      clips[name] = retargeted;
    }
  } finally {
    // retargetClip samples by posing both skeletons; restore their bind poses.
    targetMesh.skeleton.pose();
    libraryMesh?.skeleton.pose();
    target.updateMatrixWorld(true);
  }

  const used = new Set(Object.values(boneMap));
  return {
    clips,
    boneMap,
    hip: { library: libraryHip, target: targetHip, scale },
    unmappedTargetBones: targetNames.filter((name) => !(name in boneMap)),
    unmappedLibraryBones: sourceNames.filter((name) => !used.has(name)),
  };
}

function findPrimarySkinnedMesh(object: Object3D): SkinnedMesh | null {
  let best: SkinnedMesh | null = null;
  object.traverse((node) => {
    const mesh = node as SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.skeleton) return;
    if (!best || mesh.skeleton.bones.length > best.skeleton.bones.length) best = mesh;
  });
  return best;
}

// Bind-pose descriptors (name, parent, world position) for the auto-mapper
// and hip measurements. World space matches what SkeletonUtils.retarget uses
// for source bones and hip positions.
function boneDescriptors(meshOrBone: SkinnedMesh | Object3D, root: Object3D): BoneDescriptor[] {
  const mesh = meshOrBone as SkinnedMesh;
  if (mesh.isSkinnedMesh) mesh.skeleton.pose();
  root.updateWorldMatrix(true, true);
  const bones = mesh.isSkinnedMesh ? mesh.skeleton.bones : collectBones(meshOrBone);
  const boneSet = new Set<Object3D>(bones);
  const world = new Vector3();
  return bones.map((bone) => {
    bone.getWorldPosition(world);
    return {
      name: bone.name,
      parent: bone.parent && boneSet.has(bone.parent) ? bone.parent.name : null,
      position: { x: world.x, y: world.y, z: world.z },
    };
  });
}

function collectBones(object: Object3D): Object3D[] {
  const bones: Object3D[] = [];
  object.traverse((node) => {
    if ((node as Object3D & { isBone?: boolean }).isBone) bones.push(node);
  });
  return bones;
}

function heightRatio(target: readonly BoneDescriptor[], source: readonly BoneDescriptor[]): number {
  const span = (bones: readonly BoneDescriptor[]) => {
    const ys = bones.map((bone) => bone.position?.y ?? 0);
    return Math.max(...ys) - Math.min(...ys);
  };
  const targetSpan = span(target);
  const sourceSpan = span(source);
  return targetSpan > 0 && sourceSpan > 0 ? targetSpan / sourceSpan : 1;
}

function findBonePosition(
  bones: readonly BoneDescriptor[],
  name: string,
): BoneDescriptor["position"] | null {
  return bones.find((bone) => bone.name === name)?.position ?? null;
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
