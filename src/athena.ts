import {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  QueryExecutionState,
  GetQueryExecutionCommandOutput,
  InvalidRequestException,
  ListNamedQueriesCommand,
  BatchGetNamedQueryCommand,
  GetNamedQueryCommand
} from "@aws-sdk/client-athena";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { QueryInput, QueryResult, QueryStatus, AthenaError } from "./types.js";

export class AthenaService {
  private client: AthenaClient;
  private outputLocation: string;
  private workGroup?: string;

  constructor() {
    if (!process.env.OUTPUT_S3_PATH) {
      throw new Error("OUTPUT_S3_PATH environment variable is required");
    }

    this.outputLocation = process.env.OUTPUT_S3_PATH;
    this.workGroup = process.env.ATHENA_WORKGROUP;

    const profile = process.env.AWS_PROFILE;
    this.client = new AthenaClient({
      credentials: defaultProvider({
        profile: profile
      }),
      region: process.env.AWS_REGION,
    });
  }

  async executeQuery(input: QueryInput): Promise<QueryResult | { queryExecutionId: string }> {
    try {
      // Start query execution
      const startResponse = await this.client.send(
        new StartQueryExecutionCommand({
          QueryString: input.query,
          QueryExecutionContext: {
            Database: input.database,
          },
          ResultConfiguration: {
            OutputLocation: this.outputLocation,
          },
          ...(this.workGroup && { WorkGroup: this.workGroup })
        })
      );

      if (!startResponse.QueryExecutionId) {
        throw new Error("Failed to start query execution");
      }

      const timeoutMs = input.timeoutMs || 60000; // Default 60 second timeout
      const startTime = Date.now();

      try {
        // Wait for query completion or timeout
        const queryExecution = await this.waitForQueryCompletion(
          startResponse.QueryExecutionId,
          100,
          timeoutMs
        );

        // If we got here, query completed before timeout
        return await this.getQueryResults(startResponse.QueryExecutionId, input.maxRows);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error) {
          const athenaError = error as AthenaError;
          if (athenaError.code === "TIMEOUT") {
            // Return just the execution ID on timeout
            return { queryExecutionId: startResponse.QueryExecutionId };
          }
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof InvalidRequestException) {
        throw {
          message: error.message,
          code: "INVALID_REQUEST",
        };
      }
      throw error;
    }
  }

  async getQueryStatus(queryExecutionId: string): Promise<QueryStatus> {
    try {
      const response = await this.client.send(
        new GetQueryExecutionCommand({
          QueryExecutionId: queryExecutionId,
        })
      );

      if (!response.QueryExecution) {
        throw {
          message: "Query execution not found",
          code: "QUERY_NOT_FOUND",
        };
      }

      return {
        state: response.QueryExecution.Status?.State || "UNKNOWN",
        stateChangeReason: response.QueryExecution.Status?.StateChangeReason,
        statistics: {
          dataScannedInBytes: response.QueryExecution.Statistics?.DataScannedInBytes || 0,
          engineExecutionTimeInMillis: response.QueryExecution.Statistics?.EngineExecutionTimeInMillis || 0,
        },
        substatementType: response.QueryExecution.SubstatementType,
      };
    } catch (error) {
      if (error instanceof InvalidRequestException) {
        throw {
          message: "Query execution not found",
          code: "QUERY_NOT_FOUND",
        };
      }
      throw error;
    }
  }

