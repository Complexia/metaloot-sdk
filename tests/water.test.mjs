import assert from "node:assert/strict";
import test from "node:test";

import { DoubleSide, Group, Mesh, MeshBasicMaterial, ShaderMaterial } from "three";

import {
  WATER_DEPTH_ATTRIBUTE,
  buildPoolsGeometry,
  buildRibbonGeometry,
  createUnderTint,
  createWaterMaterial,
  createWaterSurface,
} from "../dist/water.js";

const attribute = (geometry, name) => geometry.getAttribute(name);
const depthArray = (geometry) => attribute(geometry, WATER_DEPTH_ATTRIBUTE).array;

// Every triangle's geometric normal, from positions + index.
const faceNormals = (geometry) => {
  const positions = attribute(geometry, "position").array;
  const index = geometry.index.array;
  const normals = [];
  for (let i = 0; i < index.length; i += 3) {
    const [a, b, c] = [index[i], index[i + 1], index[i + 2]].map((v) => v * 3);
    const abx = positions[b] - positions[a];
    const aby = positions[b + 1] - positions[a + 1];
    const abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a];
    const acy = positions[c + 1] - positions[a + 1];
    const acz = positions[c + 2] - positions[a + 2];
    normals.push([
      aby * acz - abz * acy,
      abz * acx - abx * acz,
      abx * acy - aby * acx,
    ]);
  }
  return normals;
};

test("createWaterMaterial builds a transparent double-sided shader material", () => {
  const material = createWaterMaterial();
  assert.ok(material instanceof ShaderMaterial);
  assert.equal(material.transparent, true);
  assert.equal(material.depthWrite, false);
  assert.equal(material.side, DoubleSide);
  assert.equal(material.uniforms.uTime.value, 0);
  assert.equal(material.uniforms.uDeep.value.getHexString(), "1a5f7a");
  assert.equal(material.uniforms.uShallow.value.getHexString(), "43a9d2");
  assert.equal(material.uniforms.uFoam.value.getHexString(), "d8f4ff");
  assert.equal(material.uniforms.uSky.value.getHexString(), "a8d4f0");
  assert.equal(material.uniforms.uAlphaMin.value, 0.62);
  assert.equal(material.uniforms.uAlphaMax.value, 0.9);
  assert.match(material.vertexShader, /attribute float aDepth/);
});

test("createWaterMaterial applies color and alpha overrides", () => {
  const material = createWaterMaterial({
    deep: 0x112233,
    shallow: "#445566",
    foam: 0x778899,
    sky: 0xaabbcc,
    alphaMin: 0.4,
    alphaMax: 1,
  });
  assert.equal(material.uniforms.uDeep.value.getHexString(), "112233");
  assert.equal(material.uniforms.uShallow.value.getHexString(), "445566");
  assert.equal(material.uniforms.uFoam.value.getHexString(), "778899");
  assert.equal(material.uniforms.uSky.value.getHexString(), "aabbcc");
  assert.equal(material.uniforms.uAlphaMin.value, 0.4);
  assert.equal(material.uniforms.uAlphaMax.value, 1);
});

test("buildRibbonGeometry packs aDepth 1 at the centre and 0 at the edges", () => {
  const geometry = buildRibbonGeometry({
    centerline: (x) => Math.sin(x * 0.1) * 4,
    bounds: [-50, 50],
    halfWidth: 10,
    segments: 20,
    widthSegments: 8,
  });
  assert.equal(attribute(geometry, "position").count, 21 * 9);
  assert.equal(geometry.index.count, 20 * 8 * 6);
  const depths = depthArray(geometry);
  for (let i = 0; i < 21; i++) {
    const row = i * 9;
    assert.equal(depths[row], 0); // outer edge
    assert.equal(depths[row + 8], 0); // outer edge
    assert.equal(depths[row + 4], 1); // channel centre
  }
  for (const depth of depths) assert.ok(depth >= 0 && depth <= 1);
});

