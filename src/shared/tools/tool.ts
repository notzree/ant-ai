import type { User } from "../user/user";

export class AntTool {
  serverUrl: string;
  name: string;
  description: string;
  inputSchema: object;
  constructor(
    serverUrl: string,
    name: string,
    description: string,
    inputSchema: object,
  ) {
    this.serverUrl = serverUrl;
    this.name = name;
    this.description = description;
    this.inputSchema = inputSchema;
  }
}
