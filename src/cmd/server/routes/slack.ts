import { Router } from "express";
import SupabaseSlackController from "../controllers/slack";
const router = Router();

// /slack prefix
router.get(
  "/install",
  SupabaseSlackController.handle_install.bind(SupabaseSlackController),
);
router.get(
  "/oauth_redirect",
  SupabaseSlackController.handle_oauth_redirect.bind(SupabaseSlackController),
);
router.post(
  "/events",
  SupabaseSlackController.handle_events.bind(SupabaseSlackController),
);

export default router;
