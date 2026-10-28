// Emergency points of interest from OpenStreetMap: which tags count, how they
// group into the categories of the Emergencias sheet, the Overpass query that
// fetches them for a region while online, and parsing its TSV answer.
// Pure TypeScript (no `@/` aliases) so node's test runner loads it.

export const EMERGENCY_CATEGORIES = ['health', 'security', 'water', 'supplies', 'official'] as const;
export type EmergencyCategory = (typeof EMERGENCY_CATEGORIES)[number];

/** App-level kinds: each has an icon and a label (maps:kind.<kind>). */
export const EMERGENCY_KINDS = {
  hospital: 'health',
  clinic: 'health',
  pharmacy: 'health',
  defibrillator: 'health',
  ambulance_station: 'health',
  police: 'security',
  fire_station: 'security',
  military: 'security',
  drinking_water: 'water',
  spring: 'water',
  shelter: 'water',
  assembly_point: 'water',
  fuel: 'supplies',
  supermarket: 'supplies',
  hardware: 'supplies',
  townhall: 'official',
  embassy: 'official',
} as const satisfies Record<string, EmergencyCategory>;
export type EmergencyKind = keyof typeof EMERGENCY_KINDS;

export type OsmTags = Record<string, string | undefined>;

/** Maps an OSM element's tags to an emergency kind, or null when it is not one. */
export function emergencyKind(tags: OsmTags): EmergencyKind | null {
  const { amenity, healthcare, emergency, military, natural, shop, office } = tags;
  if (amenity === 'hospital' || healthcare === 'hospital') return 'hospital';
  if (emergency === 'ambulance_station') return 'ambulance_station';
  if (emergency === 'defibrillator') return 'defibrillator';
  if (amenity === 'police') return 'police';
  if (amenity === 'fire_station') return 'fire_station';
  if (military === 'barracks' || military === 'base') return 'military';
  if (amenity === 'pharmacy') return 'pharmacy';
  if (amenity === 'clinic' || amenity === 'doctors' || healthcare === 'centre' || healthcare === 'clinic') return 'clinic';
  if (amenity === 'drinking_water' || amenity === 'water_point') return 'drinking_water';
  if (natural === 'spring') return 'spring';
  if (emergency === 'assembly_point') return 'assembly_point';
  if (amenity === 'shelter') return 'shelter';
  if (amenity === 'fuel') return 'fuel';
  if (shop === 'supermarket') return 'supermarket';
  if (shop === 'hardware' || shop === 'doityourself') return 'hardware';
  if (amenity === 'townhall') return 'townhall';
  if (amenity === 'embassy' || office === 'diplomatic') return 'embassy';
  return null;
}

/**
 * Emergency kind of a Protomaps POI (its `kind` is the OSM amenity/shop/… value).
 * The offline fallback when Overpass could not be reached: z15 tiles carry them.
 */
export function tileEmergencyKind(kind: string): EmergencyKind | null {
  if (kind === 'military') return 'military';
  return emergencyKind({ amenity: kind, shop: kind, emergency: kind, natural: kind });
}

export function kindCategory(kind: EmergencyKind): EmergencyCategory {
  return EMERGENCY_KINDS[kind];
}

/** Tags requested from Overpass, in TSV column order after type, id, lat, lon. */
export const OVERPASS_TAGS = [
  'amenity',
  'healthcare',
  'emergency',
  'military',
  'natural',
  'shop',
  'office',
  'name',
  'operator',
  'phone',
  'contact:phone',
  'opening_hours',
  'drinking_water',
] as const;

/** Overpass bbox order is south, west, north, east. */
export function overpassQuery(bbox: [number, number, number, number], timeoutSeconds = 180): string {
  const [w, s, e, n] = bbox.map((v) => Number(v.toFixed(5)));
  const columns = ['::type', '::id', '::lat', '::lon', ...OVERPASS_TAGS.map((t) => (t.includes(':') ? `"${t}"` : t))].join(',');
  return [
    `[out:csv(${columns};false;"\\t")][timeout:${timeoutSeconds}][bbox:${s},${w},${n},${e}];`,
    '(',
    '  nwr["amenity"~"^(hospital|clinic|doctors|pharmacy|police|fire_station|drinking_water|water_point|shelter|fuel|townhall|embassy)$"];',
    '  nwr["healthcare"~"^(hospital|centre|clinic)$"];',
    '  nwr["emergency"~"^(ambulance_station|defibrillator|assembly_point)$"];',
    '  nwr["military"~"^(barracks|base)$"];',
    '  nwr["natural"="spring"];',
    '  nwr["shop"~"^(supermarket|hardware|doityourself)$"];',
    '  nwr["office"="diplomatic"];',
    ');',
    'out center;',
  ].join('\n');
}

export type EmergencyPoi = {
  /** 'n123', 'w456' or 'r789'. */
  osmId: string;
  kind: EmergencyKind;
  name: string | null;
  operator: string | null;
  phone: string | null;
  openingHours: string | null;
  /** Hospitals and clinics: 1 = has an emergency department, 0 = says it has none, null = unknown. */
  emergency: 0 | 1 | null;
  lat: number;
  lon: number;
};

