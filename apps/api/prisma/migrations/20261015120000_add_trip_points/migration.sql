-- CreateEnum
CREATE TYPE "PointSource" AS ENUM ('DEVICE', 'LEGACY_ROUTE');

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "endLat" DOUBLE PRECISION,
ADD COLUMN     "endLng" DOUBLE PRECISION,
ADD COLUMN     "startLat" DOUBLE PRECISION,
ADD COLUMN     "startLng" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "TripPoint" (
    "id" BIGSERIAL NOT NULL,
    "tripId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "altitude" DOUBLE PRECISION,
    "altitudeAccuracy" DOUBLE PRECISION,
    "source" "PointSource" NOT NULL DEFAULT 'DEVICE',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripPoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TripPoint_tripId_recordedAt_key" ON "TripPoint"("tripId", "recordedAt");

-- AddForeignKey
ALTER TABLE "TripPoint" ADD CONSTRAINT "TripPoint_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: copy every point of the legacy JSON route into TripPoint. Elements
-- without coordinates or a parseable timestamp are skipped rather than failing
-- the migration; duplicate timestamps keep the first point.
INSERT INTO "TripPoint" ("tripId", "recordedAt", "lat", "lng", "accuracy", "speed", "heading", "source", "receivedAt")
SELECT
    t."id",
    ((p ->> 'timestamp')::timestamptz AT TIME ZONE 'UTC'),
    (p ->> 'lat')::double precision,
    (p ->> 'lng')::double precision,
    CASE WHEN jsonb_typeof(p -> 'accuracy') = 'number' THEN (p ->> 'accuracy')::double precision ELSE 0 END,
    CASE WHEN jsonb_typeof(p -> 'speed') = 'number' THEN (p ->> 'speed')::double precision END,
    CASE WHEN jsonb_typeof(p -> 'heading') = 'number' THEN (p ->> 'heading')::double precision END,
    'LEGACY_ROUTE',
    t."updatedAt"
FROM "Trip" t
CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(t."route") = 'array' THEN t."route" ELSE '[]'::jsonb END
) AS p
WHERE jsonb_typeof(p) = 'object'
  AND jsonb_typeof(p -> 'lat') = 'number'
  AND jsonb_typeof(p -> 'lng') = 'number'
  AND jsonb_typeof(p -> 'timestamp') = 'string'
  AND (p ->> 'timestamp') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
ON CONFLICT ("tripId", "recordedAt") DO NOTHING;

-- Backfill start/end coordinates from the earliest and latest point.
UPDATE "Trip" t
SET "startLat" = f."lat", "startLng" = f."lng"
FROM (
    SELECT DISTINCT ON ("tripId") "tripId", "lat", "lng"
    FROM "TripPoint"
    ORDER BY "tripId", "recordedAt" ASC
) f
WHERE f."tripId" = t."id";

UPDATE "Trip" t
SET "endLat" = l."lat", "endLng" = l."lng"
FROM (
    SELECT DISTINCT ON ("tripId") "tripId", "lat", "lng"
    FROM "TripPoint"
    ORDER BY "tripId", "recordedAt" DESC
) l
WHERE l."tripId" = t."id";
