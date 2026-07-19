import assert from "node:assert/strict";
import test from "node:test";

import { normalizeBabylonMaterials } from "../dist/babylon.js";

const pbrMaterial = (overrides = {}) => ({
  name: "stone",
  metallic: 1,
  roughness: 0.1,
  albedoColor: { r: 1, g: 1, b: 1 },
  reflectionTexture: null,
  getScene: () => null,
  ...overrides,
});

test("game preset clamps metallic and raises the roughness floor", () => {
  const material = pbrMaterial();
  assert.equal(normalizeBabylonMaterials([material]), 1);
  assert.equal(material.metallic, 0.2);
  assert.equal(material.roughness, 0.6);
});

test("materials with reflections available keep metallic", () => {
  const withReflection = pbrMaterial({ roughness: 0.8, reflectionTexture: {} });
  const withEnvironment = pbrMaterial({
    roughness: 0.8,
    getScene: () => ({ environmentTexture: {} }),
  });
  assert.equal(normalizeBabylonMaterials([withReflection, withEnvironment]), 0);
  assert.equal(withReflection.metallic, 1);
  assert.equal(withEnvironment.metallic, 1);
});

test("per-name color overrides replace albedo", () => {
  const material = pbrMaterial({ name: "grass", metallic: 0, roughness: 1 });
  assert.equal(
    normalizeBabylonMaterials([material], { materialOverrides: { grass: 0x4c9e45 } }),
    1,
  );
  assert.equal(material.albedoColor.toHexString(), "#4C9E45");
});
