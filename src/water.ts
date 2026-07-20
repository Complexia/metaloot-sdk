import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  type ColorRepresentation,
} from "three";

/**
 * Name of the per-vertex float attribute every water geometry must carry:
 * 0 at the shore fading to 1 at full depth. The shader reads it for color,
 * alpha, wave damping, and the shore foam ring. {@link buildRibbonGeometry}
 * and {@link buildPoolsGeometry} pack it automatically.
 */
export const WATER_DEPTH_ATTRIBUTE = "aDepth";

/** Vertex shader source of the stylized water material. */
export const WATER_VERTEX_SHADER = /* glsl */ `
  attribute float aDepth; // 0 shore → 1 channel centre
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying float vDepth; // 0 shore → 1 channel centre

  void main() {
    vUv = uv;
    vDepth = aDepth;
    vec3 p = position;
    float w1 = sin(p.x * 0.11 + uTime * 1.25) * 0.11;
    float w2 = cos(p.z * 0.13 + uTime * 0.95) * 0.09;
    float w3 = sin((p.x + p.z) * 0.07 + uTime * 1.7) * 0.05;
    // quieter near the banks
    p.y += (w1 + w2 + w3) * mix(0.25, 1.0, vDepth);
    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/** Fragment shader source of the stylized water material. */
export const WATER_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uFoam;
  uniform vec3 uSky;
  uniform float uAlphaMin;
  uniform float uAlphaMax;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying float vDepth;

  // cheap value noise for foam / sparkle
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    // flowing caustic-ish pattern
    vec2 flow = vWorldPos.xz * 0.08 + vec2(uTime * 0.08, uTime * 0.045);
    float n1 = noise(flow);
    float n2 = noise(flow * 2.3 + 17.0 + uTime * 0.12);
    float caustic = n1 * 0.55 + n2 * 0.45;

    vec3 col = mix(uShallow, uDeep, vDepth);
    col = mix(col, col * 1.18, caustic * 0.35 * vDepth);

    // foam ring on the shore side of the depth gradient
    float edge = 1.0 - vDepth;
    float foamMask = smoothstep(0.15, 0.55, edge) * smoothstep(0.02, 0.25, vDepth);
    float foamNoise = noise(vWorldPos.xz * 0.45 + vec2(uTime * 0.35, -uTime * 0.22));
    float foam = foamMask * smoothstep(0.35, 0.75, foamNoise);
    col = mix(col, uFoam, foam * 0.85);

    // soft specular sparkles
    float spark = pow(noise(vWorldPos.xz * 1.6 + uTime * 0.6), 12.0);
    col += vec3(0.55, 0.75, 0.85) * spark * 0.45 * vDepth;

    // sky reflection tint
    col = mix(col, uSky, 0.12 + 0.18 * (1.0 - vDepth));

    float alpha = mix(uAlphaMin, uAlphaMax, vDepth) + foam * 0.15;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.92));
  }
`;

export type WaterMaterialOptions = {
  /** Water color at full depth (`aDepth` = 1). @default 0x1a5f7a */
  deep?: ColorRepresentation;
  /** Water color at the shore (`aDepth` = 0). @default 0x43a9d2 */
  shallow?: ColorRepresentation;
  /** Color of the shore foam ring. @default 0xd8f4ff */
  foam?: ColorRepresentation;
  /** Sky reflection tint blended over the surface. @default 0xa8d4f0 */
  sky?: ColorRepresentation;
  /** Surface opacity at the shore. @default 0.62 */
  alphaMin?: number;
  /** Surface opacity at full depth. @default 0.9 */
  alphaMax?: number;
};

export type WaterUniforms = {
  /** Animation clock in seconds. Advance it every frame to animate the water. */
  uTime: { value: number };
  uDeep: { value: Color };
  uShallow: { value: Color };
  uFoam: { value: Color };
  uSky: { value: Color };
  uAlphaMin: { value: number };
  uAlphaMax: { value: number };
};

export type WaterMaterial = ShaderMaterial & { uniforms: WaterUniforms };

