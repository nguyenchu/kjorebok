ALTER TABLE "Trip" DROP CONSTRAINT "Trip_vehicleId_fkey";

DROP INDEX "Trip_vehicleId_idx";

ALTER TABLE "Trip" DROP COLUMN "vehicleId";

DROP TABLE "Vehicle";
