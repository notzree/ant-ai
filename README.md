# Ant Client
Ant is an MCP client and personal registry. You may add an unlimited number of MCP servers to the registry, and Ant will only fetch the necessary servers for your query, resulting in cheaper queries (less tool context).

Features:
- Multiple MCP server connections with lazy loading (connections open when tools are used, not when they are initialized)
- LRU Cache with TTL to close unused connections to save resources
- extensible registry

# Example: Creating and inviting to a google meet.
<img width="1342" alt="image" src="https://github.com/user-attachments/assets/38b66220-5e6c-4024-9a5e-021d9e0d8052" />
<img width="1349" alt="image" src="https://github.com/user-attachments/assets/bfe85800-42d0-4d90-a740-881e88e74eca" />
<img width="862" alt="image" src="https://github.com/user-attachments/assets/57ad4908-cff1-4119-a22b-36f064e4b0ea" />

To install dependencies:

```bash
bun install
```

To run:

```bash
bun src/internal/index.ts src/internal/registry/mcpServer.ts::stdio;
```


# QUIRKS
To connect to any python servers that are using uv, you will need to have uv installed globally
```bash
brew install uv
```

# Run migration w/ drizzle-kit
Ensure you have bun and drizzle-kit installed globally
```bash
# install drizzle-kit
bun install -g drizzle-kit

# generate migration
bunx drizzle-kit generate --config=drizzle-dev.config.ts --name="name_of_migration"

# push migration
bunx drizzle-kit push --config=drizzle-dev.config.ts

```
