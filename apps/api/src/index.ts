import Fastify from "fastify";
import cors from "@fastify/cors";
import { authPlugin } from "./plugins/auth.js";
import { authRoutes } from "./routes/auth.js";
import { vehicleRoutes } from "./routes/vehicles.js";
import { tripRoutes } from "./routes/trips.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(authPlugin);
await app.register(authRoutes);
await app.register(vehicleRoutes);
await app.register(tripRoutes);

app.get("/health", async () => ({ ok: true }));

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "0.0.0.0" });
console.log(`API running on http://localhost:${port}`);
