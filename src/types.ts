export interface QueryInput {
  database: string;
  query: string;
  maxRows?: number;
  timeoutMs?: number;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  queryExecutionId: string;
  bytesScanned: number;
  executionTime: number;
}

export interface QueryStatus {
  state: string;
  stateChangeReason?: string;
  statistics?: {
    dataScannedInBytes: number;
    engineExecutionTimeInMillis: number;
  };
  substatementType?: string;
}

export interface AthenaError {
  message: string;
  code: string;
  queryExecutionId?: string;
}
