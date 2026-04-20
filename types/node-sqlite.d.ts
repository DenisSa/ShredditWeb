declare module "node:sqlite" {
  export type SQLiteValue = string | number | bigint | Uint8Array | null;

  export class StatementSync {
    run(...values: SQLiteValue[]): {
      changes: number | bigint;
      lastInsertRowid: number | bigint;
    };
    get<T = Record<string, SQLiteValue>>(...values: SQLiteValue[]): T | undefined;
    all<T = Record<string, SQLiteValue>>(...values: SQLiteValue[]): T[];
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
