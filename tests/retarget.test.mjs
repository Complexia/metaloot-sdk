import assert from "node:assert/strict";
import test from "node:test";

import {
  TRIPO_BONE_MAP,
  autoMapBones,
  findHipBone,
  normalizeBoneName,
  resolveBoneMap,
} from "../dist/retarget.js";

// Joint names observed in the hosted UAL1_Standard.glb (Quaternius Universal
// Animation Library, UE-Mannequin-style skeleton).
const UAL_BONES = [
  "root", "pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "Head",
  "clavicle_l", "upperarm_l", "lowerarm_l", "hand_l",
  "index_01_l", "index_02_l", "index_03_l", "index_04_leaf_l",
  "middle_01_l", "middle_02_l", "middle_03_l", "middle_04_leaf_l",
  "pinky_01_l", "pinky_02_l", "pinky_03_l", "pinky_04_leaf_l",
  "ring_01_l", "ring_02_l", "ring_03_l", "ring_04_leaf_l",
  "thumb_01_l", "thumb_02_l", "thumb_03_l", "thumb_04_leaf_l",
  "clavicle_r", "upperarm_r", "lowerarm_r", "hand_r",
  "index_01_r", "index_02_r", "index_03_r", "index_04_leaf_r",
  "middle_01_r", "middle_02_r", "middle_03_r", "middle_04_leaf_r",
  "pinky_01_r", "pinky_02_r", "pinky_03_r", "pinky_04_leaf_r",
  "ring_01_r", "ring_02_r", "ring_03_r", "ring_04_leaf_r",
  "thumb_01_r", "thumb_02_r", "thumb_03_r", "thumb_04_leaf_r",
  "thigh_l", "calf_l", "foot_l", "ball_l", "ball_leaf_l",
  "thigh_r", "calf_r", "foot_r", "ball_r", "ball_leaf_r",
];

// The documented Tripo v2.5 naming scheme (raw GLB names).
const TRIPO_DOCUMENTED = [
  "tripo::Root",
  "tripo::Spine_0", "tripo::Spine_1", "tripo::Spine_2", "tripo::Spine_3",
  "tripo::Head_0", "tripo::Head_1", "tripo::Head_2",
  "tripo::0_Left_Limb_0", "tripo::0_Left_Limb_1", "tripo::0_Left_Limb_2",
  "tripo::0_Left_Limb_3", "tripo::0_Left_Limb_4",
  "tripo::0_Right_Limb_0", "tripo::0_Right_Limb_1", "tripo::0_Right_Limb_2",
  "tripo::0_Right_Limb_3", "tripo::0_Right_Limb_4",
  "tripo::1_Left_Limb_0", "tripo::1_Left_Limb_1", "tripo::1_Left_Limb_2",
  "tripo::1_Right_Limb_0", "tripo::1_Right_Limb_1", "tripo::1_Right_Limb_2",
];

const MIXAMO_BONES = [
  "mixamorig:Hips", "mixamorig:Spine", "mixamorig:Spine1", "mixamorig:Spine2",
  "mixamorig:Neck", "mixamorig:Head", "mixamorig:HeadTop_End",
  "mixamorig:LeftShoulder", "mixamorig:LeftArm", "mixamorig:LeftForeArm", "mixamorig:LeftHand",
  "mixamorig:RightShoulder", "mixamorig:RightArm", "mixamorig:RightForeArm", "mixamorig:RightHand",
  "mixamorig:LeftUpLeg", "mixamorig:LeftLeg", "mixamorig:LeftFoot", "mixamorig:LeftToeBase",
  "mixamorig:RightUpLeg", "mixamorig:RightLeg", "mixamorig:RightFoot", "mixamorig:RightToeBase",
];

