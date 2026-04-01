ALTER TABLE "Trip" DROP CONSTRAINT "Trip_vehicleId_fkey";

DROP INDEX "Trip_vehicleId_idx";

ALTER TABLE "Trip" ALTER COLUMN "vehicleId" DROP NOT NULL;

CREATE INDEX "Trip_vehicleId_idx" ON "Trip"("vehicleId");

ALTER TABLE "Trip"
ADD CONSTRAINT "Trip_vehicleId_fkey"
FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