test("buildRibbonGeometry offsets perpendicular to the centerline tangent", () => {
  // Straight +x river: lateral offset must be pure z, spanning ±halfWidth.
  const straight = buildRibbonGeometry({
    centerline: (x) => 3,
    bounds: [0, 100],
    halfWidth: 5,
    segments: 4,
    widthSegments: 2,
  });
  const positions = attribute(straight, "position").array;
  assert.equal(positions[0], 0); // x of first column, first vertex
  assert.equal(positions[2], -2); // z = 3 - halfWidth
  assert.equal(positions[8], 8); // z = 3 + halfWidth

  // Parametric straight +z river: lateral offset must be pure x.
  const parametric = buildRibbonGeometry({
    centerline: (u) => ({ x: 0, z: u * 100 }),
    halfWidth: 5,
    segments: 4,
    widthSegments: 2,
  });
  const p = attribute(parametric, "position").array;
  assert.ok(Math.abs(Math.abs(p[0]) - 5) < 1e-6);
  assert.equal(p[2], 0);
});

test("buildRibbonGeometry front faces point +Y", () => {
  const geometry = buildRibbonGeometry({
    centerline: (u) => ({ x: Math.cos(u * 2) * 40, z: Math.sin(u * 2) * 40 }),
    halfWidth: 6,
    segments: 16,
    widthSegments: 4,
  });
  for (const [, y] of faceNormals(geometry)) assert.ok(y > 0);
});

// A single round basin: submerged inside radius 10 (up to 2 units deep).
const basin = (x, z) => Math.hypot(x, z) / 5 - 2;
const bounds = { minX: -20, minZ: -20, maxX: 20, maxZ: 20 };

test("buildPoolsGeometry covers submerged cells and overlaps the shore", () => {
  const geometry = buildPoolsGeometry({
    heightAt: basin,
    waterLevel: 0,
    bounds,
    resolution: 20, // 2-unit cells
  });
  const depths = depthArray(geometry);
  assert.ok(geometry.index.count > 0);
  // The deepest vertex sits at the basin centre (2 units → aDepth 1); the
  // one-cell shore overlap keeps dry bank vertices at aDepth 0.
  assert.ok(Math.max(...depths) > 0.99);
  assert.equal(Math.min(...depths), 0);

  const positions = attribute(geometry, "position").array;
  let maxRadius = 0;
  for (let i = 0; i < positions.length; i += 3) {
    maxRadius = Math.max(maxRadius, Math.hypot(positions[i], positions[i + 2]));
    assert.equal(positions[i + 1], 0); // flat, y = 0
  }
  // Surface reaches beyond the waterline (radius 10) onto the bank, but only
  // by the one-cell overlap.
  assert.ok(maxRadius > 10);
  assert.ok(maxRadius < 10 + 2 * Math.hypot(2, 2));
});

test("buildPoolsGeometry includes quads with a single submerged corner", () => {
  // Water level grazes one grid vertex: heightAt(0, 0) = -1, everything else dry.
  const geometry = buildPoolsGeometry({
    heightAt: (x, z) => (x === 0 && z === 0 ? -1 : 1),
    waterLevel: 0,
    bounds: { minX: -2, minZ: -2, maxX: 2, maxZ: 2 },
    resolution: 4,
  });
  // All four quads around the origin are kept (any-corner rule).
  assert.equal(geometry.index.count, 4 * 6);
});

test("buildPoolsGeometry deduplicates shared grid vertices", () => {
  const geometry = buildPoolsGeometry({
    heightAt: (x, z) => (x === 0 && z === 0 ? -1 : 1),
    waterLevel: 0,
    bounds: { minX: -2, minZ: -2, maxX: 2, maxZ: 2 },
    resolution: 4,
  });
  // 4 quads in a 2×2 block share their inner vertices: 9 unique, not 16.
  assert.equal(attribute(geometry, "position").count, 9);
});

