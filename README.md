# Metaloot SDK

The unified game-developer SDK for [Metaloot](https://metaloot.app): hosted
2D, 3D, audio, animation, and generated assets from Metaloot Studio, player auth, and multiplayer rooms — as
typed, engine-agnostic building blocks with zero dependencies.

Games deployed with `metaloot deploy` already get auth and multiplayer with
no install (an auth widget and `/__metaloot/multiplayer.js` are served on the
game's own origin). This package adds what npm-based games want on top:
TypeScript types, bundler-friendly imports, and — the star — **hosted
assets**, so your game streams studio-generated GLB models from a URL
instead of bundling them.

## Install

```bash
npm install @metaloot/sdk
```

## Quickstart

Generate a public asset once (`metaloot assets generate --prompt "low-poly
treasure chest" --name "Treasure Chest" --visibility public --wait`), then
load it by id or slug — no download, no file in your repo:

```ts
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createMetaloot } from "@metaloot/sdk";

const ml = createMetaloot();

// Who is playing? (works out of the box on <your-game>.metaloot.app)
const session = await ml.auth.getSession();
if (session.signedIn) console.log(`Hello ${session.user.name}!`);

// Stream a hosted GLB straight into three.js.
const url = await ml.assets.loadAssetObjectUrl("treasure-chest-1a2b3c4d");
new GLTFLoader().load(url, (gltf) => scene.add(gltf.scene));

// Join a multiplayer room (requires sign-in).
const room = await ml.multiplayer.joinRoom("lobby");
room.on("message", ({ from, data }) => console.log(from.name, data));
room.send({ kind: "wave" });
```

Everything is also available as plain functions:

```ts
import { assetUrl, loadAsset, getSession, joinRoom } from "@metaloot/sdk";
```

or per module: `@metaloot/sdk/assets`, `@metaloot/sdk/auth`,
`@metaloot/sdk/multiplayer`.

## Assets

Metaloot Studio ([studio.metaloot.app](https://studio.metaloot.app)) turns
text prompts or images into game-ready GLB models (drive it with
`metaloot assets generate` — see the [CLI](https://www.npmjs.com/package/@metaloot/cli)).
Public assets are hosted at stable Metaloot URLs with CORS enabled, so games
can hot-link them instead of shipping the file. Curated packs expose a hashed
manifest and every listed file through the same Metaloot API; game code never
depends on a creator site.

```ts
import {
  assetUrl,        // (idOrSlug, opts?) => stable hosted URL of the GLB
  assetFileUrl,    // universal URL for any asset or downloadable pack
  assetManifestUrl, // hosted JSON inventory for a pack
  animationUrl,    // (idOrSlug, preset, opts?) => URL of an animated variant
  loadAnimation,   // (idOrSlug, preset, opts?) => Promise<ArrayBuffer>
  loadAnimationObjectUrl, // (idOrSlug, preset, opts?) => loader-ready blob: URL
  loadAsset,       // (idOrSlug, opts?) => Promise<ArrayBuffer>
  loadAssetFile,   // any primary file: image, audio, animation, ZIP, or GLB
  loadAssetFileObjectUrl, // browser-ready blob URL for any primary file
  loadAssetObjectUrl, // (idOrSlug, opts?) => Promise<blob: URL> for GLTFLoader.load
  getAsset,        // (idOrSlug, opts?) => Promise<MetalootAsset> metadata
  getAssetManifest, // paths, MIME types, byte sizes, SHA-256 hashes
  listAssets,      // ({ query?, scope?, ... }?) => Promise<MetalootAsset[]>
} from "@metaloot/sdk/assets";
```

Use the generic file helpers for non-3D catalog entries:

```ts
const packs = await listAssets({ kind: "audio" });
const manifest = await getAssetManifest(packs[0].id);
const sound = manifest.files.find((file) => file.contentType === "audio/ogg");
const bytes = await loadAssetFile(packs[0].id, { path: sound.path });
console.log(sound.path, bytes.byteLength);
```

Omit `path` to download the Metaloot-hosted pack ZIP. `assetUrl`/`loadAsset`
remain optimized for individual GLBs and can use Metaloot Hosting's same-origin
model proxy. Pack manifests and files always use Studio so they work
consistently across every media type.

`assetUrl` picks the best URL automatically:

- On a `<slug>.metaloot.app` game origin it returns the **same-origin proxy**
  `/__metaloot/assets/<idOrSlug>.glb` — edge-cached by Metaloot hosting, zero
  CORS concerns.
- Everywhere else it returns
  `https://studio.metaloot.app/api/assets/<idOrSlug>/file`, which serves
  public assets with `Access-Control-Allow-Origin: *`.
- Override with `{ origin }` (e.g. a local studio) or `{ preferProxy: false }`.

### Variants

Every 3D asset can have two files: the full-resolution **source** model and a
game-ready **LOD** (~15k faces) that the studio builds from it. By default
(`variant: "auto"`) games get the LOD automatically once it's ready, falling
back to the source until then — you don't have to do anything. Ask for a
specific file with `variant`:

```ts
assetUrl("treasure-chest-1a2b3c4d");                        // auto (default)
assetUrl("treasure-chest-1a2b3c4d", { variant: "source" }); // full-res original
await loadAsset("treasure-chest-1a2b3c4d", { variant: "lod" }); // LOD only (404 until ready)
```

`loadAsset` and `loadAssetObjectUrl` take the same option. Responses from the
studio carry an `X-Metaloot-Variant: lod|source` header telling you which file
`auto` resolved to, and `getAsset` metadata includes `sourceModelUrl`,
`lodModelUrl`, and `lodStatus` (`null | "queued" | "running" | "success" |
"failed"`). `"source"` and `"lod"` always use the studio URL — the hosting
proxy only serves `auto`.

### Animations

Assets rigged with `metaloot assets rig` additionally expose animated GLB
variants, one per preset (`idle`, `walk`, `run`, …). `getAsset` metadata
carries `rigStatus` and `animations: { [preset]: { status, url } }`; each
ready `url` (also available via `animationUrl(idOrSlug, preset)`) streams a
GLB containing the rigged model plus that preset's `AnimationClip`. All
presets are retargeted onto the same skeleton, so a game can use the idle
GLB's scene as the character and feed the other clips into one
`AnimationMixer`, crossfading by movement speed:

```ts
const asset = await getAsset("frost-witch-c78f6ed7");
if (asset.animations?.idle?.status === "success") {
  const [idleUrl, walkUrl] = await Promise.all([
    loadAnimationObjectUrl(asset.id, "idle"),
    loadAnimationObjectUrl(asset.id, "walk"),
  ]);
  try {
    const idle = await gltfLoader.loadAsync(idleUrl);
    const walk = await gltfLoader.loadAsync(walkUrl);
    const mixer = new THREE.AnimationMixer(idle.scene);
    mixer.clipAction(idle.animations[0]).play();    // swap to walk.animations[0] when moving
  } finally {
    URL.revokeObjectURL(idleUrl);
    URL.revokeObjectURL(walkUrl);
  }
}
```

No three.js dependency — `loadAsset` and `loadAnimation` return
`ArrayBuffer`s you can feed to any engine (`GLTFLoader.parse`, Babylon
`SceneLoader`, …), and they work in the browser, Node 20+, and Workers alike.

Private assets are only served to their owner. Create a scoped token with
`assets:read` at
[metaloot.app/settings/api-tokens](https://metaloot.app/settings/api-tokens),
then pass `{ token: "mtl_api_…" }`. This works from local browser games with
CORS, Node, and Workers. Never commit the token or include it in a production
bundle; make the asset public or download it into the game for deployment.

Metadata matches the studio API:

```ts
const asset = await getAsset("treasure-chest-1a2b3c4d");
// { id, name, slug, status: "success", progress: 100, visibility, category,
//   tags, modelFormat: "glb", modelUrl, previewUrl, createdAt, ... }

const swords = await listAssets({ query: "sword" });        // public gallery
const characters = await listAssets({
  category: "Characters", // exact, case-insensitive
  kind: "model3d",
});
const mine   = await listAssets({ scope: "private", token }); // your assets
```

### Three.js adapter

The optional `@metaloot/sdk/three` adapter turns a hosted asset into a
game-ready Three.js instance. It handles `GLTFLoader`, game-ready LOD
selection, rigged animation variants, `AnimationMixer` actions, crossfades,
uniform height scaling, centering, grounding, shadows, bounds, and disposal:

```bash
npm install @metaloot/sdk three
```

```ts
import { loadThreeAsset } from "@metaloot/sdk/three";

const hero = await loadThreeAsset("ember-mage", {
  scene,
  animations: ["idle", "walk", "run"], // or "available"
  targetHeight: 1.8,
  shadows: true,
  autoPlay: "idle",
  token: import.meta.env.DEV ? import.meta.env.VITE_METALOOT_TOKEN : undefined,
});

// In the render loop:
hero.update(clock.getDelta());

// State transitions crossfade automatically:
hero.play(speed > 0.1 ? "run" : "idle");

console.log(hero.bounds); // ready for framing or simple collision
hero.dispose();
```

Pass a preconfigured `loader` when a game uses DRACO/KTX2. The adapter never
creates a renderer, camera, lights, physics body, or gameplay collision shape;
those remain deliberate game-level choices, while `bounds` provides the data
needed to create one.

#### Game-ready materials

Hosted GLBs — studio-generated models and curated catalog packs alike — may
ship materials tuned for a PBR viewer rather than a game: `metallicFactor: 1`
with no environment map renders near-black in a typical three.js scene, and
some stylized packs carry off-palette base colors (aqua grass, pure-white
stone) that wash out further under ACES tone mapping. Opt in to the `game`
preset instead of hand-rolling per-material fixups:

```ts
const rock = await loadThreeAsset("rock-large", {
  scene,
  normalizeMaterials: true, // game preset: metalness ≤ 0.2, roughness ≥ 0.6
});

// Tune the thresholds, or recolor specific materials by glTF material name:
const tree = await loadThreeAsset("tree-pine", {
  scene,
  normalizeMaterials: {
    maxMetalness: 0,
    minRoughness: 0.8,
    materialOverrides: { grass: 0x4c9e45, leafsFall: "#c26a2d" },
  },
});
```

The option defaults to off, so existing scenes render exactly as before, but
the preset is the recommended starting point for new games. Materials that
bring their own `envMap` keep their metalness; if your scene supplies
reflections through `scene.environment` and you want true metals, pass
`maxMetalness: 1` or leave normalization off for those assets.

The standalone helper works with any loaded GLTF, not just Metaloot loads:

```ts
import { normalizeMaterials } from "@metaloot/sdk/three";

const gltf = await loader.loadAsync(url);
normalizeMaterials(gltf.scene, { materialOverrides: { stone: 0x8a8f98 } });
```

#### Borrowing animations from the Universal Animation Library

Metaloot hosts the Quaternius **Universal Animation Library** as a curated
pack (`quaternius-universal-animation-library`): a UE-Mannequin-style
humanoid skeleton with 43 high-quality clips (`Idle_Loop`, `Walk_Loop`,
`Sprint_Loop`, `Sword_Attack`, `Roll`, …). The three adapter can retarget
those clips onto **any humanoid model** — Metaloot Studio's auto-rigged
(Tripo) characters or your own GLBs — so a hero is not limited to the
Metaloot animation presets:

```ts
import { loadThreeAsset } from "@metaloot/sdk/three";

const hero = await loadThreeAsset("path-knight-8082eb40", {
  scene,
  animations: ["idle"],           // a rigged base — retargeting needs a skeleton
  targetHeight: 1.8,
  animationLibrary: {
    source: "quaternius-universal-animation-library",
    clips: ["Idle_Loop", "Walk_Loop", "Sprint_Loop", "Sword_Attack"],
    rename: { Idle_Loop: "ual-idle", Walk_Loop: "walk", Sprint_Loop: "run", Sword_Attack: "attack" },
  },
  autoPlay: "idle",
});

hero.play("run");                  // retargeted clips are ordinary actions
console.log(hero.retarget);        // which bones mapped, which did not
```

Or do it by hand — load a hero any way you like, borrow clips explicitly:

```ts
import { loadAnimationLibrary, retargetClips, loadThreeAsset } from "@metaloot/sdk/three";
import { AnimationMixer } from "three";

const hero = await loadThreeAsset("path-knight-8082eb40", { scene, animations: ["idle"] });
const library = await loadAnimationLibrary("quaternius-universal-animation-library");
console.log(library.clipNames);    // all 43 clips

const { clips, boneMap, unmappedTargetBones } = retargetClips(hero.root, library, {
  clips: ["Idle_Loop", "Walk_Loop", "Jog_Fwd_Loop"],
});
library.dispose();                 // retargeted clips are self-contained

const mixer = new AnimationMixer(hero.root);
mixer.clipAction(clips.Walk_Loop).play();
// … mixer.update(delta) in the render loop
```

The default `preset: "auto"` maps bones by normalized names **plus the actual
bone hierarchy and bind pose**. That matters for real Tripo rigs: their chain
names are unreliable (production rigs have been observed with leg chains
named `0_Left_Limb_*`, an arm spelled `Spine_3 → bone_8 → bone_9`, and the
`Root` bone at ground level), so the mapper classifies ambiguous chains by
where they attach and which way they run, and anchors hip translation at the
target's own bind-pose hip position with motion scaled to the skeletons'
height ratio. A static `preset: "tripo"` map for the documented Tripo v2.5
naming scheme is also available (`TRIPO_BONE_MAP`).

**Auto-mapping quality has limits.** It transfers the core humanoid pose
(hips, spine, neck/head, arms, legs) but drops what the target cannot
express: UAL finger curls on a fingerless rig, leaf/end bones, and root
motion for rigs without a dedicated root bone (use the pack's
`UAL1_Standard_RM.glb` via `path` for root-motion variants). Always check the
returned report — `unmappedTargetBones` stay in bind pose,
`unmappedLibraryBones` lose their motion — and expect side-cases (weapon
bones, capes, off-axis bind poses) to need help. When the heuristic guesses
wrong, supply a custom map; it overrides individual auto entries and is
matched with name normalization (write `tripo::Root` or `tripoRoot`, both
work):

```ts
retargetClips(hero.root, library, {
  boneMap: {
    "tripo::Spine_3": "clavicle_l",  // force a mapping
    "tripo::Head_2": "",             // remove one (bone keeps its bind pose)
  },
});
```

The pure planning helpers (`autoMapBones`, `resolveBoneMap`,
`normalizeBoneName`, `findHipBone`, `TRIPO_BONE_MAP`) are exported from the
zero-dependency core too, so tooling can inspect mappings without three.js.

### Babylon.js adapter

The optional Babylon adapter loads an `AssetContainer`, creates and places a
root mesh, merges requested Metaloot animation variants by node name, exposes
named `AnimationGroup`s and bounds, configures shadows, and owns cleanup:

```bash
npm install @metaloot/sdk @babylonjs/core @babylonjs/loaders
```

```ts
import { loadBabylonAsset } from "@metaloot/sdk/babylon";

const hero = await loadBabylonAsset("ember-mage", {
  scene,
  animations: "available",
  targetHeight: 1.8,
  receiveShadows: true,
  shadowGenerator,
  autoPlay: "idle",
});

hero.play("run");
hero.dispose();
```

The Babylon adapter mirrors the three.js `normalizeMaterials` option — pass
`normalizeMaterials: true` (or `{ maxMetalness, minRoughness,
materialOverrides }`) to make hosted PBR materials game-ready, and use the
standalone `normalizeBabylonMaterials(container.materials, opts)` with any
loaded container.

## Water

The optional `@metaloot/sdk/water` module is a stylized-water kit for
Three.js scenes: a shader material (animated waves, caustics, a shore foam
ring, sparkles, sky tint) plus the geometry builders that feed it — a river
ribbon along a centerline and a "pools" flood-fill that finds every lake in
a heightfield. The look is driven by a single float vertex attribute,
`aDepth` (0 at the shore → 1 at full depth), which both builders pack for
you:

```bash
npm install @metaloot/sdk three
```

```ts
import {
  buildPoolsGeometry,
  buildRibbonGeometry,
  createWaterSurface,
} from "@metaloot/sdk/water";

// A winding river: z = f(x) (or pass a parametric (u) => ({ x, z })).
const river = createWaterSurface(
  buildRibbonGeometry({
    centerline: (x) => Math.sin(x * 0.02) * 30,
    bounds: [-120, 120],
    halfWidth: 12,
  }),
);
river.group.position.y = WATER_LEVEL;
scene.add(river.group);

// Every lake below the waterline, sharing the river's material and clock —
// exclude the river channel, its own ribbon covers it.
const lakes = createWaterSurface(
  buildPoolsGeometry({
    heightAt: (x, z) => terrainHeight(x, z),
    waterLevel: WATER_LEVEL,
    bounds: { minX: -120, minZ: -120, maxX: 120, maxZ: 120 },
    exclude: (x, z) => isRiverChannel(x, z),
  }),
  { material: river.material },
);
lakes.group.position.y = WATER_LEVEL;
scene.add(lakes.group);

// In the render loop — one clock per material:
river.update(clock.getDelta());
```

Each surface is a `Group` of two meshes: the shader-driven top and a darker
translucent "under-tint" clone a little below it that sells depth (also
available standalone as `createUnderTint(geometry, { color, opacity,
offsetY })`, or skip it with `underTint: false`). Colors and opacity are
overridable — `createWaterSurface(geometry, { deep, shallow, foam, sky,
alphaMin, alphaMax })` — and the returned handle exposes `material`,
`uniforms`, `update(delta)`, and `dispose()`.

Builder details worth knowing:

- `buildRibbonGeometry` offsets the ribbon perpendicular to the local
  centerline tangent and packs `aDepth` = 1 at the channel centre fading to
  0 at the edges (`depthCurve` shapes the falloff). Front faces point +Y.
- `buildPoolsGeometry` scans a grid over `bounds` (`resolution` cells per
  axis) and keeps every quad with **any** submerged corner, so the surface
  overlaps the bank by one cell and the shader's foam ring lands on the
  shore. `aDepth` comes from real submersion depth (`depthScale` world units
  → 1), vertices are deduplicated, and an empty geometry comes back when
  nothing is below `waterLevel`.
- Both geometries are flat at y = 0 — position the mesh/group at the water
  level.

For custom pipelines, `createWaterMaterial(opts)` returns the bare
`ShaderMaterial` (drive `material.uniforms.uTime` yourself), and the GLSL
sources are exported as `WATER_VERTEX_SHADER` / `WATER_FRAGMENT_SHADER`.
Any geometry works with the material as long as it supplies the `aDepth`
attribute (`WATER_DEPTH_ATTRIBUTE`).

## Auth

Thin, typed browser helpers for the Metaloot auth endpoints every deployed
game has on its own origin (`/auth/metaloot/*`):

```ts
import { getSession, signIn, signOut } from "@metaloot/sdk/auth";

const session = await getSession(); // { signedIn: true, user, scope, expiresAt } | { signedIn: false }
if (!session.signedIn) signIn();    // full-page redirect, returns to the game
```

On Metaloot hosting these endpoints exist automatically (and a sign-in
widget is injected — opt out with
`<meta name="metaloot-auth-widget" content="off" />`).

**Self-hosting?** Mount the server adapters from
[`@metaloot/auth`](https://www.npmjs.com/package/@metaloot/auth) (Express,
Next.js, or any fetch-style server) to get the same endpoints, then use this
module unchanged — pass `{ basePath: "/api/auth/metaloot" }` if you mounted
them under a custom prefix.

## Multiplayer

A typed room client, protocol-compatible (v1) with the zero-install client
Metaloot hosting serves at `/__metaloot/multiplayer.js`. Rooms run on your
game's own origin at `wss://<slug>.metaloot.app/mp/rooms/<roomId>`; the
player's Metaloot session cookie authenticates the connection, so this works
in the browser on the deployed game.

```ts
import { joinRoom, MetalootAuthRequiredError } from "@metaloot/sdk/multiplayer";

try {
  const room = await joinRoom("lobby"); // ids: 1-64 chars of A-Za-z0-9 _ . ~ -
  room.self;                            // { connectionId, id, name, imageUrl }
  room.players;                         // other connections in the room
  room.on("join",    (player) => {});
  room.on("leave",   (player) => {});
  room.on("message", ({ from, data }) => {});
  room.send({ kind: "move", x: 3, y: 7 });   // relay to everyone else
  room.send(data, playerOrConnectionId);     // …or to one player
  room.setState("phase", "playing");         // shared key-value room state
  room.on("state",   ({ key, value, from }) => {});
  room.on("reconnect", ({ players, state }) => {}); // resync after auto-reconnect
  room.on("close",   ({ code, reason }) => {});
  room.leave();
} catch (error) {
  if (error instanceof MetalootAuthRequiredError) error.signIn();
}
```

Limits: 32 connections per room, 32 KB per JSON message, up to 256 state
keys; room state clears when the last player leaves. The relay is not an
authoritative server — send small semantic messages and use `setState` for
the few values every client must agree on. Full docs:
[metaloot.app/docs/multiplayer](https://metaloot.app/docs/multiplayer).

## For AI agents

The whole pipeline is scriptable end to end — generate assets with the CLI,
reference them by id in code, deploy:

```bash
export METALOOT_TOKEN="mtl_api_…" # scoped token from metaloot.app/settings/api-tokens

# 1. Generate a PUBLIC asset so the game can hot-link it (1-3 minutes).
metaloot assets generate --prompt "low-poly treasure chest, game-ready" \
  --name "Treasure Chest" --visibility public --wait --json \
  | sed -n '/^{/,$p' > asset.json
ASSET_ID=$(node -p "JSON.parse(require('fs').readFileSync('asset.json','utf8')).asset.id")
```

```ts
// 2. Reference it in game code — no file ships with the game.
import { loadThreeAsset } from "@metaloot/sdk/three";
await loadThreeAsset("<ASSET_ID>", { scene, targetHeight: 1.8, shadows: true });
```

```bash
# 3. Deploy. On <name>.metaloot.app the asset loads via the same-origin,
#    edge-cached proxy /__metaloot/assets/<ASSET_ID>.glb automatically.
metaloot deploy
```

Notes:

- Public assets hot-link without a token. A local game can load an owned
  private asset with a scoped `assets:read` token; download and ship the file
  before production so the credential never enters a deployed browser bundle.
- No SDK required for the simplest path: the hosted URL
  `https://studio.metaloot.app/api/assets/<id>/file` (or, on Metaloot
  hosting, `/__metaloot/assets/<id>.glb`) works directly with
  `GLTFLoader.load(...)`.
- Verify after deploy: fetch the asset URL from the deployed origin and
  confirm HTTP 200 with `Content-Type: model/gltf-binary`.

## Publishing

```bash
npm login
npm publish --access public
```

If the `@metaloot` npm scope is not available on your account, change the
package name in `package.json` before publishing.
