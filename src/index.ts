#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { AthenaService } from "./athena.js";
import { QueryInput, AthenaError } from "./types.js";

class AthenaServer {
  private server: Server;
  private athenaService: AthenaService;

  constructor() {
    this.server = new Server(
      {
        name: "aws-athena-mcp",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.athenaService = new AthenaService();
    this.setupToolHandlers();

    // Error handling
    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "run_query",
          description: "Execute a SQL query using AWS Athena. Returns full results if query completes before timeout, otherwise returns queryExecutionId.",
          inputSchema: {
            type: "object",
            properties: {
              database: {
                type: "string",
                description: "The Athena database to query",
              },
              query: {
                type: "string",
                description: "SQL query to execute",
              },
              maxRows: {
                type: "number",
                description: "Maximum number of rows to return (default: 1000)",
                minimum: 1,
                maximum: 10000,
              },
              timeoutMs: {
                type: "number",
                description: "Timeout in milliseconds (default: 60000)",
                minimum: 1000,
              },
            },
            required: ["database", "query"],
          },
        },
        {
          name: "get_result",
          description: "Get results for a completed query. Returns error if query is still running.",
          inputSchema: {
            type: "object",
            properties: {
              queryExecutionId: {
                type: "string",
                description: "The query execution ID",
              },
              maxRows: {
                type: "number",
                description: "Maximum number of rows to return (default: 1000)",
                minimum: 1,
                maximum: 10000,
              },
            },
            required: ["queryExecutionId"],
          },
        },
        {
          name: "get_status",
          description: "Get the current status of a query execution",
          inputSchema: {
            type: "object",
            properties: {
              queryExecutionId: {
                type: "string",
                description: "The query execution ID",
              },
            },
            required: ["queryExecutionId"],
          },
        },
        {
          name: "run_saved_query",
          description: "Execute a saved (named) Athena query by its query ID.",
          inputSchema: {
            type: "object",
            properties: {
              namedQueryId: {
                type: "string",
                description: "Athena NamedQueryId",
              },
              databaseOverride: {
                type: "string",
                description: "Optional database override",
              },
              maxRows: {
                type: "number",
                description: "Maximum number of rows to return (default: 1000)",
                minimum: 1,
                maximum: 10000,
              },
              timeoutMs: {
                type: "number",
                description: "Timeout in milliseconds (default: 60000)",
                minimum: 1000,
              },
            },
            required: ["namedQueryId"],
          },
        },
        {
          name: "list_saved_queries",
          description: "List all saved (named) Athena queries available in your AWS account.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        switch (request.params.name) {
          case "run_query": {
            if (!request.params.arguments ||
                typeof request.params.arguments.database !== 'string' ||
                typeof request.params.arguments.query !== 'string') {
              throw new McpError(
                ErrorCode.InvalidParams,
                "Missing or invalid required parameters: database (string) and query (string)"
              );
            }

            const queryInput: QueryInput = {
              database: request.params.arguments.database,
              query: request.params.arguments.query,
              maxRows: typeof request.params.arguments.maxRows === 'number' ?
                request.params.arguments.maxRows : undefined,
              timeoutMs: typeof request.params.arguments.timeoutMs === 'number' ?
                request.params.arguments.timeoutMs : undefined,
            };
            const result = await this.athenaService.executeQuery(queryInput);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case "get_result": {
            if (!request.params.arguments?.queryExecutionId ||
                typeof request.params.arguments.queryExecutionId !== 'string') {
              throw new McpError(
                ErrorCode.InvalidParams,
                "Missing or invalid required parameter: queryExecutionId (string)"
              );
            }

            const maxRows = typeof request.params.arguments.maxRows === 'number' ?
              request.params.arguments.maxRows : undefined;
            const result = await this.athenaService.getQueryResults(
              request.params.arguments.queryExecutionId,
              maxRows
            );
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case "get_status": {
            if (!request.params.arguments?.queryExecutionId ||
                typeof request.params.arguments.queryExecutionId !== 'string') {
              throw new McpError(
                ErrorCode.InvalidParams,
                "Missing or invalid required parameter: queryExecutionId (string)"
              );
            }

            const status = await this.athenaService.getQueryStatus(
              request.params.arguments.queryExecutionId
            );
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(status, null, 2),
                },
              ],
            };
          }

          case "run_saved_query": {
            const args = request.params.arguments;
            if (!args || typeof args.namedQueryId !== 'string') {
              throw new McpError(
                ErrorCode.InvalidParams,
                "Missing required parameter: namedQueryId (string)"
              );
            }

            const result = await this.athenaService.executeNamedQuery(
              args.namedQueryId,
              typeof args.databaseOverride === 'string' ? args.databaseOverride : undefined,
              typeof args.maxRows === 'number' ? args.maxRows : undefined,
              typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined,
            );

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case "list_saved_queries": {
            const result = await this.athenaService.listNamedQueries();

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && "message" in error) {
          const athenaError = error as AthenaError;
          return {
            content: [
              {
                type: "text",
                text: `Error: ${athenaError.message}`,
              },
            ],
            isError: true,
          };
        }
        throw error;
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("AWS Athena MCP server running on stdio");
  }
}

const server = new AthenaServer();
server.run().catch(console.error);