// A real production Tripo v2.5 rig (KayKit knight auto-rig) with the names
// GLTFLoader produces after sanitizing "tripo::" prefixes, plus bind-pose
// world positions. Deviates from the documented scheme: "0_Left_Limb_*"
// chains are the LEGS, one arm is "Spine_3 → bone_8 → bone_9", and Root sits
// at ground level.
const TRIPO_REAL_RIG = [
  { name: "tripoRoot", parent: null, position: { x: 0, y: 0.014, z: 0 } },
  { name: "tripoSpine_0", parent: "tripoRoot", position: { x: 0, y: 0.55, z: 0 } },
  { name: "tripoSpine_1", parent: "tripoSpine_0", position: { x: 0, y: 0.63, z: 0 } },
  { name: "tripoSpine_2", parent: "tripoSpine_1", position: { x: 0, y: 0.73, z: 0 } },
  { name: "tripoHead_0", parent: "tripoSpine_2", position: { x: 0.01, y: 0.82, z: 0 } },
  { name: "tripoHead_1", parent: "tripoHead_0", position: { x: 0.01, y: 0.86, z: 0 } },
  { name: "tripoHead_2", parent: "tripoHead_1", position: { x: 0.01, y: 0.89, z: 0 } },
  { name: "tripoSpine_3", parent: "tripoSpine_2", position: { x: 0.06, y: 0.8, z: 0 } },
  { name: "bone_8", parent: "tripoSpine_3", position: { x: 0.17, y: 0.78, z: 0 } },
  { name: "bone_9", parent: "bone_8", position: { x: 0.32, y: 0.7, z: 0 } },
  { name: "tripo0_Right_Limb_0", parent: "tripoSpine_2", position: { x: -0.06, y: 0.8, z: 0 } },
  { name: "tripo0_Right_Limb_1", parent: "tripo0_Right_Limb_0", position: { x: -0.17, y: 0.78, z: 0 } },
  { name: "tripo0_Right_Limb_2", parent: "tripo0_Right_Limb_1", position: { x: -0.32, y: 0.7, z: 0 } },
  { name: "tripo0_Left_Limb_0", parent: "tripoRoot", position: { x: 0, y: 0.47, z: 0 } },
  { name: "bone_14", parent: "tripo0_Left_Limb_0", position: { x: -0.11, y: 0.46, z: 0 } },
  { name: "bone_15", parent: "bone_14", position: { x: -0.11, y: 0.25, z: 0 } },
  { name: "bone_16", parent: "bone_15", position: { x: -0.11, y: 0.05, z: 0 } },
  { name: "bone_17", parent: "bone_16", position: { x: -0.11, y: 0.01, z: 0.06 } },
  { name: "tripo0_Left_Limb_1", parent: "tripo0_Left_Limb_0", position: { x: 0.11, y: 0.46, z: 0 } },
  { name: "tripo0_Left_Limb_2", parent: "tripo0_Left_Limb_1", position: { x: 0.11, y: 0.25, z: 0 } },
  { name: "tripo0_Left_Limb_3", parent: "tripo0_Left_Limb_2", position: { x: 0.11, y: 0.05, z: 0 } },
  { name: "tripo0_Left_Limb_4", parent: "tripo0_Left_Limb_3", position: { x: 0.11, y: 0.01, z: 0.06 } },
];

test("normalizeBoneName unifies raw and GLTFLoader-sanitized names", () => {
  assert.equal(normalizeBoneName("tripo::Root"), "root");
  assert.equal(normalizeBoneName("tripoRoot"), "root");
  assert.equal(normalizeBoneName("tripo::0_Left_Limb_2"), normalizeBoneName("tripo0_Left_Limb_2"));
  assert.equal(normalizeBoneName("mixamorig:LeftForeArm"), "leftforearm");
});

test("documented tripo naming maps onto the UAL skeleton by name alone", () => {
  const { boneMap, sourceHip, targetHip, unmappedTargetBones } =
    autoMapBones(TRIPO_DOCUMENTED, UAL_BONES);
  assert.equal(boneMap["tripo::Root"], "pelvis");
  assert.equal(sourceHip, "pelvis");
  assert.equal(targetHip, "tripo::Root");
  assert.equal(boneMap["tripo::Spine_0"], "spine_01");
  assert.equal(boneMap["tripo::Spine_3"], "spine_03");
  assert.equal(boneMap["tripo::Head_0"], "neck_01");
  assert.equal(boneMap["tripo::Head_1"], "Head");
  assert.equal(boneMap["tripo::0_Left_Limb_0"], "clavicle_l");
  assert.equal(boneMap["tripo::0_Left_Limb_1"], "upperarm_l");
  assert.equal(boneMap["tripo::0_Left_Limb_2"], "lowerarm_l");
  assert.equal(boneMap["tripo::0_Left_Limb_3"], "hand_l");
  assert.equal(boneMap["tripo::0_Right_Limb_1"], "upperarm_r");
  assert.equal(boneMap["tripo::1_Left_Limb_0"], "thigh_l");
  assert.equal(boneMap["tripo::1_Left_Limb_1"], "calf_l");
  assert.equal(boneMap["tripo::1_Left_Limb_2"], "foot_l");
  assert.equal(boneMap["tripo::1_Right_Limb_2"], "foot_r");
  // Hand leaf ends have no safe UAL counterpart.
  assert.ok(unmappedTargetBones.includes("tripo::0_Left_Limb_4"));
});

