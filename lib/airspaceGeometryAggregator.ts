/**
 * Airspace geometry aggregation (AIXM-style) using component operations:
 * BASE, UNION, SUBTR, INTERS.
 *
 * This module focuses on 2D (horizontal) boolean operations on MultiPolygon geometries in EPSG:4326.
 * Vertical limits are carried forward only when identical across all component volumes; otherwise a warning is returned.
 *
 * Boolean ops require a polygon clipping library. We attempt to load `polygon-clipping` dynamically.
 * If it is not installed, functions will throw with a clear message.
 */

import type { Feature, FeatureCollection, GeoJsonProperties } from "geojson";

export type Coord = [number, number]; // [lon, lat]
export type Ring = Coord[]; // closed ring
export type Polygon = Ring[]; // [exterior, ...holes]
export type MultiPolygon = Polygon[];

export type VolumeGeometry = {
  horizontal: MultiPolygon;
  lowerFt?: number;
  lowerRef?: string;
  upperFt?: number;
  upperRef?: string;
};

export type AirspaceVolume = {
  id: string;
  geometry?: VolumeGeometry;
  derivedFromAirspaceId?: string;
  vertical?: Pick<VolumeGeometry, "lowerFt" | "lowerRef" | "upperFt" | "upperRef">;
};

export type AirspaceGeometryComponent = {
  volumeId: string;
  operation: "BASE" | "UNION" | "SUBTR" | "INTERS";
  operationSequence: number;
};

export type Airspace = {
  id: string;
  designator: string;
  name: string;
  components: AirspaceGeometryComponent[];
};

type AggregationResult = {
  geometry: MultiPolygon;
  warnings: string[];
  vertical?: Pick<VolumeGeometry, "lowerFt" | "lowerRef" | "upperFt" | "upperRef">;
};

type ResolveContext = {
  visitingAirspaces: Set<string>;
  visitingVolumes: Set<string>;
  cacheAirspaceGeom: Map<string, AggregationResult>;
  cacheVolumeGeom: Map<string, VolumeGeometry>;
};

const createContext = (): ResolveContext => ({
  visitingAirspaces: new Set(),
  visitingVolumes: new Set(),
  cacheAirspaceGeom: new Map(),
  cacheVolumeGeom: new Map(),
});

const cloneCoord = (c: Coord): Coord => [c[0], c[1]];

const isSameCoord = (a: Coord, b: Coord) => a[0] === b[0] && a[1] === b[1];

/**
 * Remove consecutive duplicate points and ensure rings are closed.
 */
export const normalizeRing = (ring: Ring): Ring => {
  const cleaned: Ring = [];
  for (const pt of ring) {
    if (!cleaned.length || !isSameCoord(cleaned[cleaned.length - 1], pt)) cleaned.push(cloneCoord(pt));
  }
  if (cleaned.length === 0) return cleaned;
  if (!isSameCoord(cleaned[0], cleaned[cleaned.length - 1])) cleaned.push(cloneCoord(cleaned[0]));
  return cleaned;
};

export const normalizeMultiPolygon = (mp: MultiPolygon): MultiPolygon => {
  const out: MultiPolygon = [];
  for (const poly of mp) {
    const rings: Polygon = [];
    for (const ring of poly) {
      const r = normalizeRing(ring);
      if (r.length >= 4) rings.push(r);
    }
    if (rings.length) out.push(rings);
  }
  return out;
};

const isVerticalEqual = (
  a: Pick<VolumeGeometry, "lowerFt" | "lowerRef" | "upperFt" | "upperRef">,
  b: Pick<VolumeGeometry, "lowerFt" | "lowerRef" | "upperFt" | "upperRef">
) =>
  a.lowerFt === b.lowerFt &&
  a.upperFt === b.upperFt &&
  (a.lowerRef ?? "") === (b.lowerRef ?? "") &&
  (a.upperRef ?? "") === (b.upperRef ?? "");

const stripVertical = (g: VolumeGeometry) => ({
  lowerFt: g.lowerFt,
  lowerRef: g.lowerRef,
  upperFt: g.upperFt,
  upperRef: g.upperRef,
});

