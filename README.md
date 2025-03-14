# @lishenxydlgzs/aws-athena-mcp
[![smithery badge](https://smithery.ai/badge/@lishenxydlgzs/aws-athena-mcp)](https://smithery.ai/server/@lishenxydlgzs/aws-athena-mcp)

A Model Context Protocol (MCP) server for running AWS Athena queries. This server enables AI assistants to execute SQL queries against your AWS Athena databases and retrieve results.

<a href="https://glama.ai/mcp/servers/0i7dhkex6t">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/0i7dhkex6t/badge" alt="aws-athena-mcp MCP server" />
</a>

## Usage

1. Configure AWS credentials using one of the following methods:
   - AWS CLI configuration
   - Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
   - IAM role (if running on AWS)

2. Add the server to your MCP configuration:

```json
{
  "mcpServers": {
    "athena": {
      "command": "npx",
      "args": ["-y", "@lishenxydlgzs/aws-athena-mcp"],
      "env": {
        // Required
        "OUTPUT_S3_PATH": "s3://your-bucket/athena-results/",
        
        // Optional AWS configuration
        "AWS_REGION": "us-east-1",                    // Default: AWS CLI default region
        "AWS_PROFILE": "default",                     // Default: 'default' profile
        "AWS_ACCESS_KEY_ID": "",                      // Optional: AWS access key
        "AWS_SECRET_ACCESS_KEY": "",                  // Optional: AWS secret key
        "AWS_SESSION_TOKEN": "",                      // Optional: AWS session token
        
        // Optional server configuration
        "QUERY_TIMEOUT_MS": "300000",                // Default: 5 minutes (300000ms)
        "MAX_RETRIES": "100",                        // Default: 100 attempts
        "RETRY_DELAY_MS": "500"                      // Default: 500ms between retries
      }
    }
  }
}
```

3. The server provides the following tools:

- `run_query`: Execute a SQL query using AWS Athena
  - Parameters:
    - database: The Athena database to query
    - query: SQL query to execute
    - maxRows: Maximum number of rows to return (default: 1000, max: 10000)
  - Returns:
    - If query completes within timeout: Full query results
    - If timeout reached: Only the queryExecutionId for later retrieval

- `get_status`: Check the status of a query execution
  - Parameters:
    - queryExecutionId: The ID returned from run_query
  - Returns:
    - state: Query state (QUEUED, RUNNING, SUCCEEDED, FAILED, or CANCELLED)
    - stateChangeReason: Reason for state change (if any)
    - submissionDateTime: When the query was submitted
    - completionDateTime: When the query completed (if finished)
    - statistics: Query execution statistics (if available)

- `get_result`: Retrieve results for a completed query
  - Parameters:
    - queryExecutionId: The ID returned from run_query
    - maxRows: Maximum number of rows to return (default: 1000, max: 10000)
  - Returns:
    - Full query results if the query has completed successfully
    - Error if query failed or is still running

## Usage Examples

### Show All Databases
Message to AI Assistant:
```List all databases in Athena```

MCP parameter:
```json
{
  "database": "default",
  "query": "SHOW DATABASES"
}
```

### List Tables in a Database
Message to AI Assistant:
```Show me all tables in the default database```

MCP parameter:
```json
{
  "database": "default",
  "query": "SHOW TABLES"
}
```

### Get Table Schema
Message to AI Assistant:
```What's the schema of the asin_sitebestimg table?```

MCP parameter:
```json
{
  "database": "default",
  "query": "DESCRIBE default.asin_sitebestimg"
}
```

### Table Rows Preview
Message to AI Assistant:
```Show some rows from my_database.mytable```

MCP parameter:
```json
{
  "database": "my_database",
  "query": "SELECT * FROM my_table LIMIT 10",
  "maxRows": 10
}
```

### Advanced Query with Filtering and Aggregation
Message to AI Assistant:
```Find the average price by category for in-stock products```

MCP parameter:
```json
{
  "database": "my_database",
  "query": "SELECT category, COUNT(*) as count, AVG(price) as avg_price FROM products WHERE in_stock = true GROUP BY category ORDER BY count DESC",
  "maxRows": 100
}
```

### Checking Query Status
```json
{
  "queryExecutionId": "12345-67890-abcdef"
}
```

### Getting Results for a Completed Query
```json
{
  "queryExecutionId": "12345-67890-abcdef",
  "maxRows": 10
}
```
## Requirements

- Node.js >= 16
- AWS credentials with appropriate Athena permissions
- S3 bucket for query results

## License

MIT

## Repository

[GitHub Repository](https://github.com/lishenxydlgzs/aws-athena-mcp)