import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index";

function createDrizzleClient(connectionString: string) {
  const pool = new Pool({
    connectionString,
  });
  return drizzle(pool, { schema });
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is not defined");
}
const db = createDrizzleClient(DATABASE_URL);

export default db;
