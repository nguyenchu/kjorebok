import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

const createPlaceSchema = z.object({
  label: z.string().trim().min(1).max(80),
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  radiusMeters: z.number().int().positive().max(2000).optional(),
});

const updatePlaceSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  lat: z.number().gte(-90).lte(90).optional(),
  lng: z.number().gte(-180).lte(180).optional(),
  radiusMeters: z.number().int().positive().max(2000).optional(),
});

export async function placeRoutes(app: FastifyInstance) {
  const auth = { onRequest: [(app as any).authenticate] };

  app.get("/places", auth, async (request, reply) => {
    const userId = (request.user as any).sub;
    const places = await prisma.place.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { id: true, label: true, lat: true, lng: true, radiusMeters: true },
    });
    return reply.send(places);
  });

  app.post("/places", auth, async (request, reply) => {
    const userId = (request.user as any).sub;
    const body = createPlaceSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const place = await prisma.place.create({
      data: {
        userId,
        label: body.data.label,
        lat: body.data.lat,
        lng: body.data.lng,
        radiusMeters: body.data.radiusMeters ?? 100,
      },
      select: { id: true, label: true, lat: true, lng: true, radiusMeters: true },
    });
    return reply.status(201).send(place);
  });

  app.patch("/places/:id", auth, async (request, reply) => {
    const userId = (request.user as any).sub;
    const { id } = request.params as { id: string };
    const body = updatePlaceSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const existing = await prisma.place.findFirst({ where: { id, userId } });
    if (!existing) return reply.status(404).send({ error: "Not found" });

    const place = await prisma.place.update({
      where: { id },
      data: body.data,
      select: { id: true, label: true, lat: true, lng: true, radiusMeters: true },
    });
    return reply.send(place);
  });

  app.delete("/places/:id", auth, async (request, reply) => {
    const userId = (request.user as any).sub;
    const { id } = request.params as { id: string };
    const existing = await prisma.place.findFirst({ where: { id, userId } });
    if (!existing) return reply.status(404).send({ error: "Not found" });

    await prisma.place.delete({ where: { id } });
    return reply.status(204).send();
  });
}
