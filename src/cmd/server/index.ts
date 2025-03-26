import express from "express";
import { middleware } from "./middleware";
import { routes } from "./routes";
const PORT = process.env.PORT || 3000;
async function bootstrap() {
  const app = express();
  // Apply middleware
  middleware(app);
  // Apply routes
  routes(app);
  console.log("Server listening on port", PORT);
  return app;
}
bootstrap()
  .then((app) => app.listen(PORT))
  .catch(console.error);
