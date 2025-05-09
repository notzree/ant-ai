export class MCPServer {
  public url: string;
  public type: "sse" | "stdio";
  public authToken?: string;

  public constructor(url: string, type: "sse" | "stdio", authToken?: string) {
    this.url = url;
    this.type = type;
    this.authToken = authToken;
  }

  public getId(): string {
    return `${this.url}::${this.type}`;
  }

  public equals(other: MCPServer): boolean {
    if (!(other instanceof MCPServer)) {
      return false;
    }

    return this.getId() === other.getId();
  }
}
