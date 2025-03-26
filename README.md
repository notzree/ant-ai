# mac

To install dependencies:

```bash
bun install
```

To run:

```bash
bun src/index.ts src/registry/mcpServer.ts::stdio;
```

This project was created using `bun init` in bun v1.2.5. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.


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