/**
 * Builds the stylized water `ShaderMaterial`: animated waves, caustics, a
 * shore foam ring, sparkles, and a sky tint. Geometry rendered with it must
 * provide a float {@link WATER_DEPTH_ATTRIBUTE} (`aDepth`) attribute
 * (0 shore → 1 deep) — {@link buildRibbonGeometry} and
 * {@link buildPoolsGeometry} produce it. The material is transparent with
 * `depthWrite` off, so give water meshes a higher `renderOrder` than opaque
 * scenery. Drive `material.uniforms.uTime` per frame (or use the `update`
 * handle from {@link createWaterSurface}); sharing one material across
 * several surfaces keeps all water in the scene animating in sync.
 */
export function createWaterMaterial(options: WaterMaterialOptions = {}): WaterMaterial {
  const uniforms: WaterUniforms = {
    uTime: { value: 0 },
    uDeep: { value: new Color(options.deep ?? 0x1a5f7a) },
    uShallow: { value: new Color(options.shallow ?? 0x43a9d2) },
    uFoam: { value: new Color(options.foam ?? 0xd8f4ff) },
    uSky: { value: new Color(options.sky ?? 0xa8d4f0) },
    uAlphaMin: { value: options.alphaMin ?? 0.62 },
    uAlphaMax: { value: options.alphaMax ?? 0.9 },
  };
  return new ShaderMaterial({
    uniforms,
    vertexShader: WATER_VERTEX_SHADER,
    fragmentShader: WATER_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  }) as WaterMaterial;
}

/**
 * A river path in the XZ plane: either a parametric function of `u` ∈ [0, 1]
 * returning the centerline point, or the shorthand `z = f(x)` (pass the x
 * range via `bounds`).
 */
export type RibbonCenterline =
  | ((u: number) => { x: number; z: number })
  | ((x: number) => number);

export type RibbonGeometryOptions = {
  /** Centerline of the ribbon. See {@link RibbonCenterline}. */
  centerline: RibbonCenterline;
  /** Half the ribbon width in world units, centerline to outer edge. */
  halfWidth: number;
  /** `[minX, maxX]` sampling range. Required for the `z = f(x)` centerline form. */
  bounds?: readonly [number, number];
  /** Segments along the centerline. @default 160 */
  segments?: number;
  /** Segments across the channel. @default 28 */
  widthSegments?: number;
  /** Exponent shaping the centre→edge depth falloff. @default 1.35 */
  depthCurve?: number;
};

/**
 * Builds a flat river-ribbon `BufferGeometry` (in the XZ plane, y = 0) along
 * a centerline, with the {@link WATER_DEPTH_ATTRIBUTE} attribute packed as
 * 1 at the channel centre fading to 0 at the outer edges. The ribbon is
 * offset perpendicular to the local centerline tangent, UVs run 0→1 along
 * (`u`) and across (`v`), and triangles wind counter-clockwise seen from
 * above, so front faces point +Y. Position the mesh at the water level
 * yourself. Pairs with {@link createWaterMaterial}.
 */
export function buildRibbonGeometry(options: RibbonGeometryOptions): BufferGeometry {
  const segments = options.segments ?? 160;
  const widthSegments = options.widthSegments ?? 28;
  const depthCurve = options.depthCurve ?? 1.35;
  const sample = resolveCenterline(options);

  const positions: number[] = [];
  const depths: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const epsilon = 1 / Math.max(segments, 1) / 2;
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const centre = sample(u);
    // Local tangent by central differences (one-sided at the ends), and its
    // left perpendicular — the across-channel direction.
    const ahead = sample(Math.min(1, u + epsilon));
    const behind = sample(Math.max(0, u - epsilon));
    let tx = ahead.x - behind.x;
    let tz = ahead.z - behind.z;
    const tangentLength = Math.hypot(tx, tz);
    if (tangentLength > 1e-8) {
      tx /= tangentLength;
      tz /= tangentLength;
    } else {
      tx = 1;
      tz = 0;
    }
    for (let j = 0; j <= widthSegments; j++) {
      const v = j / widthSegments; // 0..1 across the channel
      const lateral = (v - 0.5) * 2 * options.halfWidth;
      // depth factor: 1 at centre, 0 at the outer edges
      const depth = Math.pow(1 - Math.abs(v - 0.5) * 2, depthCurve);
      positions.push(centre.x - tz * lateral, 0, centre.z + tx * lateral);
      depths.push(depth);
      uvs.push(u, v);
    }
  }

  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < widthSegments; j++) {
      const a = i * (widthSegments + 1) + j;
      const b = a + widthSegments + 1;
      // CCW seen from above → front faces point +Y
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }

  return assembleWaterGeometry(positions, depths, uvs, indices);
}

