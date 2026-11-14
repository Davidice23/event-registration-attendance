import "dotenv/config";
import { createApp } from "./app.js";
import { createPrismaClient } from "./db.js";

const port = Number(process.env.PORT ?? "3001");
// Cloud Run and containers need HOST=0.0.0.0; local development stays on loopback.
const host = process.env.HOST ?? "127.0.0.1";

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

// In production a missing or rejected DATABASE_URL must stop startup instead of serving
// an app without its API routes. The error messages never include the URL itself.
const prisma = process.env.NODE_ENV === "production" ? createPrismaClient() : undefined;

createApp({ prisma }).listen(port, host, () => {
  console.log(`API listening on http://${host}:${port}`);
});
