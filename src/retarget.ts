// Engine-agnostic humanoid bone-map planning for animation retargeting.
//
// Curated animation packs (e.g. the Quaternius Universal Animation Library)
// ship clips on their own skeleton; games want them on Metaloot Studio's
// auto-rigged characters (Tripo v2.5) or arbitrary humanoid GLBs. This module
// figures out which target bone corresponds to which library bone. It is pure
// string/geometry logic with zero dependencies — the three.js adapter turns
// the resulting map into retargeted `AnimationClip`s.
//
// Two modes:
// - Name-only: pass plain bone-name lists. Matches Mixamo/UAL/VRM-style names
//   and the documented Tripo naming scheme (`tripo::0_Left_Limb_*` arms,
//   `tripo::1_Left_Limb_*` legs).
// - Hierarchy-aware: pass `BoneDescriptor`s with parent links and bind-pose
//   world positions. Needed for real Tripo rigs, whose chain names are not
//   reliable (observed on a production v2.5 rig: leg chains named
//   `0_Left_Limb_*`, one arm named `Spine_3 → bone_8 → bone_9`). Ambiguous
//   chains are classified by where they attach and which way they run.

export type BoneVector = { x: number; y: number; z: number };

export type BoneDescriptor = {
  name: string;
  /** Parent bone name; null for skeleton roots. Enables hierarchy mode. */
  parent?: string | null;
  /** Bind-pose world position. Enables hierarchy mode. */
  position?: BoneVector;
};

export type BoneMapResult = {
  /** Target bone name → source (library) bone name. */
  boneMap: Record<string, string>;
  /** Source bone that carries root translation (the hips), when found. */
  sourceHip: string | null;
  /** Target bone mapped to the source hips, when found. */
  targetHip: string | null;
  /** Target bones that received no source bone (they keep their bind pose). */
  unmappedTargetBones: string[];
  /** Source bones whose motion is dropped (fingers, leaf ends, extras). */
  unmappedSourceBones: string[];
};

type Side = "left" | "right" | "center";

type Classified = {
  name: string;
  parent: string | null | undefined;
  position: BoneVector | undefined;
  side: Side;
  /** Semantic slot ("hips", "spine", "upperarm", "finger:thumb", …), "limb" for
   * Tripo-style numbered chains, or null when unknown. */
  slot: string | null;
  /** Ordering key within a chain (numeric suffix; chest ranks above spine). */
  rank: number;
  /** Leading chain-group digit of the documented Tripo scheme (0 arms, 1 legs). */
  group: number | null;
  leaf: boolean;
  ignore: boolean;
};

// Prefix/namespace tokens that carry no anatomical meaning.
const NAMESPACE_TOKENS = new Set(["tripo", "mixamorig", "mixamo", "bip", "biped", "def", "j", "cc", "base", "game"]);
const LEFT_TOKENS = new Set(["l", "left"]);
const RIGHT_TOKENS = new Set(["r", "right"]);
const LEAF_TOKENS = new Set(["end", "tip", "leaf", "nub", "top"]);
// Bones that should never receive humanoid body motion. Short body-part words
// are matched as exact tokens ("ear" is a substring of "forearm").
const IGNORE_PARTS = [
  "hair", "tail", "breast", "cheek", "tongue", "teeth", "eyelid", "eyeball",
  "eyebrow", "eyelash", "weapon", "sword", "shield", "prop", "item", "twist",
  "roll", "pole", "heel", "helper",
];
const IGNORE_TOKENS = new Set(["ik", "eye", "ear", "jaw"]);