const isEmptyMultiPolygon = (mp: MultiPolygon) => mp.length === 0;

/**
 * polygon-clipping returns coordinates in the same MultiPolygon shape:
 * MultiPolygon: [ Polygon, Polygon, ... ]
 * Polygon: [ Ring, Ring, ... ]
 * Ring: [ [x,y], ... ]
 */
type PolygonClipping = {
  union: (...args: any[]) => any;
  intersection: (...args: any[]) => any;
  difference: (...args: any[]) => any;
};

let polygonClippingPromise: Promise<PolygonClipping> | null = null;
const getPolygonClipping = async (): Promise<PolygonClipping> => {
  if (!polygonClippingPromise) {
    polygonClippingPromise = import("polygon-clipping")
      .then((m: any) => (m?.default ? m.default : m))
      .catch(() => {
        throw new Error(
          "Missing dependency: polygon-clipping. Install it with `npm i polygon-clipping` to enable UNION/SUBTR/INTERS."
        );
      });
  }
  return polygonClippingPromise;
};

const toPc = (mp: MultiPolygon) => mp;
const fromPc = (value: any): MultiPolygon => normalizeMultiPolygon((value ?? []) as MultiPolygon);

export const union = async (a: MultiPolygon, b: MultiPolygon): Promise<MultiPolygon> => {
  const pc = await getPolygonClipping();
  return fromPc(pc.union(toPc(a), toPc(b)));
};

export const difference = async (a: MultiPolygon, b: MultiPolygon): Promise<MultiPolygon> => {
  const pc = await getPolygonClipping();
  return fromPc(pc.difference(toPc(a), toPc(b)));
};

export const intersection = async (a: MultiPolygon, b: MultiPolygon): Promise<MultiPolygon> => {
  const pc = await getPolygonClipping();
  return fromPc(pc.intersection(toPc(a), toPc(b)));
};

/**
 * Resolve a volume's geometry.
 * - If volume.geometry exists: return it.
 * - If derivedFromAirspaceId exists: compute that contributor airspace recursively, and use its horizontal geometry.
 *
 * Cycle prevention:
 * - Track visiting volumes and airspaces; throw clear error on cycles.
 */
export async function resolveVolumeGeometry(
  volume: AirspaceVolume,
  airspacesById: Map<string, Airspace>,
  volumesById: Map<string, AirspaceVolume>,
  ctx: ResolveContext = createContext()
): Promise<VolumeGeometry> {
  if (ctx.cacheVolumeGeom.has(volume.id)) return ctx.cacheVolumeGeom.get(volume.id)!;
  if (ctx.visitingVolumes.has(volume.id)) {
    throw new Error(`Cycle detected while resolving volume geometry: volume=${volume.id}`);
  }
  ctx.visitingVolumes.add(volume.id);

  try {
    const localVertical = volume.vertical ?? {
      lowerFt: volume.geometry?.lowerFt,
      lowerRef: volume.geometry?.lowerRef,
      upperFt: volume.geometry?.upperFt,
      upperRef: volume.geometry?.upperRef,
    };

    if (volume.geometry) {
      const normalized: VolumeGeometry = {
        ...volume.geometry,
        horizontal: normalizeMultiPolygon(volume.geometry.horizontal),
        ...localVertical,
      };
      ctx.cacheVolumeGeom.set(volume.id, normalized);
      return normalized;
    }

    if (volume.derivedFromAirspaceId) {
      const contributor = airspacesById.get(volume.derivedFromAirspaceId);
      if (!contributor) {
        throw new Error(`Derived volume=${volume.id} references missing airspace=${volume.derivedFromAirspaceId}`);
      }
      const agg = await computeAirspaceAggregatedGeometry(contributor, volumesById, airspacesById, ctx);
      const derivedGeom: VolumeGeometry = {
        horizontal: normalizeMultiPolygon(agg.geometry),
        ...(localVertical ?? agg.vertical ?? {}),
      };
      ctx.cacheVolumeGeom.set(volume.id, derivedGeom);
      return derivedGeom;
    }

    throw new Error(`Volume geometry missing: volume=${volume.id} has no geometry and is not derived`);
  } finally {
    ctx.visitingVolumes.delete(volume.id);
  }
}

