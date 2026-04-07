-- CreateEnum
CREATE TYPE "TripPurpose" AS ENUM ('PRIVATE', 'WORK');

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "purpose" "TripPurpose" NOT NULL DEFAULT 'PRIVATE';
