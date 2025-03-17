import dotenv from "dotenv";
import { AntClient } from "./client/client";
import { inMemoryRegistry } from "./registry/inMemoryRegistry";

async function main() {
  dotenv.config();

  if (process.argv.length < 3) {
    console.log(
      "Usage: bun src/index.ts <server urls...>\nFormat: <url>::<type> where type is 'sse' or 'stdio'\nExample: https://server1.com::sse https://server2.com::sse localhost::stdio"
    );
    return;
  }
  const registry = new inMemoryRegistry();
  await registry.initialize();
  const mcpClient = new AntClient(registry);

  try {
    // Process all server URLs provided as arguments
    const serverArgs = process.argv.slice(2);
    for (const arg of serverArgs) {
      // Use double colon as separator to avoid conflicts with URL structure
      const lastDoubleColonIndex = arg.lastIndexOf("::");
      if (lastDoubleColonIndex === -1) {
        console.log(`Invalid server argument: ${arg}. Format should be url::type`);
        continue;
      }

      const url = arg.substring(0, lastDoubleColonIndex);
      const type = arg.substring(lastDoubleColonIndex + 2);

      if (!url || !type || !["sse", "stdio"].includes(type)) {
        console.log(`Invalid server argument: ${arg}. Format should be url::type`);
        continue;
      }
      await mcpClient.connectToServer(url, type as "sse" | "stdio");
    }

    await mcpClient.chatLoop();
  } finally {
    await mcpClient.cleanup();
    process.exit(0);
  }
}

main();