/**
 * Compute aggregated airspace geometry by applying component operations in sequence.
 *
 * Execution rules:
 * 1) Sort by operationSequence ascending.
 * 2) First must be BASE and operationSequence=1.
 * 3) Apply UNION/SUBTR/INTERS in order.
 */
export async function computeAirspaceAggregatedGeometry(
  airspace: Airspace,
  volumesById: Map<string, AirspaceVolume>,
  airspacesById: Map<string, Airspace>,
  ctx: ResolveContext = createContext()
): Promise<AggregationResult> {
  if (ctx.cacheAirspaceGeom.has(airspace.id)) return ctx.cacheAirspaceGeom.get(airspace.id)!;
  if (ctx.visitingAirspaces.has(airspace.id)) {
    throw new Error(`Cycle detected while resolving airspace geometry: airspace=${airspace.id}`);
  }
  ctx.visitingAirspaces.add(airspace.id);

  try {
    const warnings: string[] = [];
    let components = [...airspace.components].sort((a, b) => a.operationSequence - b.operationSequence);

    // Some AIXM datasets omit operation/operationSequence for contributor airspaces and provide
    // only raw geometry components. In that case, `airspace.components` can be empty even though
    // the parsed volumes exist in `volumesById` (we key those as `${airspaceId}:${seq}`).
    // To allow derived volumes to resolve, fall back to a synthetic BASE/UNION chain using the
    // available volumes in sequence order.
    if (!components.length) {
      const prefix = `${airspace.id}:`;
      const candidates = [...volumesById.values()]
        .filter((v) => typeof v.id === "string" && v.id.startsWith(prefix))
        .map((v) => {
          const seqRaw = v.id.slice(prefix.length);
          const seq = Number(seqRaw);
          return { volumeId: v.id, seq: Number.isFinite(seq) ? seq : null };
        })
        .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

      if (!candidates.length) throw new Error(`No geometry components for airspace=${airspace.id}`);

      warnings.push(
        `No operation data for airspace=${airspace.id}; assuming BASE then UNION in volume sequence order.`
      );
      components = candidates.map((c, idx) => ({
        volumeId: c.volumeId,
        operation: idx === 0 ? "BASE" : "UNION",
        operationSequence: idx + 1,
      }));
    }
    const first = components[0];
    if (first.operation !== "BASE" || first.operationSequence !== 1) {
      throw new Error(
        `Invalid component sequence for airspace=${airspace.id}: first must be BASE with operationSequence=1`
      );
    }

    const getVolume = (id: string) => {
      const v = volumesById.get(id);
      if (!v) throw new Error(`Missing volume=${id} referenced by airspace=${airspace.id}`);
      return v;
    };

    // Resolve all component geometries (needed for vertical limit comparison too).
    const resolved = await Promise.all(
      components.map(async (c) => ({
        component: c,
        geometry: await resolveVolumeGeometry(getVolume(c.volumeId), airspacesById, volumesById, ctx),
      }))
    );

    // Vertical limits: keep only if identical across all components.
    const vertical0 = stripVertical(resolved[0].geometry);
    const verticalAllSame = resolved.every((r) => isVerticalEqual(vertical0, stripVertical(r.geometry)));
    const vertical = verticalAllSame ? vertical0 : undefined;
    if (!verticalAllSame) {
      warnings.push("Vertical limits differ between components; manual review needed.");
    }

    let result = normalizeMultiPolygon(resolved[0].geometry.horizontal);

    for (let i = 1; i < resolved.length; i++) {
      const { component, geometry } = resolved[i];
      const geom2 = normalizeMultiPolygon(geometry.horizontal);

      if (component.operation === "UNION") {
        result = await union(result, geom2);
      } else if (component.operation === "SUBTR") {
        result = await difference(result, geom2);
      } else if (component.operation === "INTERS") {
        result = await intersection(result, geom2);
      } else if (component.operation === "BASE") {
        throw new Error(`Unexpected BASE after first component: airspace=${airspace.id} seq=${component.operationSequence}`);
      }

      if (isEmptyMultiPolygon(result)) {
        warnings.push(`Geometry result became empty after ${component.operation} at sequence ${component.operationSequence}.`);
      }
    }

    const out: AggregationResult = { geometry: result, warnings, vertical };
    ctx.cacheAirspaceGeom.set(airspace.id, out);
    return out;
  } finally {
    ctx.visitingAirspaces.delete(airspace.id);
  }
}

