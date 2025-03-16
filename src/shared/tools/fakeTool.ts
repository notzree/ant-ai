import type { AntTool } from "./tool";
import { User } from "../user/user";

export class FakeTool implements AntTool {
  id: string;
  name: string;
  description: string;
  baseServerUrl: string;

  constructor(id: string, name: string, description: string, baseUrl: string) {
    this.id = id;
    this.name = name;
    this.description = description;
    this.baseServerUrl = baseUrl;
  }

  getUrl(user: User): Promise<string> {
    return Promise.resolve(`${this.baseServerUrl}/user/${user.id}`);
  }
}
