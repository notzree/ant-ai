import dotenv from "dotenv";
import { AntClient } from "./client/client";
import { inMemoryRegistry } from "./registry/inMemoryRegistry";
async function main() {
  dotenv.config();

  if (process.argv.length < 4) {
    console.log(
      "Usage: bun src/index.ts <server url (local or remote)> <conn type sse or stdio>",
    );
    return;
  }
  const registry = new inMemoryRegistry();
  await registry.initialize();
  await registry.addServer(
    "https://mcp.composio.dev/browserbase_tool/few-sticky-animal-ZVQ1XF",
    "sse",
  );
  await registry.addServer(
    "https://mcp.composio.dev/google_maps/few-sticky-animal-ZVQ1XF",
    "sse",
  );
  await registry.addServer(
    "https://mcp.composio.dev/notion/few-sticky-animal-ZVQ1XF",
    "sse",
  );

  const mcpClient = new AntClient(registry);
  try {
    const url = process.argv[2] || "";
    const type = process.argv[3] as "stdio" | "sse";
    await mcpClient.connectToServer(url, type);
    await mcpClient.chatLoop();
  } finally {
    await mcpClient.cleanup();
    process.exit(0);
  }
}

main();