// Ordered specific-before-generic; matched as substrings of the joined tokens.
const SLOT_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["upperarm", "upperarm"], ["armupper", "upperarm"], ["uparm", "upperarm"],
  ["forearm", "forearm"], ["lowerarm", "forearm"], ["armlower", "forearm"], ["elbow", "forearm"],
  ["shoulder", "shoulder"], ["clavicle", "shoulder"], ["collarbone", "shoulder"], ["collar", "shoulder"],
  ["upperleg", "upperleg"], ["legupper", "upperleg"], ["upleg", "upperleg"], ["thigh", "upperleg"],
  ["lowerleg", "lowerleg"], ["leglower", "lowerleg"], ["calf", "lowerleg"], ["shin", "lowerleg"], ["knee", "lowerleg"],
  ["toebase", "toe"], ["toes", "toe"], ["toe", "toe"], ["ball", "toe"],
  ["foot", "foot"], ["ankle", "foot"],
  ["thumb", "finger:thumb"], ["index", "finger:index"], ["middle", "finger:middle"],
  ["ring", "finger:ring"], ["pinky", "finger:pinky"], ["little", "finger:pinky"],
  ["hand", "hand"], ["wrist", "hand"], ["palm", "hand"],
  ["hips", "hips"], ["hip", "hips"], ["pelvis", "hips"], ["waist", "hips"],
  ["upperchest", "spine"], ["chest", "spine"], ["spine", "spine"], ["torso", "spine"],
  ["neck", "neck"],
  ["head", "head"],
  ["root", "root"], ["reference", "root"], ["trajectory", "root"], ["origin", "root"], ["master", "root"],
  ["armature", "root"],
  ["limb", "limb"],
  ["arm", "upperarm"],
  ["leg", "lowerleg"],
];

const SPINE_SUB_RANK: Readonly<Record<string, number>> = { spine: 0, torso: 0, chest: 100, upperchest: 200 };

const ARM_POSITIONS: ReadonlyArray<string> = ["shoulder", "upperarm", "forearm", "hand"];
const LEG_POSITIONS: ReadonlyArray<string> = ["upperleg", "lowerleg", "foot", "toe"];

/**
 * Built-in target → library map for the DOCUMENTED Tripo v2.5 naming scheme
 * (`tripo::Root`, `tripo::Spine_0..3`, `tripo::Head_0..2`, arms
 * `tripo::0_<Side>_Limb_0..4`, legs `tripo::1_<Side>_Limb_0..3`), with
 * Universal Animation Library (UE-Mannequin-style) bone names as values.
 *
 * CAVEAT — verified against a production v2.5 rig: real Tripo skeletons can
 * deviate from this scheme (leg chains named `0_Left_Limb_*`, arms built from
 * generic `bone_N` fillers, `tripo::Spine_3` acting as a clavicle). This map
 * is only correct for rigs that follow the documented naming; the default
 * `preset: "auto"` mapper uses the bone hierarchy instead and handles the
 * deviations. Lookups are name-normalized, so the sanitized names produced by
 * three's GLTFLoader (`tripoRoot`, `tripo0_Left_Limb_1`, …) match too.
 * `tripo::Spine_0`, `tripo::Head_2`, and `tripo::0_*_Limb_4` are deliberately
 * unmapped (lowest spine stays with the pelvis; hand/head leaf ends have no
 * UAL equivalent that is safe to copy).
 */
export const TRIPO_BONE_MAP: Readonly<Record<string, string>> = {
  "tripo::Root": "pelvis",
  "tripo::Spine_1": "spine_01",
  "tripo::Spine_2": "spine_02",
  "tripo::Spine_3": "spine_03",
  "tripo::Head_0": "neck_01",
  "tripo::Head_1": "Head",
  "tripo::0_Left_Limb_0": "clavicle_l",
  "tripo::0_Left_Limb_1": "upperarm_l",
  "tripo::0_Left_Limb_2": "lowerarm_l",
  "tripo::0_Left_Limb_3": "hand_l",
  "tripo::0_Right_Limb_0": "clavicle_r",
  "tripo::0_Right_Limb_1": "upperarm_r",
  "tripo::0_Right_Limb_2": "lowerarm_r",
  "tripo::0_Right_Limb_3": "hand_r",
  "tripo::1_Left_Limb_0": "thigh_l",
  "tripo::1_Left_Limb_1": "calf_l",
  "tripo::1_Left_Limb_2": "foot_l",
  "tripo::1_Left_Limb_3": "ball_l",
  "tripo::1_Right_Limb_0": "thigh_r",
  "tripo::1_Right_Limb_1": "calf_r",
  "tripo::1_Right_Limb_2": "foot_r",
  "tripo::1_Right_Limb_3": "ball_r",
};

