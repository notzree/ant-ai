import dotenv from "dotenv";
import { AntClient } from "./client/client";
import { RegistryClient } from "./registry/registryClient";

async function main() {
  dotenv.config();

  if (process.argv.length < 3) {
    console.log(
      "Usage: bun src/index.ts <registry url>::<type> [<server url>::<type> ...]\n" +
        "Format: url::type where type is 'sse' or 'stdio'\n" +
        "Example: https://registry.example.com::sse https://server1.com::sse localhost::stdio",
    );
    return;
  }

  const args = process.argv.slice(2);

  // Parse the registry URL (first argument)
  const registryArg = args[0];
  if (!registryArg) {
    console.log("A registry URL is required");
    return;
  }

  const registryColonIndex = registryArg.lastIndexOf("::");

  if (registryColonIndex === -1) {
    console.log(
      `Invalid registry argument: ${registryArg}. Format should be url::type`,
    );
    return;
  }

  const registryUrl = registryArg.substring(0, registryColonIndex);
  const registryType = registryArg.substring(registryColonIndex + 2);

  if (
    !registryUrl ||
    !registryType ||
    !["sse", "stdio"].includes(registryType)
  ) {
    console.log(
      `Invalid registry argument: ${registryArg}. Format should be url::type`,
    );
    return;
  }

  // Create and initialize registry client
  const rc = new RegistryClient();
  await rc.initialize({
    url: registryUrl,
    type: registryType as "sse" | "stdio",
    appName: "ant-registry",
    appVersion: "1.0",
  });

  // Create AntClient
  const mcpClient = new AntClient(rc);

  try {
    // Connect to the additional servers provided as arguments
    if (args.length > 1) {
      const serverArgs = args.slice(1); // Skip the registry arg
      for (const arg of serverArgs) {
        const lastDoubleColonIndex = arg.lastIndexOf("::");

        if (lastDoubleColonIndex === -1) {
          console.log(
            `Invalid server argument: ${arg}. Format should be url::type`,
          );
          continue;
        }

        const url = arg.substring(0, lastDoubleColonIndex);
        const type = arg.substring(lastDoubleColonIndex + 2);

        if (!url || !type || !["sse", "stdio"].includes(type)) {
          console.log(
            `Invalid server argument: ${arg}. Format should be url::type`,
          );
          continue;
        }

        await mcpClient.connectToServer(url, type as "sse" | "stdio");
      }
    }

    // Start the chat loop
    await mcpClient.chatLoop();
  } finally {
    await mcpClient.cleanup();
    process.exit(0);
  }
}

main();