export type PoolsGeometryOptions = {
  /** Terrain heightfield sampled over `bounds`. */
  heightAt: (x: number, z: number) => number;
  /** World-space y of the water surface the terrain is compared against. */
  waterLevel: number;
  /** XZ rectangle to scan for submerged terrain. */
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  /** Grid cells per axis. @default 200 */
  resolution?: number;
  /** Skip grid cells whose any corner matches (e.g. a river channel already covered by a ribbon). */
  exclude?: (x: number, z: number) => boolean;
  /** Submersion depth in world units mapped to `aDepth` = 1. @default 2 */
  depthScale?: number;
  /** Exponent shaping the packed depth. @default 0.85 */
  depthCurve?: number;
};

/**
 * Builds one flat `BufferGeometry` (in the XZ plane, y = 0) covering every
 * depression of a heightfield below `waterLevel` — lakes and ponds found by
 * scanning a grid over `bounds`. A grid quad is included when **any** corner
 * is submerged, so the surface overlaps the bank by one cell and the
 * shader's foam ring lands on the shore. Real submersion depth is packed
 * into {@link WATER_DEPTH_ATTRIBUTE} (normalized by `depthScale`, shaped by
 * `depthCurve`; dry overlap vertices get 0), vertices shared between quads
 * are deduplicated, and front faces point +Y. Returns an empty geometry
 * (zero vertices) when nothing is submerged. Position the mesh at
 * `waterLevel` yourself. Pairs with {@link createWaterMaterial}.
 */
export function buildPoolsGeometry(options: PoolsGeometryOptions): BufferGeometry {
  const resolution = options.resolution ?? 200;
  const depthScale = options.depthScale ?? 2;
  const depthCurve = options.depthCurve ?? 0.85;
  const { minX, minZ, maxX, maxZ } = options.bounds;
  const stepX = (maxX - minX) / resolution;
  const stepZ = (maxZ - minZ) / resolution;
  const stride = resolution + 1;

  // submersion (>0 → terrain under water) and exclusion mask per grid vertex
  const depth = new Float32Array(stride * stride);
  const excluded = new Uint8Array(stride * stride);
  for (let iz = 0; iz <= resolution; iz++) {
    for (let ix = 0; ix <= resolution; ix++) {
      const x = minX + ix * stepX;
      const z = minZ + iz * stepZ;
      const i = iz * stride + ix;
      depth[i] = options.waterLevel - options.heightAt(x, z);
      excluded[i] = options.exclude?.(x, z) ? 1 : 0;
    }
  }

  const positions: number[] = [];
  const depths: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const remap = new Int32Array(stride * stride).fill(-1);

  const vertexFor = (ix: number, iz: number): number => {
    const i = iz * stride + ix;
    if (remap[i] === -1) {
      remap[i] = positions.length / 3;
      positions.push(minX + ix * stepX, 0, minZ + iz * stepZ);
      depths.push(Math.pow(Math.min(1, Math.max(0, depth[i] / depthScale)), depthCurve));
      uvs.push(ix / resolution, iz / resolution);
    }
    return remap[i];
  };

  for (let iz = 0; iz < resolution; iz++) {
    for (let ix = 0; ix < resolution; ix++) {
      const i00 = iz * stride + ix;
      const i10 = i00 + 1;
      const i01 = i00 + stride;
      const i11 = i01 + 1;
      // include a quad if any corner is submerged, so the surface overlaps
      // the bank by one cell and the shader's foam ring lands on the shore
      if (depth[i00] <= 0 && depth[i10] <= 0 && depth[i01] <= 0 && depth[i11] <= 0) continue;
      if (excluded[i00] || excluded[i10] || excluded[i01] || excluded[i11]) continue;
      const a = vertexFor(ix, iz);
      const b = vertexFor(ix, iz + 1);
      const c = vertexFor(ix + 1, iz);
      const d = vertexFor(ix + 1, iz + 1);
      // CCW seen from above → front faces point +Y
      indices.push(a, b, c, b, d, c);
    }
  }

  return assembleWaterGeometry(positions, depths, uvs, indices);
}

export type UnderTintOptions = {
  /** Tint color. @default 0x0e3a4a */
  color?: ColorRepresentation;
  /** Tint opacity. @default 0.35 */
  opacity?: number;
  /** Vertical offset below the water surface. @default -0.35 */
  offsetY?: number;
};

