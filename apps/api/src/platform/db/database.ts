import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Logger } from '@nestjs/common';
import pg from 'pg';

const PING_TIMEOUT_MS = 2_000;

export type Orm = NodePgDatabase<Record<string, never>>;
/** Transaction Drizzle; service nhận `tx` để tham gia cùng transaction. */
export type Tx = Parameters<Parameters<Orm['transaction']>[0]>[0];

export interface DatabaseOptions {
  connectionString: string;
  max?: number;
  applicationName?: string;
}

/** Truy cập DB dùng chung: pool `pg` + Drizzle, transaction luôn READ COMMITTED. */
export class Database {
  private static readonly logger = new Logger('Database');
  readonly pool: pg.Pool;
  readonly orm: Orm;

  constructor(options: DatabaseOptions) {
    this.pool = new pg.Pool({
      connectionString: options.connectionString,
      max: options.max ?? 10,
      connectionTimeoutMillis: 3_000,
      application_name: options.applicationName ?? 'tickee',
    });
    // Lỗi trên client rảnh không được làm sập tiến trình; chỉ log message + mã lỗi, không bao giờ log chuỗi kết nối.
    this.pool.on('error', (err: Error & { code?: string }) => {
      Database.logger.warn({ code: err.code, message: err.message }, 'Lỗi trên kết nối DB rảnh');
    });
    this.orm = drizzle({ client: this.pool, casing: 'snake_case' });
  }

  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.orm.transaction(fn, { isolationLevel: 'read committed' });
  }

  /** Kiểm DB sẵn sàng (`SELECT 1`). */
  async ping(): Promise<void> {
    // `query_timeout` theo từng truy vấn được `pg` hỗ trợ nhưng thiếu trong @types/pg.
    const ping: pg.QueryConfig & { query_timeout: number } = { text: 'SELECT 1', query_timeout: PING_TIMEOUT_MS };
    await this.pool.query(ping);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
