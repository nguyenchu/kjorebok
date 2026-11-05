import { describe, expect, it } from "vitest";
import { buildPoiQuery, pickPoi, type OverpassElement } from "../src/lib/poi.js";

const node = (id: number, lat: number, lon: number, tags: Record<string, string>): OverpassElement => ({
  type: "node", id, lat, lon, tags,
});

const way = (
  id: number,
  center: { lat: number; lon: number },
  bounds: OverpassElement["bounds"],
  tags: Record<string, string>,
): OverpassElement[] => [
  // Overpass sends a way twice: with tags and centre, then with its bounding box.
  { type: "way", id, center, tags },
  { type: "way", id, bounds },
];

// Trimmed from a real Overpass answer around Storo, Oslo.
const storo: OverpassElement[] = [
  node(1, 59.9465108, 10.7756456, { name: "Storo storsenter - gammelt p-hus", amenity: "parking" }),
  node(2, 59.9468411, 10.7767047, { name: "Thauglands Trevare", shop: "doityourself" }),
  node(3, 59.9464414, 10.7762118, { name: "Kiwi Storo", shop: "supermarket", branch: "Storo" }),
  ...way(
    4,
    { lat: 59.9471504, lon: 10.7750633 },
    { minlat: 59.9463697, minlon: 10.7735304, maxlat: 59.9479312, maxlon: 10.7765963 },
    { name: "Storo storsenter", shop: "mall" },
  ),
  ...way(
    5,
    { lat: 59.9462601, lon: 10.7777657 },
    { minlat: 59.9456709, minlon: 10.7772476, maxlat: 59.9468492, maxlon: 10.7782838 },
    { name: "Vitaminveien 1A", amenity: "parking" },
  ),
];

describe("pickPoi", () => {
  it("names the mall a car is parked inside rather than a shop in it", () => {
    expect(pickPoi(storo, 59.9468, 10.7755)).toBe("Storo storsenter");
  });

  it("prefers a site at the edge over the nearest shop", () => {
    // Just east of the mall's bounding box, nearest to Kiwi.
    expect(pickPoi(storo, 59.9466, 10.7766)).toBe("Storo storsenter");
  });

  it("falls back to the nearest shop when no site is near", () => {
    const shops = storo.filter((element) => element.id !== 4);
    expect(pickPoi(shops, 59.94645, 10.77622)).toBe("Kiwi Storo");
  });

  it("never names a parking lot", () => {
    const parking = storo.filter((element) => element.id === 1 || element.id === 5);
    expect(pickPoi(parking, 59.9463, 10.7777)).toBeNull();
  });

  it("adds the branch when the name does not already say it", () => {
    const elements = [node(1, 60, 10, { name: "Rema 1000", shop: "supermarket", branch: "Grünerløkka" })];
    expect(pickPoi(elements, 60, 10)).toBe("Rema 1000 Grünerløkka");
  });

  it("picks the smaller of two sites the point is inside", () => {
    const elements = [
      ...way(1, { lat: 60, lon: 10 }, { minlat: 59.99, minlon: 9.99, maxlat: 60.01, maxlon: 10.01 }, { name: "Oslo lufthavn", aeroway: "aerodrome" }),
      ...way(2, { lat: 60, lon: 10 }, { minlat: 59.999, minlon: 9.999, maxlat: 60.001, maxlon: 10.001 }, { name: "Terminal", aeroway: "terminal" }),
    ];
    expect(pickPoi(elements, 60, 10)).toBe("Terminal");
  });

  it("returns null when nothing is near", () => {
    expect(pickPoi([], 60, 10)).toBeNull();
  });
});

describe("buildPoiQuery", () => {
  it("searches around the point and asks for both centres and bounds", () => {
    const query = buildPoiQuery(59.9466, 10.7766);
    expect(query).toContain("around:60,59.9466,10.7766");
    expect(query).toContain("out center;");
    expect(query).toContain("out ids bb;");
  });
});
