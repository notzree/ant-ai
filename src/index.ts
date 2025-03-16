import dotenv from "dotenv";
import { AntClient } from "./client/client";
async function main() {
  dotenv.config();

  if (process.argv.length < 3) {
    console.log("Usage: node index.ts <path_to_server_script>");
    return;
  }
  const mcpClient = new AntClient();
  try {
    if (!process.argv[2]) {
      throw new Error("Server script path is required");
    }
    await mcpClient.connectToServer(process.argv[2]);
    await mcpClient.chatLoop();
  } finally {
    await mcpClient.cleanup();
    process.exit(0);
  }
}

main();
