import express from "express";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb", type: "application/json" }));
  app.get("/api/health", (_request, response) => {
    response
      .set("Cache-Control", "no-store")
      .status(200)
      .json({ data: { status: "ok" } });
  });

  return app;
}
