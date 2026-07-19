import assert from "node:assert/strict";
import test from "node:test";

import {
  AnimationClip,
  AnimationMixer,
  Bone,
  BoxGeometry,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Texture,
  VectorKeyframeTrack,
} from "three";

import { normalizeMaterials, retargetClips } from "../dist/three.js";

test("game preset clamps metalness and raises the roughness floor", () => {
  const material = new MeshStandardMaterial({ name: "stone", metalness: 1, roughness: 0.1 });
  const root = new Group();
  root.add(new Mesh(new BoxGeometry(), material));
  assert.equal(normalizeMaterials(root), 1);
  assert.equal(material.metalness, 0.2);
  assert.equal(material.roughness, 0.6);
});

test("materials with their own env map keep metalness", () => {
  const material = new MeshStandardMaterial({ metalness: 1, roughness: 0.8 });
  material.envMap = new Texture();
  const root = new Group();
  root.add(new Mesh(new BoxGeometry(), material));
  assert.equal(normalizeMaterials(root), 0);
  assert.equal(material.metalness, 1);
});

test("caller thresholds and per-name color overrides apply", () => {
  const grass = new MeshStandardMaterial({
    name: "grass",
    color: 0x2bd9b8,
    metalness: 0.5,
    roughness: 0.7,
  });
  const leafs = new MeshBasicMaterial({ name: "leafsFall", color: 0xff9140 });
  const root = new Group();
  root.add(new Mesh(new BoxGeometry(), [grass, leafs]));
  const changed = normalizeMaterials(root, {
    maxMetalness: 0,
    minRoughness: 0.8,
    materialOverrides: { grass: 0x4c9e45, leafsFall: "#c26a2d" },
  });
  assert.equal(changed, 2);
  assert.equal(grass.metalness, 0);
  assert.equal(grass.roughness, 0.8);
  assert.equal(grass.color.getHexString(), "4c9e45");
  assert.equal(leafs.color.getHexString(), "c26a2d");
});

test("materials shared across meshes are normalized once", () => {
  const material = new MeshStandardMaterial({ metalness: 1, roughness: 0 });
  const root = new Group();
  root.add(new Mesh(new BoxGeometry(), material));
  root.add(new Mesh(new BoxGeometry(), material));
  assert.equal(normalizeMaterials(root), 1);
});

// hipY sets the hips bone height; segment y-offsets build a pelvis→spine→head
// column so the auto-mapper sees a plausible humanoid core.
const makeRig = (names, hipY) => {
  const [hipName, spineName, headName] = names;
  const hip = new Bone();
  hip.name = hipName;
  hip.position.y = hipY;
  const spine = new Bone();
  spine.name = spineName;
  spine.position.y = hipY * 0.3;
  const head = new Bone();
  head.name = headName;
  head.position.y = hipY * 0.3;
  hip.add(spine);
  spine.add(head);
  const mesh = new SkinnedMesh(new BufferGeometry(), new MeshBasicMaterial());
  const root = new Group();
  root.add(hip);
  root.add(mesh);
  // Bind after world matrices exist so the skeleton's inverse bind matrices
  // capture the real bind pose (as GLTFLoader-loaded skins do).
  root.updateWorldMatrix(true, true);
  mesh.bind(new Skeleton([hip, spine, head]));
  return { root, mesh, bones: { hip, spine, head } };
};

test("retargetClips bakes library clips onto a differently-sized skeleton", () => {
  const source = makeRig(["pelvis", "spine_01", "Head"], 1);
  const quarterTurn = [0, 0, Math.sin(Math.PI / 4), Math.cos(Math.PI / 4)];
  const clip = new AnimationClip("Bob", -1, [
    new VectorKeyframeTrack("pelvis.position", [0, 0.5, 1], [0, 1, 0, 0, 1.1, 0, 0, 1.2, 0]),
    new QuaternionKeyframeTrack("spine_01.quaternion", [0, 1], [0, 0, 0, 1, ...quarterTurn]),
  ]);
  const library = {
    clips: new Map([["Bob", clip]]),
    clipNames: ["Bob"],
    scene: source.root,
    skeleton: source.mesh.skeleton,
    dispose() {},
  };

  const target = makeRig(["tripoRoot", "tripoSpine_1", "tripoHead_1"], 0.5);
  const result = retargetClips(target.root, library, { fps: 4 });

  assert.deepEqual(result.boneMap, {
    tripoRoot: "pelvis",
    tripoSpine_1: "spine_01",
    tripoHead_1: "Head",
  });
  assert.equal(result.hip.library, "pelvis");
  assert.equal(result.hip.target, "tripoRoot");
  // Skeleton heights: 0.8 vs 1.6 world units.
  assert.ok(Math.abs(result.hip.scale - 0.5) < 1e-6);
  assert.deepEqual(result.unmappedLibraryBones, []);

  const retargeted = result.clips.Bob;
  assert.ok(retargeted instanceof AnimationClip);
  const trackNames = retargeted.tracks.map((track) => track.name);
  assert.ok(trackNames.includes("tripoRoot.position"));
  assert.ok(trackNames.includes("tripoRoot.quaternion"));
  assert.ok(trackNames.includes("tripoSpine_1.quaternion"));

  // Hip translation is anchored at the target's own bind height (0.5, not the
  // library's 1.0) and deltas are scaled by the height ratio.
  const hipTrack = retargeted.tracks.find((track) => track.name === "tripoRoot.position");
  assert.ok(Math.abs(hipTrack.values[1] - 0.5) < 1e-3);
  const lastY = hipTrack.values[hipTrack.values.length - 2];
  assert.ok(Math.abs(lastY - 0.6) < 5e-2, `expected ~0.6, got ${lastY}`);

  // The baked clip binds by node name on a plain mixer over the model root.
  const mixer = new AnimationMixer(target.root);
  mixer.clipAction(retargeted).play();
  mixer.update(0.999);
  assert.ok(target.bones.hip.position.y > 0.55);
  assert.ok(Math.abs(target.bones.spine.quaternion.z) > 0.5);
  mixer.stopAllAction();
});

test("retargetClips applies manual boneMap overrides over the auto map", () => {
  const source = makeRig(["pelvis", "spine_01", "Head"], 1);
  const clip = new AnimationClip("Sway", -1, [
    new QuaternionKeyframeTrack("Head.quaternion", [0, 1], [0, 0, 0, 1, 0, 0.5, 0, 0.866]),
  ]);
  const library = {
    clips: new Map([["Sway", clip]]),
    clipNames: ["Sway"],
    scene: source.root,
    skeleton: source.mesh.skeleton,
    dispose() {},
  };
  const target = makeRig(["tripoRoot", "tripoSpine_1", "tripoHead_1"], 0.5);
  const result = retargetClips(target.root, library, {
    preset: "auto",
    // Written raw-style on purpose: resolution must survive name sanitizing.
    boneMap: { "tripo::Head_1": "spine_01", "tripo::Spine_1": "" },
  });
  assert.equal(result.boneMap.tripoHead_1, "spine_01");
  assert.ok(!("tripoSpine_1" in result.boneMap));
  assert.ok(result.unmappedTargetBones.includes("tripoSpine_1"));
});
