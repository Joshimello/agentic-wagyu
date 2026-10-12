import { sql } from 'drizzle-orm';
import { db } from '../db/client';

export async function processingRetryPending(
  runId: string,
  state: string,
  executor: Pick<typeof db, 'execute'> = db,
) {
  if (state !== 'failed') return false;
  try {
    const [schema] = await executor.execute<{ installed: boolean }>(
      sql`select to_regclass('pgboss.job') is not null as installed`,
    );
    if (!schema.installed) return false;
    const [delivery] = await executor.execute<{
      state: string;
      retry_count: number;
      retry_limit: number;
    }>(
      sql`select state,retry_count,retry_limit from pgboss.job where name='interpret' and data->>'runId'=${runId} order by created_on desc limit 1`,
    );
    return delivery &&
      (['created', 'retry'].includes(delivery.state) ||
        (delivery.state === 'active' &&
          delivery.retry_count < delivery.retry_limit))
      ? true
      : false;
  } catch {
    return false;
  }
}