test("mixamo-style skeleton maps onto the UAL skeleton", () => {
  const { boneMap, unmappedTargetBones, unmappedSourceBones } =
    autoMapBones(MIXAMO_BONES, UAL_BONES);
  assert.equal(boneMap["mixamorig:Hips"], "pelvis");
  assert.equal(boneMap["mixamorig:Spine"], "spine_01");
  assert.equal(boneMap["mixamorig:Spine1"], "spine_02");
  assert.equal(boneMap["mixamorig:Spine2"], "spine_03");
  assert.equal(boneMap["mixamorig:Neck"], "neck_01");
  assert.equal(boneMap["mixamorig:Head"], "Head");
  assert.equal(boneMap["mixamorig:LeftShoulder"], "clavicle_l");
  assert.equal(boneMap["mixamorig:LeftArm"], "upperarm_l");
  assert.equal(boneMap["mixamorig:LeftForeArm"], "lowerarm_l");
  assert.equal(boneMap["mixamorig:LeftHand"], "hand_l");
  assert.equal(boneMap["mixamorig:LeftUpLeg"], "thigh_l");
  assert.equal(boneMap["mixamorig:LeftLeg"], "calf_l");
  assert.equal(boneMap["mixamorig:LeftFoot"], "foot_l");
  assert.equal(boneMap["mixamorig:LeftToeBase"], "ball_l");
  assert.equal(boneMap["mixamorig:RightToeBase"], "ball_r");
  // Leaf markers stay unmapped; unused UAL finger motion is reported.
  assert.ok(unmappedTargetBones.includes("mixamorig:HeadTop_End"));
  assert.ok(unmappedSourceBones.includes("thumb_01_l"));
});

test("hierarchy mode recovers a real tripo rig that deviates from the scheme", () => {
  const ualDescriptors = UAL_BONES.map((name) => ({ name }));
  // Give UAL descriptors parents/positions? Not needed: hierarchy mode is
  // per-skeleton, and the UAL side is fully named — keep it name-only.
  const { boneMap, unmappedTargetBones } = autoMapBones(TRIPO_REAL_RIG, ualDescriptors);
  assert.equal(boneMap["tripoRoot"], "pelvis");
  // Main spine is the hips→head path; Spine_3 is NOT spine.
  assert.equal(boneMap["tripoSpine_0"], "spine_01");
  assert.equal(boneMap["tripoSpine_1"], "spine_02");
  assert.equal(boneMap["tripoSpine_2"], "spine_03");
  assert.equal(boneMap["tripoHead_0"], "neck_01");
  assert.equal(boneMap["tripoHead_1"], "Head");
  // Off-path "Spine_3 → bone_8 → bone_9" is geometrically the LEFT arm.
  assert.equal(boneMap["tripoSpine_3"], "clavicle_l");
  assert.equal(boneMap["bone_8"], "upperarm_l");
  assert.equal(boneMap["bone_9"], "lowerarm_l");
  assert.equal(boneMap["tripo0_Right_Limb_0"], "clavicle_r");
  assert.equal(boneMap["tripo0_Right_Limb_1"], "upperarm_r");
  assert.equal(boneMap["tripo0_Right_Limb_2"], "lowerarm_r");
  // "0_Left_Limb_*" chains hang off the hips and descend: they are legs.
  assert.equal(boneMap["tripo0_Left_Limb_1"], "thigh_l");
  assert.equal(boneMap["tripo0_Left_Limb_2"], "calf_l");
  assert.equal(boneMap["tripo0_Left_Limb_3"], "foot_l");
  assert.equal(boneMap["tripo0_Left_Limb_4"], "ball_l");
  assert.equal(boneMap["bone_14"], "thigh_r");
  assert.equal(boneMap["bone_15"], "calf_r");
  assert.equal(boneMap["bone_16"], "foot_r");
  assert.equal(boneMap["bone_17"], "ball_r");
  // The shared legs-root connector stays in bind pose.
  assert.ok(unmappedTargetBones.includes("tripo0_Left_Limb_0"));
});

test("resolveBoneMap matches the static tripo preset to sanitized runtime names", () => {
  const sanitized = TRIPO_DOCUMENTED.map((name) => name.replace(/[:]/g, ""));
  const resolved = resolveBoneMap(TRIPO_BONE_MAP, sanitized, UAL_BONES);
  assert.equal(resolved["tripoRoot"], "pelvis");
  assert.equal(resolved["tripo0_Left_Limb_1"], "upperarm_l");
  assert.equal(resolved["tripo1_Right_Limb_2"], "foot_r");
  assert.ok(!("tripo::Root" in resolved));
});

test("findHipBone prefers hips-named bones and falls back to a root bone", () => {
  assert.equal(findHipBone(UAL_BONES), "pelvis");
  assert.equal(findHipBone(TRIPO_DOCUMENTED), "tripo::Root");
  assert.equal(findHipBone(["a", "b"]), null);
});
