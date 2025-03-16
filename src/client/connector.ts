// Connector interface implements connection to an MCP server (local or remote)
export interface Connector {}

// STDIOConnector implements connection to a local MCP server via standard input/output
export interface STDIOConnector {}

// SSEConnector implements connection to a remote MCP server via Server-Sent Events
export interface SSEConnector {}
