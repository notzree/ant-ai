// src/middleware/auth.ts - Supabase auth middleware
import { type Request, type Response, type NextFunction } from "express";
import { getSupabaseClient } from "../../../integrations/supabase";

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Skip authentication for public paths
  if (
    req.path === "/api/auth/callback" ||
    req.path === "/api/health" ||
    req.path.startsWith("/api/slack")
  ) {
    return next();
  }

  try {
    const supabase = getSupabaseClient();
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({ message: "Authentication required" });
    }

    // Verify the token with Supabase
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    // Add user info to request object for use in controllers
    req.user = data.user;

    next();
  } catch (error) {
    return res.status(401).json({ message: "Authentication failed" });
  }
}
