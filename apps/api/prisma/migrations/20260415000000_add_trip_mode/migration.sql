-- CreateEnum
CREATE TYPE "TripMode" AS ENUM ('WALK', 'CYCLE', 'EBIKE', 'CAR', 'OTHER');

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN "mode" "TripMode" NOT NULL DEFAULT 'CAR';