function tokenize(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([A-Za-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Canonical identity of a bone name: lowercased, camelCase/underscore/number
 * boundaries split, namespaces (`tripo::`, `mixamorig:`, and their sanitized
 * forms) removed, separators dropped. `tripo::Root`, `tripoRoot`, and
 * `Tripo_root` all normalize to `"root"`.
 */
export function normalizeBoneName(name: string): string {
  return tokenize(name).filter((token) => !NAMESPACE_TOKENS.has(token)).join("");
}

function classify(descriptor: BoneDescriptor): Classified {
  const tokens = tokenize(descriptor.name).filter((token) => !NAMESPACE_TOKENS.has(token));
  let side: Side = "center";
  const meaningful: string[] = [];
  for (const token of tokens) {
    if (LEFT_TOKENS.has(token)) side = "left";
    else if (RIGHT_TOKENS.has(token)) side = "right";
    else meaningful.push(token);
  }
  const leaf = meaningful.some((token) => LEAF_TOKENS.has(token));
  const words = meaningful.filter((token) => !LEAF_TOKENS.has(token) && !/^[0-9]+$/.test(token));
  const numbers = meaningful.filter((token) => /^[0-9]+$/.test(token)).map(Number);
  const joined = words.join("");
  const ignore = IGNORE_PARTS.some((part) => joined.includes(part)) ||
    meaningful.some((token) => IGNORE_TOKENS.has(token));

  let slot: string | null = null;
  if (!ignore) {
    for (const [alias, canonical] of SLOT_ALIASES) {
      if (joined.includes(alias)) {
        slot = canonical;
        break;
      }
    }
  }

  let rank = numbers.length ? numbers[numbers.length - 1] : 0;
  if (slot === "spine") {
    for (const [alias, sub] of Object.entries(SPINE_SUB_RANK)) {
      if (joined.includes(alias)) rank += sub;
    }
  }
  // Documented Tripo scheme: leading digit selects the chain group.
  const group = slot === "limb" && numbers.length ? numbers[0] : null;

  return {
    name: descriptor.name,
    parent: descriptor.parent,
    position: descriptor.position,
    side,
    slot,
    rank,
    group,
    leaf,
    ignore,
  };
}

type SkeletonSlots = {
  hips: string | null;
  root: string | null;
  spine: string[];
  neckhead: string[];
  /** "arm:left" | "arm:right" | "leg:left" | "leg:right" → bone per position. */
  limbs: Map<string, Array<string | null>>;
  /** "finger:thumb:left" … → ordered chain. */
  fingers: Map<string, string[]>;
};

function toDescriptors(bones: readonly (string | BoneDescriptor)[]): BoneDescriptor[] {
  return bones.map((bone) => (typeof bone === "string" ? { name: bone } : bone));
}

function pickSingle(classified: Classified[], slot: string): string | null {
  const matches = classified.filter((bone) => bone.slot === slot && !bone.leaf);
  if (!matches.length) return null;
  matches.sort((a, b) => a.rank - b.rank);
  return matches[0].name;
}

function orderedChain(classified: Classified[], slot: string, side: Side): string[] {
  return classified
    .filter((bone) => bone.slot === slot && bone.side === side && !bone.leaf)
    .sort((a, b) => a.rank - b.rank)
    .map((bone) => bone.name);
}

function setLimb(
  limbs: Map<string, Array<string | null>>,
  key: string,
  positionIndex: number,
  name: string,
): void {
  if (positionIndex < 0 || positionIndex > 3) return;
  const chain = limbs.get(key) ?? [null, null, null, null];
  if (chain[positionIndex] === null) chain[positionIndex] = name;
  limbs.set(key, chain);
}

type Chain = { bones: Classified[]; side: Side; attach: Classified | null };

/** Splits a set of bones into maximal single-child runs following `parent` links. */
function extractChains(unknowns: Classified[], byName: Map<string, Classified>): Chain[] {
  const unknownNames = new Set(unknowns.map((bone) => bone.name));
  const childrenOf = new Map<string, Classified[]>();
  for (const bone of unknowns) {
    if (bone.parent && unknownNames.has(bone.parent)) {
      const list = childrenOf.get(bone.parent) ?? [];
      list.push(bone);
      childrenOf.set(bone.parent, list);
    }
  }
  const chains: Chain[] = [];
  const heads = unknowns.filter((bone) => {
    if (!bone.parent || !unknownNames.has(bone.parent)) return true;
    return (childrenOf.get(bone.parent) ?? []).length > 1;
  });
  for (const head of heads) {
    const bones: Classified[] = [head];
    let current = head;
    for (;;) {
      const children = childrenOf.get(current.name) ?? [];
      if (children.length !== 1) break;
      current = children[0];
      bones.push(current);
    }
    let side: Side = "center";
    for (const bone of bones) {
      if (bone.side !== "center") {
        side = bone.side;
        break;
      }
    }
    // Nearest classified ancestor (walk through other unknown bones).
    let attach: Classified | null = null;
    let cursor = head.parent ? byName.get(head.parent) : undefined;
    while (cursor) {
      if (!unknownNames.has(cursor.name)) {
        attach = cursor;
        break;
      }
      cursor = cursor.parent ? byName.get(cursor.parent) : undefined;
    }
    chains.push({ bones, side, attach });
  }
  return chains;
}

function assignChainSides(chains: Chain[]): void {
  if (chains.length !== 2) {
    // Fall back to x-sign per chain (glTF characters face +Z, left = +x).
    for (const chain of chains) {
      if (chain.side === "center") chain.side = meanX(chain) >= 0 ? "left" : "right";
    }
    return;
  }
  const [a, b] = chains;
  if (a.side !== "center" && b.side === "center") b.side = a.side === "left" ? "right" : "left";
  else if (b.side !== "center" && a.side === "center") a.side = b.side === "left" ? "right" : "left";
  else if (a.side === "center" && b.side === "center") {
    const leftFirst = meanX(a) >= meanX(b);
    a.side = leftFirst ? "left" : "right";
    b.side = leftFirst ? "right" : "left";
  }
}

function meanX(chain: Chain): number {
  const xs = chain.bones.map((bone) => bone.position?.x ?? 0);
  return xs.reduce((sum, x) => sum + x, 0) / (xs.length || 1);
}

function buildSlots(descriptors: BoneDescriptor[]): SkeletonSlots {
  const classified = descriptors.map(classify);
  const byName = new Map(classified.map((bone) => [bone.name, bone]));
  const hierarchy = descriptors.length > 0 &&
    descriptors.every((bone) => bone.position !== undefined && bone.parent !== undefined);

  let hips = pickSingle(classified, "hips");
  let root = pickSingle(classified, "root");
  if (!hips && root) {
    hips = root;
    root = null;
  }

  let spine = orderedChain(classified, "spine", "center");
  const neckhead = [
    ...orderedChain(classified, "neck", "center"),
    ...orderedChain(classified, "head", "center"),
  ];

  const demoted = new Set<string>();
  if (hierarchy && neckhead.length && hips) {
    // Bones on the hips→neck path are the real spine; spine-named bones off
    // that path (a real Tripo rig uses `Spine_3` as a clavicle) are demoted
    // and re-classified geometrically with the other unknown chains.
    const path = new Set<string>();
    let cursor = byName.get(neckhead[0])?.parent;
    while (cursor && cursor !== hips) {
      path.add(cursor);
      cursor = byName.get(cursor)?.parent;
    }
    for (const name of spine) {
      if (!path.has(name)) demoted.add(name);
    }
    spine = spine.filter((name) => path.has(name));
  }

  const limbs = new Map<string, Array<string | null>>();
  const armSlot: Readonly<Record<string, number>> = { shoulder: 0, upperarm: 1, forearm: 2, hand: 3 };
  const legSlot: Readonly<Record<string, number>> = { upperleg: 0, lowerleg: 1, foot: 2, toe: 3 };
  for (const bone of classified) {
    if (bone.leaf || bone.ignore || !bone.slot || bone.side === "center") continue;
    if (bone.slot in armSlot) setLimb(limbs, `arm:${bone.side}`, armSlot[bone.slot], bone.name);
    else if (bone.slot in legSlot) setLimb(limbs, `leg:${bone.side}`, legSlot[bone.slot], bone.name);
  }

  if (hierarchy) {
    const unknowns = classified.filter((bone) =>
      !bone.ignore && !bone.leaf &&
      (bone.slot === null || bone.slot === "limb" || demoted.has(bone.name)) &&
      bone.name !== hips && bone.name !== root,
    );
    const chains = extractChains(unknowns, byName);
    const ys = classified.map((bone) => bone.position?.y ?? 0);
    const minY = Math.min(...ys);
    const height = Math.max(...ys) - minY || 1;
    const arms: Chain[] = [];
    const legs: Chain[] = [];
    for (const chain of chains) {
      if (chain.bones.length < 2) continue; // single connectors stay unmapped
      if (chain.attach && (chain.attach.slot === "head" || chain.attach.slot === "neck")) continue;
      const head = chain.bones[0].position;
      const tip = chain.bones[chain.bones.length - 1].position;
      if (!head || !tip) continue;
      const attachY = chain.attach?.position?.y ?? head.y;
      const attachFraction = (attachY - minY) / height;
      if (attachFraction > 0.45) arms.push(chain);
      else if (tip.y < head.y) legs.push(chain);
    }
    arms.sort((a, b) => b.bones.length - a.bones.length);
    legs.sort((a, b) => b.bones.length - a.bones.length);
    for (const [kind, kindChains, positions] of [
      ["arm", arms.slice(0, 2), armSlot],
      ["leg", legs.slice(0, 2), legSlot],
    ] as const) {
      assignChainSides(kindChains);
      for (const chain of kindChains) {
        // Chains hanging off a spine bone start at the shoulder; chains that
        // continue an already-classified limb bone start one position later.
        let start = 0;
        const attachSlot = chain.attach?.slot;
        if (kind === "arm" && attachSlot && attachSlot in positions) start = positions[attachSlot] + 1;
        if (kind === "leg" && attachSlot && attachSlot in positions) start = positions[attachSlot] + 1;
        chain.bones.forEach((bone, index) => {
          setLimb(limbs, `${kind}:${chain.side}`, start + index, bone.name);
        });
      }
    }
  } else {
    // Name-only mode: trust the documented Tripo chain groups (0 arms, 1 legs).
    for (const side of ["left", "right"] as const) {
      for (const [group, kind] of [[0, "arm"], [1, "leg"]] as const) {
        const chain = classified
          .filter((bone) => bone.slot === "limb" && bone.group === group && bone.side === side)
          .sort((a, b) => a.rank - b.rank);
        chain.forEach((bone, index) => setLimb(limbs, `${kind}:${side}`, index, bone.name));
      }
    }
  }

  const fingers = new Map<string, string[]>();
  for (const bone of classified) {
    if (bone.leaf || bone.ignore || !bone.slot?.startsWith("finger:") || bone.side === "center") continue;
    const key = `${bone.slot}:${bone.side}`;
    const chain = fingers.get(key) ?? [];
    chain.push(bone.name);
    fingers.set(key, chain);
  }
  for (const [key, chain] of fingers) {
    fingers.set(key, chain.sort((a, b) => (byName.get(a)?.rank ?? 0) - (byName.get(b)?.rank ?? 0)));
  }

  return { hips, root, spine, neckhead, limbs, fingers };
}

function mapChain(
  boneMap: Record<string, string>,
  targetChain: readonly string[],
  sourceChain: readonly string[],
): void {
  if (!targetChain.length || !sourceChain.length) return;
  for (let index = 0; index < targetChain.length; index += 1) {
    const sourceIndex = targetChain.length === 1
      ? Math.floor((sourceChain.length - 1) / 2)
      : Math.round((index * (sourceChain.length - 1)) / (targetChain.length - 1));
    boneMap[targetChain[index]] = sourceChain[sourceIndex];
  }
}

/**
 * Heuristically maps target bones onto source (animation-library) bones.
 * Accepts plain name lists, or `BoneDescriptor`s with parents and bind-pose
 * world positions for hierarchy-aware matching (recommended — required for
 * real Tripo rigs, whose chain names are unreliable). Unmapped bones are
 * reported instead of guessed: target bones keep their bind pose, source
 * bones lose their motion (typically fingers and leaf ends).
 */
export function autoMapBones(
  targetBones: readonly (string | BoneDescriptor)[],
  sourceBones: readonly (string | BoneDescriptor)[],
): BoneMapResult {
  const targetDescriptors = toDescriptors(targetBones);
  const sourceDescriptors = toDescriptors(sourceBones);
  const target = buildSlots(targetDescriptors);
  const source = buildSlots(sourceDescriptors);

  const boneMap: Record<string, string> = {};
  if (target.hips && source.hips) boneMap[target.hips] = source.hips;
  if (target.root && source.root) boneMap[target.root] = source.root;
  mapChain(boneMap, target.spine, source.spine);
  mapChain(boneMap, target.neckhead, source.neckhead);
  for (const [key, targetChain] of target.limbs) {
    const sourceChain = source.limbs.get(key);
    if (!sourceChain) continue;
    targetChain.forEach((name, position) => {
      const sourceName = sourceChain[position];
      if (name && sourceName) boneMap[name] = sourceName;
    });
  }
  for (const [key, targetChain] of target.fingers) {
    const sourceChain = source.fingers.get(key);
    if (sourceChain) mapChain(boneMap, targetChain, sourceChain);
  }

  const usedSources = new Set(Object.values(boneMap));
  return {
    boneMap,
    sourceHip: source.hips,
    targetHip: target.hips && boneMap[target.hips] ? target.hips : null,
    unmappedTargetBones: targetDescriptors.map((bone) => bone.name).filter((name) => !(name in boneMap)),
    unmappedSourceBones: sourceDescriptors.map((bone) => bone.name).filter((name) => !usedSources.has(name)),
  };
}

/**
 * Resolves a hand-written bone map against the bone names that actually exist
 * on both skeletons, matching by `normalizeBoneName` — so a map written with
 * `tripo::Root` still applies after three's GLTFLoader sanitizes the name to
 * `tripoRoot`. Entries whose target or source bone is missing are dropped.
 */
export function resolveBoneMap(
  map: Readonly<Record<string, string>>,
  targetBones: readonly string[],
  sourceBones: readonly string[],
): Record<string, string> {
  const targetByNormalized = new Map(targetBones.map((name) => [normalizeBoneName(name), name]));
  const sourceByNormalized = new Map(sourceBones.map((name) => [normalizeBoneName(name), name]));
  const resolved: Record<string, string> = {};
  for (const [targetName, sourceName] of Object.entries(map)) {
    const target = targetByNormalized.get(normalizeBoneName(targetName));
    const source = sourceByNormalized.get(normalizeBoneName(sourceName));
    if (target && source) resolved[target] = source;
  }
  return resolved;
}

/** The hips-equivalent bone of a skeleton, by name (falls back to a root bone). */
export function findHipBone(bones: readonly (string | BoneDescriptor)[]): string | null {
  return buildSlots(toDescriptors(bones)).hips;
}
