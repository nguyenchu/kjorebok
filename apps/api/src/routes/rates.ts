import type { FastifyInstance } from "fastify";
import { MILEAGE_RATES, getMileageRate } from "../lib/rates.js";

/**
 * Public on purpose: the kjøregodtgjørelse calculator on the marketing site
 * reads its numbers from here, so satser are updated in one place.
 */
export async function rateRoutes(app: FastifyInstance) {
  app.get("/rates", async (_request, reply) => {
    return reply.send(MILEAGE_RATES);
  });

  app.get("/rates/:year", async (request, reply) => {
    const { year } = request.params as { year: string };
    const parsed = Number(year);
    if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) {
      return reply.status(400).send({ error: "Ugyldig år" });
    }
    return reply.send(getMileageRate(parsed));
  });
}
