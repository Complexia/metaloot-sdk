import assert from "node:assert/strict";
import test from "node:test";

import {
  assetFileUrl,
  assetManifestUrl,
  getAssetManifest,
  loadAssetFile,
} from "../dist/assets.js";

test("pack URLs stay on the configured Metaloot Studio origin", () => {
  assert.equal(
    assetManifestUrl("pack one", { origin: "https://studio.example" }),
    "https://studio.example/api/assets/pack%20one/manifest",
  );
  assert.equal(
    assetFileUrl("pack one", { origin: "https://studio.example", path: "Audio/hit 1.ogg" }),
    "https://studio.example/api/assets/pack%20one/file?path=Audio%2Fhit+1.ogg",
  );
});

test("getAssetManifest resolves the hosted archive URL", async () => {
  const manifest = await getAssetManifest("sounds", {
    origin: "https://studio.example",
    fetch: async (url) => {
      assert.equal(url, "https://studio.example/api/assets/sounds/manifest");
      return new Response(JSON.stringify({
        schemaVersion: 1,
        id: "sounds",
        slug: "sounds",
        name: "Sounds",
        creator: "Metaloot",
        license: "CC0 1.0",
        archive: { url: "/api/assets/sounds/file", bytes: 3, sha256: "abc" },
        files: [{ path: "hit.ogg", bytes: 3, contentType: "audio/ogg", sha256: "def" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  assert.equal(manifest.archive.url, "https://studio.example/api/assets/sounds/file");
  assert.equal(manifest.files[0].path, "hit.ogg");
});

test("loadAssetFile requests an individual manifest path", async () => {
  const bytes = await loadAssetFile("sounds", {
    origin: "https://studio.example",
    path: "Audio/hit.ogg",
    fetch: async (url) => {
      assert.equal(url, "https://studio.example/api/assets/sounds/file?path=Audio%2Fhit.ogg");
      return new Response(new Uint8Array([1, 2, 3]));
    },
  });
  assert.deepEqual([...new Uint8Array(bytes)], [1, 2, 3]);
});