const TYPE_PREFIX: Record<string, string> = { node: 'n', way: 'w', relation: 'r' };

/** Overpass CSV quotes values that contain quotes: "Acuartelamiento ""Capitán…""". */
function unquote(v: string): string {
  return v.length >= 2 && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replace(/""/g, '"') : v;
}

/** Parses Overpass TSV (columns as in overpassQuery). Unknown kinds and bad rows are dropped. */
export function parseOverpassTsv(text: string): EmergencyPoi[] {
  const out: EmergencyPoi[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const cols = line.split('\t');
    if (cols.length < 4 + OVERPASS_TAGS.length) continue;
    const prefix = TYPE_PREFIX[cols[0]];
    const lat = Number(cols[2]);
    const lon = Number(cols[3]);
    if (!prefix || !cols[1] || !cols[2] || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const tags: OsmTags = {};
    OVERPASS_TAGS.forEach((t, i) => {
      const v = cols[4 + i]?.trim();
      if (v) tags[t] = unquote(v);
    });
    // Water points tagged as not drinkable are not water sources for people.
    if (tags.drinking_water === 'no' && tags.amenity === 'water_point') continue;
    const kind = emergencyKind(tags);
    if (!kind) continue;
    out.push({
      osmId: prefix + cols[1],
      kind,
      name: tags.name ?? null,
      operator: tags.operator ?? null,
      phone: tags.phone ?? tags['contact:phone'] ?? null,
      openingHours: tags.opening_hours ?? null,
      emergency: kind === 'hospital' || kind === 'clinic' ? (tags.emergency === 'yes' ? 1 : tags.emergency === 'no' ? 0 : null) : null,
      lat,
      lon,
    });
  }
  return out;
}

/**
 * Splits a bbox into cells of at most `maxDegrees` per side. Country-sized
 * queries time out on public Overpass servers; a few medium ones do not.
 */
export function splitBBox(bbox: [number, number, number, number], maxDegrees = 3): [number, number, number, number][] {
  const [w, s, e, n] = bbox;
  const cols = Math.max(1, Math.ceil((e - w) / maxDegrees));
  const rows = Math.max(1, Math.ceil((n - s) / maxDegrees));
  const cells: [number, number, number, number][] = [];
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      cells.push([w + ((e - w) * i) / cols, s + ((n - s) * j) / rows, w + ((e - w) * (i + 1)) / cols, s + ((n - s) * (j + 1)) / rows]);
    }
  return cells;
}

/**
 * Police forces worth telling apart in Spain (the operator tag is free text):
 * returns a short label key, or null to show the operator as written.
 */
export function policeForce(operator: string | null): 'guardiaCivil' | 'nacional' | 'local' | 'autonomica' | null {
  if (!operator) return null;
  const o = operator.toLowerCase();
  if (o.includes('guardia civil')) return 'guardiaCivil';
  if (o.includes('nacional')) return 'nacional';
  if (/mossos|ertzaintza|foral|policia canaria|policía canaria/.test(o)) return 'autonomica';
  if (/local|municipal|urbana/.test(o)) return 'local';
  return null;
}

/** Kinds that must never be crowded out of a category's list by closer, more common ones (R2). */
export const PRIORITY_KINDS: Partial<Record<EmergencyCategory, readonly EmergencyKind[]>> = {
  health: ['hospital'],
  security: ['police', 'fire_station'],
};
/** How many of each priority kind lead the list (few: a defibrillator 30 m away must stay near the top). */
export const PRIORITY_LIMIT = 3;

/**
 * Nearest-first list where the priority places (already nearest-first) come ahead of the rest,
 * without duplicates: 40 pharmacies closer than the nearest hospital must not hide it.
 */
export function mergePriority<T extends { osmId: string }>(priority: readonly T[], rest: readonly T[], limit: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of [...priority, ...rest]) {
    if (seen.has(p.osmId)) continue;
    seen.add(p.osmId);
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

/** Kinds drawn at every zoom on the map. */
const ALWAYS_SHOWN = new Set<EmergencyKind>(['hospital', 'police', 'fire_station', 'ambulance_station']);
/** From this zoom on every point is drawn (streets are wide enough). */
export const THIN_UNTIL_ZOOM = 17;
const CELL_PIXELS = 48;

/**
 * Thins map points by zoom so dots don't cover the streets: key kinds always stay; the others keep
 * one point per kind per ~48 px grid cell below THIN_UNTIL_ZOOM. Input order is kept (first wins).
 */
export function thinForZoom<T extends { kind: EmergencyKind; lat: number; lon: number }>(places: readonly T[], zoom: number): T[] {
  if (zoom >= THIN_UNTIL_ZOOM) return [...places];
  const cell = (360 / (256 * 2 ** zoom)) * CELL_PIXELS;
  const taken = new Set<string>();
  const out: T[] = [];
  for (const p of places) {
    if (!ALWAYS_SHOWN.has(p.kind)) {
      const key = `${p.kind}:${Math.floor(p.lat / cell)}:${Math.floor(p.lon / cell)}`;
      if (taken.has(key)) continue;
      taken.add(key);
    }
    out.push(p);
  }
  return out;
}