export const toFeatureCollection = (
  airspace: Airspace,
  geometry: MultiPolygon,
  warnings: string[]
): FeatureCollection => {
  const feature: Feature = {
    type: "Feature",
    geometry: {
      type: geometry.length === 1 ? "Polygon" : "MultiPolygon",
      coordinates: geometry.length === 1 ? geometry[0] : geometry,
    } as any,
    properties: {
      id: airspace.id,
      designator: airspace.designator,
      name: airspace.name,
      warnings: warnings.length ? warnings : undefined,
    } as GeoJsonProperties,
  };
  return { type: "FeatureCollection", features: [feature] };
};

// ---- Demo ----
// Run with: `node -e "import('./lib/airspaceGeometryAggregator.ts').then(m=>m.demo())"`
export async function demo() {
  const squareA: MultiPolygon = [
    [
      [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
        [0, 0],
      ],
    ],
  ];
  const squareB: MultiPolygon = [
    [
      [
        [1, 1],
        [3, 1],
        [3, 3],
        [1, 3],
        [1, 1],
      ],
    ],
  ];

  const volumes = new Map<string, AirspaceVolume>([
    ["v1", { id: "v1", geometry: { horizontal: squareA, lowerFt: 0, lowerRef: "SFC", upperFt: 3000, upperRef: "MSL" } }],
    ["v2", { id: "v2", geometry: { horizontal: squareB, lowerFt: 0, lowerRef: "SFC", upperFt: 3000, upperRef: "MSL" } }],
  ]);

  const makeAirspace = (id: string, components: AirspaceGeometryComponent[]): Airspace => ({
    id,
    designator: id,
    name: id,
    components,
  });

  const airspaces = new Map<string, Airspace>();
  const unionAirspace = makeAirspace("A3_UNION", [
    { volumeId: "v1", operation: "BASE", operationSequence: 1 },
    { volumeId: "v2", operation: "UNION", operationSequence: 2 },
  ]);
  const subtrAirspace = makeAirspace("A3_SUBTR", [
    { volumeId: "v1", operation: "BASE", operationSequence: 1 },
    { volumeId: "v2", operation: "SUBTR", operationSequence: 2 },
  ]);
  const intersAirspace = makeAirspace("A3_INTERS", [
    { volumeId: "v1", operation: "BASE", operationSequence: 1 },
    { volumeId: "v2", operation: "INTERS", operationSequence: 2 },
  ]);
  const subtrReversed = makeAirspace("A3_SUBTR_REVERSED", [
    { volumeId: "v2", operation: "BASE", operationSequence: 1 },
    { volumeId: "v1", operation: "SUBTR", operationSequence: 2 },
  ]);

  [unionAirspace, subtrAirspace, intersAirspace, subtrReversed].forEach((a) => airspaces.set(a.id, a));

  const run = async (a: Airspace) => {
    const { geometry, warnings } = await computeAirspaceAggregatedGeometry(a, volumes, airspaces);
    const fc = toFeatureCollection(a, geometry, warnings);
     
    console.log(`\n--- ${a.id} ---\n${JSON.stringify(fc, null, 2)}`);
  };

  await run(unionAirspace);
  await run(subtrAirspace);
  await run(intersAirspace);
  // Demonstrates order dependence for SUBTR:
  await run(subtrReversed);
}
