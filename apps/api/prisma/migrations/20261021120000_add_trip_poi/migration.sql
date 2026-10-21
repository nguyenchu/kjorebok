-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "endPoi" TEXT,
ADD COLUMN     "poiResolvedAt" TIMESTAMP(3),
ADD COLUMN     "startPoi" TEXT;
