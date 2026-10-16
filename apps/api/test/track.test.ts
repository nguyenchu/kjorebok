import { describe, expect, it } from "vitest";
import { processTrack } from "../src/lib/track/index.js";
import { Route, displace, kmh, sample } from "./simulate.js";

const relativeError = (measured: number, truth: number) => Math.abs(measured - truth) / truth;

function cityRoute(): Route {
  const route = new Route();
  for (let block = 0; block < 6; block++) {
    route
      .straight(350, kmh(40))
      .turn(block % 2 === 0 ? 90 : -90, 15, kmh(20))
      .straight(120, kmh(30))
      .turn(block % 2 === 0 ? -90 : 90, 15, kmh(20));
  }
  return route;
}

/** Residential streets: 30 km/h, slow corners and a wait at every other junction. */
function thirtyZoneRoute(): Route {
  const route = new Route();
  for (let block = 0; block < 6; block++) {
    route
      .straight(250, kmh(30))
      .turn(block % 2 === 0 ? 90 : -90, 10, kmh(15))
      .straight(100, kmh(25))
      .turn(block % 2 === 0 ? -90 : 90, 10, kmh(15));
    if (block % 2 === 1) route.stop(40);
  }
  return route;
}

/** A queue that never gets above 20 km/h: short creeps between waits. */
function queueRoute(): Route {
  const route = new Route();
  for (let i = 0; i < 12; i++) {
    route.straight(60, kmh(12)).straight(40, kmh(20)).stop(25);
  }
  return route;
}

describe("processTrack: distance", () => {
  it("measures a straight drive close to its true length, closer than the raw sum", () => {
    const route = new Route().straight(2000, kmh(50));
    const points = sample(route, { intervalSeconds: 2, accuracy: 8 });
    const result = processTrack(points);

    expect(relativeError(result.distanceMeters, route.trueDistance)).toBeLessThan(0.02);
    expect(relativeError(result.rawDistanceMeters, route.trueDistance)).toBeGreaterThan(
      relativeError(result.distanceMeters, route.trueDistance),
    );
  });

  it("follows turns in city driving", () => {
    const route = cityRoute();
    const points = sample(route, { intervalSeconds: 1, accuracy: 6, seed: 7 });
    const result = processTrack(points);

    expect(relativeError(result.distanceMeters, route.trueDistance)).toBeLessThan(0.03);
  });

  it("measures a walk", () => {
    const route = new Route().straight(400, 1.4).turn(90, 10, 1.4).straight(600, 1.4);
    const points = sample(route, { intervalSeconds: 3, accuracy: 5, seed: 3 });
    const result = processTrack(points);

    expect(relativeError(result.distanceMeters, route.trueDistance)).toBeLessThan(0.05);
  });

  it("adds almost nothing while parked, however long the phone keeps reporting", () => {
    const route = new Route().stop(600);
    const points = sample(route, { intervalSeconds: 2, accuracy: 10, correlation: 0.9, seed: 11 });
    const result = processTrack(points);

    expect(result.rawDistanceMeters).toBeGreaterThan(200);
    expect(result.distanceMeters).toBeLessThan(25);
    expect(result.movingSeconds).toBeLessThan(60);
  });

  it("does not count time stopped at a light or in a queue as distance", () => {
    const route = new Route().straight(1000, kmh(40)).stop(180).straight(1000, kmh(40));
    const points = sample(route, { intervalSeconds: 2, accuracy: 8, correlation: 0.7, seed: 5 });
    const result = processTrack(points);

    expect(relativeError(result.distanceMeters, route.trueDistance)).toBeLessThan(0.03);
    expect(result.stoppedSeconds).toBeGreaterThan(150);
    expect(result.stoppedSeconds).toBeLessThan(210);
  });

  it("counts manoeuvring in a car park, which never leaves a small box", () => {
    const route = new Route().straight(800, kmh(40));
    for (let lap = 0; lap < 8; lap++) route.straight(25, kmh(12)).turn(180, 6, kmh(10));
    route.straight(800, kmh(40));
    for (const seed of [1, 2, 3, 4, 5]) {
      const result = processTrack(sample(route, { intervalSeconds: 1, accuracy: 8, seed }));

      expect(result.stops).toHaveLength(0);
      expect(relativeError(result.distanceMeters, route.trueDistance)).toBeLessThan(0.05);
    }
  });

  it("bridges a tunnel with a straight line and reports the gap", () => {
    const route = new Route().straight(3000, kmh(60));
    const points = sample(route, { intervalSeconds: 2, accuracy: 8, skip: [[60, 150]] });
    const result = processTrack(points);

    expect(relativeError(result.distanceMeters, route.trueDistance)).toBeLessThan(0.02);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].seconds).toBeGreaterThan(85);
  });
});

