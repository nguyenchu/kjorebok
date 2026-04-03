import Fastify from "fastify";
import cors from "@fastify/cors";
import { authPlugin } from "./plugins/auth.js";
import { authRoutes } from "./routes/auth.js";
import { tripRoutes } from "./routes/trips.js";

const app = Fastify({ logger: true });
const apiPrefix = normalizeApiPrefix(process.env.API_PREFIX);

await app.register(cors, { origin: true });
await app.register(authPlugin);
await app.register(authRoutes, { prefix: apiPrefix });
await app.register(tripRoutes, { prefix: apiPrefix });

app.get(`${apiPrefix}/health`, async () => ({ ok: true }));

const port = Number(process.env.PORT ?? 3020);
await app.listen({ port, host: "0.0.0.0" });
console.log(`API running on http://localhost:${port}`);

function normalizeApiPrefix(prefix: string | undefined): string {
  if (!prefix) return "";
  const trimmed = prefix.trim();
  if (!trimmed || trimmed === "/") return "";

  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}
