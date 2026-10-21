import { haversine } from "./placeMatcher.js";

/**
 * Names the shop, business or landmark at a position, from OpenStreetMap via
 * the Overpass API. A trip shows "Kiwi Storo" rather than only "Vitaminveien 1".
 *
 * A stop is rarely on top of what was visited: the car is parked outside, often
 * between several businesses. So whole sites the point lies in (a mall, a
 * hospital, an airport) win over the single nearest shop, and parking, benches
 * and the like never count.
 */

/** Tried in order; the public servers are often busy or down one at a time. */
const OVERPASS_URLS = (
  process.env.OVERPASS_URLS ??
  "https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter,https://overpass.private.coffee/api/interpreter"
)
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);
// overpass-api.de refuses requests without an identifying User-Agent (HTTP 406).
const USER_AGENT = "kjorebok/1.0 (https://kjorebok.nguyenchu.com)";
const SEARCH_RADIUS_METERS = 60;
const REQUEST_TIMEOUT_MS = 15_000;

const POI_KEYS = ["amenity", "shop", "tourism", "leisure", "office", "healthcare", "craft", "aeroway"] as const;

/** Named, but not somewhere anyone drives to. */
const IGNORED: Record<string, ReadonlySet<string>> = {
  amenity: new Set([
    "parking", "parking_space", "parking_entrance", "bicycle_parking", "motorcycle_parking",
    "bench", "waste_basket", "waste_disposal", "recycling", "toilets", "atm", "vending_machine",
    "post_box", "telephone", "shelter", "drinking_water", "clock", "grit_bin", "loading_dock", "bbq",
  ]),
  leisure: new Set(["playground", "pitch", "picnic_table", "fitness_station", "swimming_pool", "track", "garden"]),
};

/** Whole sites a visit is to, even when the car stops at their edge. */
const SITES: Record<string, ReadonlySet<string>> = {
  shop: new Set(["mall", "department_store"]),
  amenity: new Set(["hospital", "university", "college", "school", "kindergarten", "townhall", "ferry_terminal"]),
  aeroway: new Set(["aerodrome", "terminal"]),
  leisure: new Set(["sports_centre", "stadium"]),
  tourism: new Set(["attraction", "theme_park", "zoo"]),
};

export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  tags?: Record<string, string>;
}

export function buildPoiQuery(lat: number, lng: number): string {
  const keys = POI_KEYS.join("|");
  // Asked for twice: once for tags and a centre, once for the bounding box
  // that tells whether the point lies inside a site. Overpass gives one or the other.
  return (
    `[out:json][timeout:10];` +
    `nwr(around:${SEARCH_RADIUS_METERS},${lat},${lng})[name][~"^(${keys})$"~"."]->.r;` +
    `.r out center;.r out ids bb;`
  );
}

function matches(tags: Record<string, string>, table: Record<string, ReadonlySet<string>>): boolean {
  return Object.entries(table).some(([key, values]) => tags[key] !== undefined && values.has(tags[key]));
}

function isPoi(tags: Record<string, string>): boolean {
  return POI_KEYS.some((key) => tags[key] !== undefined && !IGNORED[key]?.has(tags[key]));
}

/** "Kiwi Storo", or the name alone when it already says where. */
function displayName(tags: Record<string, string>): string {
  const name = tags.name.trim();
  const branch = tags.branch?.trim();
  return branch && !name.toLowerCase().includes(branch.toLowerCase()) ? `${name} ${branch}` : name;
}

/** The best name for what is at (lat, lng), or null when nothing nearby fits. */
export function pickPoi(elements: OverpassElement[], lat: number, lng: number): string | null {
  // The two outputs describe the same elements; join them.
  const bounds = new Map<string, OverpassElement["bounds"]>();
  for (const element of elements) {
    if (element.bounds) bounds.set(`${element.type}/${element.id}`, element.bounds);
  }

  const candidates = elements.flatMap((element) => {
    const tags = element.tags;
    if (!tags?.name?.trim() || !isPoi(tags)) return [];

    const box = bounds.get(`${element.type}/${element.id}`);
    const inside =
      !!box && lat >= box.minlat && lat <= box.maxlat && lng >= box.minlon && lng <= box.maxlon;
    const position = element.center ?? (element.lat !== undefined && element.lon !== undefined
      ? { lat: element.lat, lon: element.lon }
      : null);
    if (!position) return [];

    return [{
      name: displayName(tags),
      // Inside a site, then a site at the edge, then whatever is nearest.
      rank: inside ? 0 : matches(tags, SITES) ? 1 : 2,
      // Among sites the point is inside, the smaller one is the more specific.
      size: box ? (box.maxlat - box.minlat) * (box.maxlon - box.minlon) : 0,
      distance: haversine(lat, lng, position.lat, position.lon),
    }];
  });

  candidates.sort((a, b) => a.rank - b.rank || a.size - b.size || a.distance - b.distance);
  return candidates[0]?.name ?? null;
}

async function queryOverpass(url: string, query: string): Promise<OverpassElement[]> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const body = (await response.json()) as { elements?: OverpassElement[]; remark?: string };
  // Overpass reports its own timeouts in a 200 response.
  if (body.remark && /timed out|runtime error/i.test(body.remark)) throw new Error(body.remark);
  return body.elements ?? [];
}

/**
 * Looks up the POI at a position. Resolves to null when there is none, and
 * throws when no Overpass server could answer, so the caller can try again later.
 */
export async function lookupPoi(lat: number, lng: number): Promise<string | null> {
  const query = buildPoiQuery(lat, lng);
  const failures: string[] = [];
  for (const url of OVERPASS_URLS) {
    try {
      return pickPoi(await queryOverpass(url, query), lat, lng);
    } catch (error) {
      failures.push(`${new URL(url).host}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Ingen Overpass-server svarte (${failures.join("; ")})`);
}
