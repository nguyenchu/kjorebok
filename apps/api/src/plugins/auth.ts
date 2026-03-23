import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import type { FastifyInstance } from "fastify";

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.register(jwt, {
    secret: process.env.JWT_SECRET!,
    sign: { expiresIn: "15m" },
  });

  app.decorate("authenticate", async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.status(401).send({ error: "Unauthorized" });
    }
  });
});
