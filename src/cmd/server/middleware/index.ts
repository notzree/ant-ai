import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import { errorHandler } from "./error";
import { authMiddleware } from "./auth";

// Apply all middleware to the app
export function middleware(app: Express) {
  // Security middleware
  app.use(helmet());

  // CORS middleware
  app.use(cors());

  // Body parsing middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Authentication middleware (will be skipped for public routes)
  app.use(authMiddleware);

  // Error handling middleware is added last
  app.use(errorHandler);
}
