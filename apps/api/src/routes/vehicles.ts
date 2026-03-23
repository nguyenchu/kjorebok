import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

const createVehicleSchema = z.object({
  name: z.string().min(1),
  licensePlate: z.string().min(1),
});

export async function vehicleRoutes(app: FastifyInstance) {
  const auth = { onRequest: [(app as any).authenticate] };

  app.get("/vehicles", auth, async (request, reply) => {
    const userId = (request.user as any).sub;
    const vehicles = await prisma.vehicle.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
    return reply.send(vehicles);
  });

  app.post("/vehicles", auth, async (request, reply) => {
    const userId = (request.user as any).sub;
    const body = createVehicleSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const vehicle = await prisma.vehicle.create({
      data: { userId, ...body.data },
    });
    return reply.status(201).send(vehicle);
  });

  app.delete("/vehicles/:id", auth, async (request, reply) => {
    const userId = (request.user as any).sub;
    const { id } = request.params as { id: string };
    const vehicle = await prisma.vehicle.findFirst({ where: { id, userId } });
    if (!vehicle) return reply.status(404).send({ error: "Not found" });

    await prisma.vehicle.delete({ where: { id } });
    return reply.status(204).send();
  });
}