  async getQueryResults(queryExecutionId: string, maxRows?: number): Promise<QueryResult> {
    try {
      // Check query state first
      const status = await this.getQueryStatus(queryExecutionId);

      if (status.state === QueryExecutionState.RUNNING || status.state === QueryExecutionState.QUEUED) {
        throw {
          message: "Query is still running",
          code: "QUERY_STILL_RUNNING",
          queryExecutionId,
        };
      }

      if (status.state === QueryExecutionState.FAILED) {
        throw {
          message: status.stateChangeReason || "Query failed",
          code: "QUERY_FAILED",
          queryExecutionId,
        };
      }

      if (status.state !== QueryExecutionState.SUCCEEDED) {
        throw {
          message: `Unexpected query state: ${status.state}`,
          code: "UNEXPECTED_STATE",
          queryExecutionId,
        };
      }

      const results = await this.client.send(
        new GetQueryResultsCommand({
          QueryExecutionId: queryExecutionId,
          MaxResults: maxRows || 1000,
        })
      );

      if (!results.ResultSet) {
        throw new Error("No results returned from query");
      }

      const columns = results.ResultSet.ResultSetMetadata?.ColumnInfo?.map(
        (col) => col.Name || ""
      ) || [];

      const rows = (results.ResultSet.Rows || [])
        .slice(status.substatementType === 'SELECT' ? 1 : 0) // Skip header row if query is SELECT
        .map((row) => {
          const obj: Record<string, unknown> = {};
          row.Data?.forEach((data, index) => {
            if (columns[index]) {
              obj[columns[index]] = data.VarCharValue;
            }
          });
          return obj;
        });

      return {
        columns,
        rows,
        queryExecutionId,
        bytesScanned: status.statistics?.dataScannedInBytes || 0,
        executionTime: status.statistics?.engineExecutionTimeInMillis || 0,
      };
    } catch (error) {
      if (error instanceof InvalidRequestException) {
        throw {
          message: "Query execution not found",
          code: "QUERY_NOT_FOUND",
        };
      }
      throw error;
    }
  }

  async listNamedQueries(): Promise<{ namedQueries: { id: string; name: string; description?: string }[] }> {
    const listResponse = await this.client.send(
      new ListNamedQueriesCommand({
        ...(this.workGroup && { WorkGroup: this.workGroup })
      })
    );

    if (!listResponse.NamedQueryIds || listResponse.NamedQueryIds.length === 0) {
      return { namedQueries: [] };
    }

    const batchResponse = await this.client.send(
      new BatchGetNamedQueryCommand({ NamedQueryIds: listResponse.NamedQueryIds })
    );

    const namedQueries = (batchResponse.NamedQueries || []).map((query) => ({
      id: query.NamedQueryId || "",
      name: query.Name || "",
      description: query.Description,
    }));

    return { namedQueries };
  }

  async executeNamedQuery(
    namedQueryId: string,
    databaseOverride?: string,
    maxRows?: number,
    timeoutMs?: number
  ): Promise<QueryResult | { queryExecutionId: string }> {
    const namedQueryResp = await this.client.send(
      new GetNamedQueryCommand({ NamedQueryId: namedQueryId })
    );

    if (!namedQueryResp.NamedQuery || !namedQueryResp.NamedQuery.QueryString) {
      throw {
        message: "Named query not found or empty",
        code: "NAMED_QUERY_NOT_FOUND",
      };
    }

    const queryInput: QueryInput = {
      query: namedQueryResp.NamedQuery.QueryString,
      database: databaseOverride || namedQueryResp.NamedQuery.Database || "",
      maxRows,
      timeoutMs,
    };

    return this.executeQuery(queryInput);
  }

  private async waitForQueryCompletion(
    queryExecutionId: string,
    maxAttempts = 100,
    timeoutMs?: number
  ): Promise<GetQueryExecutionCommandOutput> {
    let attempts = 0;
    const startTime = Date.now();

    while (attempts < maxAttempts) {
      if (timeoutMs && Date.now() - startTime >= timeoutMs) {
        throw {
          message: "Query timed out",
          code: "TIMEOUT",
          queryExecutionId,
        };
      }

      const response = await this.client.send(
        new GetQueryExecutionCommand({
          QueryExecutionId: queryExecutionId,
        })
      );

      const state = response.QueryExecution?.Status?.State;
      if (state === QueryExecutionState.SUCCEEDED) {
        return response;
      }

      if (
        state === QueryExecutionState.FAILED ||
        state === QueryExecutionState.CANCELLED
      ) {
        throw {
          message: response.QueryExecution?.Status?.StateChangeReason || "Query failed",
          code: "QUERY_FAILED",
          queryExecutionId,
        };
      }

      // Wait before checking again
      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempts++;
    }

    throw {
      message: "Query timed out",
      code: "TIMEOUT",
      queryExecutionId,
    };
  }
}
