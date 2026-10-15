-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "avgMovingSpeedKmh" DOUBLE PRECISION,
ADD COLUMN     "maxSpeedKmh" DOUBLE PRECISION,
ADD COLUMN     "movingSeconds" DOUBLE PRECISION,
ADD COLUMN     "pointCount" INTEGER,
ADD COLUMN     "processingVersion" INTEGER,
ADD COLUMN     "rawDistanceMeters" DOUBLE PRECISION,
ADD COLUMN     "rejectedPointCount" INTEGER,
ADD COLUMN     "stoppedSeconds" DOUBLE PRECISION,
ADD COLUMN     "stops" JSONB,
ADD COLUMN     "track" JSONB;
