import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { REGISTRATION_PATTERN, normalizeRegistration } from "../lib/registration.js";

const vehicleSelect = {
  id: true,
  label: true,
  registration: true,
  type: true,
  isDefault: true,
} as const;

const registrationSchema = z
  .string()
  .trim()
  .transform(normalizeRegistration)
  .refine((value) => REGISTRATION_PATTERN.test(value), {
    message: "Registreringsnummeret må være to bokstaver og fem siffer, f.eks. AB 12345",
  });

const createVehicleSchema = z.object({
  label: z.string().trim().min(1).max(80),
  registration: registrationSchema,
  type: z.enum(["PRIVATE", "COMPANY", "WORK"]).optional(),
  isDefault: z.boolean().optional(),
});

const updateVehicleSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  registration: registrationSchema.optional(),
  type: z.enum(["PRIVATE", "COMPANY", "WORK"]).optional(),
  isDefault: z.boolean().optional(),
});

/** Exactly one vehicle per user carries isDefault, so new trips have somewhere to go. */
async function clearOtherDefaults(userId: string, keepId: string) {
  await prisma.vehicle.updateMany({
    where: { userId, isDefault: true, NOT: { id: keepId } },
    data: { isDefault: false },
  });
}

export async function vehicleRoutes(app: FastifyInstance) {
  const auth = { onRequest: [(app as any).authenticate] };

  app.get("/vehicles", auth, async (request, reply) => {
    const userId = (request.user as any).sub;
    const vehicles = await prisma.vehicle.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: vehicleSelect,
    });
    return reply.send(vehicles);
  });

  app.post("/vehicles", auth, async (request, reply) => {
    const userId = (request.user as any).sub;
    const body = createVehicleSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const duplicate = await prisma.vehicle.findFirst({
      where: { userId, registration: body.data.registration },
      select: { id: true },
    });
    if (duplicate) return reply.status(409).send({ error: "Kjøretøyet er allerede registrert" });

    const isFirst = (await prisma.vehicle.count({ where: { userId } })) === 0;
    const vehicle = await prisma.vehicle.create({
      data: {
        userId,
        label: body.data.label,
        registration: body.data.registration,
        type: body.data.type ?? "PRIVATE",
        isDefault: body.data.isDefault ?? isFirst,
      },
      select: vehicleSelect,
    });
    if (vehicle.isDefault) await clearOtherDefaults(userId, vehicle.id);

    return reply.status(201).send(vehicle);
  });

  app.patch("/vehicles/:id", auth, async (request, reply) => {
    const userId = (request.user as any).sub;
    const { id } = request.params as { id: string };
    const body = updateVehicleSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const existing = await prisma.vehicle.findFirst({ where: { id, userId } });
    if (!existing) return reply.status(404).send({ error: "Not found" });

    if (body.data.registration && body.data.registration !== existing.registration) {
      const duplicate = await prisma.vehicle.findFirst({
        where: { userId, registration: body.data.registration, NOT: { id } },
        select: { id: true },
      });
      if (duplicate) return reply.status(409).send({ error: "Kjøretøyet er allerede registrert" });
    }

    const vehicle = await prisma.vehicle.update({
      where: { id },
      data: body.data,
      select: vehicleSelect,
    });
    if (vehicle.isDefault) await clearOtherDefaults(userId, vehicle.id);

    return reply.send(vehicle);
  });

  app.delete("/vehicles/:id", auth, async (request, reply) => {
    const userId = (request.user as any).sub;
    const { id } = request.params as { id: string };
    const existing = await prisma.vehicle.findFirst({ where: { id, userId } });
    if (!existing) return reply.status(404).send({ error: "Not found" });

    // Trips keep their history; the relation is nulled by onDelete: SetNull.
    await prisma.vehicle.delete({ where: { id } });

    if (existing.isDefault) {
      const next = await prisma.vehicle.findFirst({
        where: { userId },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (next) await prisma.vehicle.update({ where: { id: next.id }, data: { isDefault: true } });
    }

    return reply.status(204).send();
  });
}
