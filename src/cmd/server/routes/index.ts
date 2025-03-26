// src/routes/index.ts - Routes setup
import { type Express } from "express";
import slackRoutes from "./slack";
export function routes(app: Express) {
  // Apply all route groups
  // app.use("/api/auth", authRoutes);
  // app.use("/api/products", productRoutes);
  app.use("/api/slack", slackRoutes);

  // Health check route
  app.get("/api/health", (req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // Handle 404 errors
  app.use("*", (req, res) => {
    res.status(404).json({ message: "Route not found" });
  });
}