test("buildPoolsGeometry honors the exclusion mask and depth packing", () => {
  const full = buildPoolsGeometry({ heightAt: basin, waterLevel: 0, bounds, resolution: 20 });
  const masked = buildPoolsGeometry({
    heightAt: basin,
    waterLevel: 0,
    bounds,
    resolution: 20,
    exclude: (x) => x > 0,
  });
  assert.ok(masked.index.count > 0);
  assert.ok(masked.index.count < full.index.count);
  const positions = attribute(masked, "position").array;
  for (let i = 0; i < positions.length; i += 3) assert.ok(positions[i] <= 0);

  // depthScale/depthCurve shape the packed value: 1 unit deep, scale 4, curve 1 → 0.25.
  const shaped = buildPoolsGeometry({
    heightAt: () => -1,
    waterLevel: 0,
    bounds: { minX: 0, minZ: 0, maxX: 2, maxZ: 2 },
    resolution: 1,
    depthScale: 4,
    depthCurve: 1,
  });
  for (const depth of depthArray(shaped)) assert.ok(Math.abs(depth - 0.25) < 1e-6);
});

test("buildPoolsGeometry returns an empty geometry when nothing is submerged", () => {
  const geometry = buildPoolsGeometry({
    heightAt: () => 5,
    waterLevel: 0,
    bounds,
    resolution: 8,
  });
  assert.equal(attribute(geometry, "position").count, 0);
  assert.equal(geometry.index.count, 0);
});

test("buildPoolsGeometry front faces point +Y", () => {
  const geometry = buildPoolsGeometry({ heightAt: basin, waterLevel: 0, bounds, resolution: 10 });
  for (const [, y] of faceNormals(geometry)) assert.ok(y > 0);
});

test("createUnderTint builds the offset translucent companion mesh", () => {
  const geometry = buildRibbonGeometry({
    centerline: (x) => 0,
    bounds: [0, 10],
    halfWidth: 2,
    segments: 2,
    widthSegments: 2,
  });
  const mesh = createUnderTint(geometry);
  assert.ok(mesh instanceof Mesh);
  assert.equal(mesh.geometry, geometry);
  assert.ok(mesh.material instanceof MeshBasicMaterial);
  assert.equal(mesh.material.color.getHexString(), "0e3a4a");
  assert.equal(mesh.material.opacity, 0.35);
  assert.equal(mesh.material.transparent, true);
  assert.equal(mesh.material.depthWrite, false);
  assert.equal(mesh.position.y, -0.35);
  assert.equal(mesh.renderOrder, 0);

  const custom = createUnderTint(geometry, { color: 0x123456, opacity: 0.5, offsetY: -1 });
  assert.equal(custom.material.color.getHexString(), "123456");
  assert.equal(custom.material.opacity, 0.5);
  assert.equal(custom.position.y, -1);
});

test("createWaterSurface groups surface + under-tint and advances uTime", () => {
  const geometry = buildPoolsGeometry({ heightAt: basin, waterLevel: 0, bounds, resolution: 10 });
  const water = createWaterSurface(geometry, { deep: 0x112233 });
  assert.ok(water.group instanceof Group);
  assert.equal(water.group.children.length, 2);
  assert.equal(water.surface.geometry, geometry);
  assert.equal(water.surface.renderOrder, 1);
  assert.equal(water.underTint.renderOrder, 0);
  assert.equal(water.underTint.position.y, -0.35);
  assert.equal(water.uniforms.uDeep.value.getHexString(), "112233");

  water.update(0.5);
  water.update(0.25);
  assert.equal(water.uniforms.uTime.value, 0.75);
  water.dispose();
});

test("createWaterSurface shares a caller material and can skip the under-tint", () => {
  const material = createWaterMaterial();
  const geometryA = buildPoolsGeometry({ heightAt: basin, waterLevel: 0, bounds, resolution: 8 });
  const geometryB = buildPoolsGeometry({ heightAt: basin, waterLevel: 0, bounds, resolution: 6 });
  const river = createWaterSurface(geometryA, { material });
  const lake = createWaterSurface(geometryB, { material, underTint: false });
  assert.equal(river.material, material);
  assert.equal(lake.material, material);
  assert.equal(lake.underTint, null);
  assert.equal(lake.group.children.length, 1);

  river.update(1); // one clock: both surfaces animate together
  assert.equal(lake.uniforms.uTime.value, 1);

  river.dispose();
  lake.dispose();
  // Shared material outlives the surfaces that borrowed it.
  assert.equal(material.uniforms.uTime.value, 1);
});