describe("processTrack: bad fixes", () => {
  const route = new Route().straight(1500, kmh(50)).turn(90, 20, kmh(25)).straight(1500, kmh(50));
  const clean = sample(route, { intervalSeconds: 2, accuracy: 8, seed: 21 });
  const baseline = processTrack(clean).distanceMeters;

  it("ignores a fix that jumps 500 m away", () => {
    const points = clean.map((p, i) => (i === 60 ? displace(p, 500, 0) : p));
    const result = processTrack(points);

    expect(relativeError(result.distanceMeters, baseline)).toBeLessThan(0.01);
    expect(result.rejectedPointCount).toBeGreaterThanOrEqual(1);
  });

  it("ignores a moderate 80 m spike", () => {
    const points = clean.map((p, i) => (i === 60 ? displace(p, 0, 80) : p));
    const result = processTrack(points);

    expect(relativeError(result.distanceMeters, baseline)).toBeLessThan(0.02);
  });

  it("ignores a short burst of bad fixes", () => {
    const points = clean.map((p, i) => (i >= 40 && i < 44 ? displace(p, 300 + i, -200) : p));
    const result = processTrack(points);

    expect(relativeError(result.distanceMeters, baseline)).toBeLessThan(0.02);
  });

  it("does not let a wrong first fix discard the rest of the trip", () => {
    const points = [displace(clean[0], 2000, 2000), ...clean.slice(1)];
    const result = processTrack(points);

    expect(relativeError(result.distanceMeters, baseline)).toBeLessThan(0.02);
    expect(result.line[0].lat).toBeCloseTo(clean[1].lat, 3);
  });

  it("drops fixes with no usable accuracy", () => {
    const points = clean.map((p, i) => (i % 10 === 0 ? { ...p, accuracy: 0 } : p));
    const result = processTrack(points);

    expect(relativeError(result.distanceMeters, baseline)).toBeLessThan(0.02);
  });
});

describe("processTrack: speed and time", () => {
  it("reports max and average speed of a steady drive", () => {
    const route = new Route().straight(5000, kmh(80));
    const points = sample(route, { intervalSeconds: 2, accuracy: 8, seed: 2, unknownSpeed: true });
    const result = processTrack(points);

    expect(result.maxSpeedKmh).toBeGreaterThan(75);
    expect(result.maxSpeedKmh).toBeLessThan(90);
    expect(result.avgMovingSpeedKmh).toBeGreaterThan(76);
    expect(result.avgMovingSpeedKmh).toBeLessThan(84);
    expect(Math.abs(result.movingSeconds - result.durationSeconds)).toBeLessThan(10);
  });
});

describe("processTrack: input handling", () => {
  const route = new Route().straight(1000, kmh(40));
  const points = sample(route, { intervalSeconds: 2, accuracy: 8, seed: 9 });

  it("gives the same result whatever order the fixes arrive in", () => {
    const shuffled = [...points].reverse();
    expect(processTrack(shuffled)).toEqual(processTrack(points));
  });

  it("keeps the more accurate of two fixes with the same timestamp", () => {
    const duplicated = points.flatMap((p) => [p, { ...displace(p, 50, 0), accuracy: p.accuracy + 20 }]);
    const result = processTrack(duplicated);
    expect(result.distanceMeters).toBeCloseTo(processTrack(points).distanceMeters, 6);
  });

  it("handles empty and single-fix trips", () => {
    expect(processTrack([]).distanceMeters).toBe(0);
    const single = processTrack(points.slice(0, 1));
    expect(single.distanceMeters).toBe(0);
    expect(single.line).toHaveLength(1);
  });

  it("simplifies the map line without moving its ends", () => {
    const result = processTrack(points);
    expect(result.line.length).toBeLessThan(points.length);
    expect(result.line.length).toBeGreaterThanOrEqual(2);
    expect(result.line[0].timestamp).toBe(new Date(points[0].time).toISOString());
    expect(result.line[result.line.length - 1].timestamp).toBe(
      new Date(points[points.length - 1].time).toISOString(),
    );
  });
});

describe("processTrack: stops and mode", () => {
  it("reports where and how long the vehicle stopped", () => {
    const route = new Route().straight(1000, kmh(40)).stop(300).straight(1000, kmh(40));
    const result = processTrack(sample(route, { intervalSeconds: 2, accuracy: 8, seed: 4 }));

    expect(result.stops).toHaveLength(1);
    expect(result.stops[0].seconds).toBeGreaterThan(270);
    expect(result.stops[0].seconds).toBeLessThan(330);
  });

  it.each([
    ["CAR", new Route().straight(4000, kmh(60)), 2],
    ["WALK", new Route().straight(800, 1.3), 3],
    ["WALK", new Route().straight(1200, kmh(6)), 3],
  ] as const)("recognises %s from the smoothed speeds", (mode, route, intervalSeconds) => {
    const result = processTrack(sample(route, { intervalSeconds, accuracy: 5, seed: 13 }));
    expect(result.mode).toBe(mode);
  });

  // A car held to bicycle speeds moves exactly like a bicycle, and almost every
  // trip in a kjørebok is a car, so speeds a car can drive come out as CAR.
  it.each([
    ["in city traffic", cityRoute()],
    ["in a 30 zone", thirtyZoneRoute()],
    ["in a stop-and-go queue", queueRoute()],
    ["at a steady bicycle speed", new Route().straight(3000, kmh(17))],
    ["at a steady e-bike speed", new Route().straight(4000, kmh(24))],
  ])("calls a trip %s a car", (_name, route) => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const result = processTrack(sample(route, { intervalSeconds: 2, accuracy: 8, seed }));
      expect(result.mode).toBe("CAR");
    }
  });
});