/**
 * Builds the darker "under-tint" companion mesh that sells depth: the same
 * geometry rendered a little below the surface with a flat translucent
 * `MeshBasicMaterial`. Add it wherever the water mesh goes (it shares the
 * geometry, offset on its own `position.y`) and keep its `renderOrder` below
 * the surface's — the mesh comes back with `renderOrder` 0 to pair with the
 * surface's 1.
 */
export function createUnderTint(geometry: BufferGeometry, options: UnderTintOptions = {}): Mesh {
  const mesh = new Mesh(
    geometry,
    new MeshBasicMaterial({
      color: options.color ?? 0x0e3a4a,
      transparent: true,
      opacity: options.opacity ?? 0.35,
      depthWrite: false,
    }),
  );
  mesh.position.y = options.offsetY ?? -0.35;
  mesh.renderOrder = 0;
  return mesh;
}

export type WaterSurfaceOptions = WaterMaterialOptions & {
  /**
   * Reuse an existing water material (from {@link createWaterMaterial} or
   * another surface) so several surfaces share one shader program and one
   * `uTime` clock. When set, the {@link WaterMaterialOptions} colors/alphas
   * are ignored and `dispose()` leaves the material alone.
   */
  material?: WaterMaterial;
  /** Under-tint options, or `false` to skip the under-tint mesh. @default true */
  underTint?: boolean | UnderTintOptions;
};

export type WaterSurface = {
  /** Add this to the scene, positioned at the water level. */
  group: Group;
  /** The shader-driven surface mesh (`renderOrder` 1). */
  surface: Mesh;
  /** The darker under-tint mesh (`renderOrder` 0), or null when disabled. */
  underTint: Mesh | null;
  material: WaterMaterial;
  uniforms: WaterUniforms;
  /** Advances the water clock (`uTime`). Call once per frame per material. */
  update(deltaSeconds: number): void;
  dispose(): void;
};

/**
 * Wraps a water geometry into a ready-to-add `Group`: the animated surface
 * mesh plus the depth-selling under-tint mesh. Position the group at the
 * water level and call `update(delta)` in the render loop:
 *
 * ```ts
 * const river = createWaterSurface(buildRibbonGeometry({ ... }));
 * river.group.position.y = WATER_LEVEL;
 * scene.add(river.group);
 * // per frame: river.update(delta);
 * ```
 *
 * Pass `material` to share one water material (and clock) across several
 * surfaces — then advance the clock once per frame via any one handle.
 */
export function createWaterSurface(
  geometry: BufferGeometry,
  options: WaterSurfaceOptions = {},
): WaterSurface {
  const ownsMaterial = !options.material;
  const material = options.material ?? createWaterMaterial(options);

  const surface = new Mesh(geometry, material);
  surface.renderOrder = 1;

  const underTint = options.underTint === false
    ? null
    : createUnderTint(geometry, options.underTint === true ? {} : options.underTint);

  const group = new Group();
  if (underTint) group.add(underTint);
  group.add(surface);

  return {
    group,
    surface,
    underTint,
    material,
    uniforms: material.uniforms,
    update(deltaSeconds) {
      material.uniforms.uTime.value += deltaSeconds;
    },
    dispose() {
      group.removeFromParent();
      geometry.dispose();
      if (ownsMaterial) material.dispose();
      (underTint?.material as MeshBasicMaterial | undefined)?.dispose();
    },
  };
}

function resolveCenterline(options: RibbonGeometryOptions): (u: number) => { x: number; z: number } {
  const { centerline, bounds } = options;
  const probe = centerline(bounds ? bounds[0] : 0);
  if (typeof probe === "number") {
    if (!bounds) {
      throw new Error(
        "buildRibbonGeometry: the z = f(x) centerline form needs `bounds: [minX, maxX]`.",
      );
    }
    const zOfX = centerline as (x: number) => number;
    const [minX, maxX] = bounds;
    return (u) => {
      const x = minX + u * (maxX - minX);
      return { x, z: zOfX(x) };
    };
  }
  return centerline as (u: number) => { x: number; z: number };
}

function assembleWaterGeometry(
  positions: number[],
  depths: number[],
  uvs: number[],
  indices: number[],
): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute(WATER_DEPTH_ATTRIBUTE, new Float32BufferAttribute(depths, 1));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
