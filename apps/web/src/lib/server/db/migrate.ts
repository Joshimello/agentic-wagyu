import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, sqlClient } from './client';
await migrate(db,{migrationsFolder:new URL('../../../../drizzle',import.meta.url).pathname});
await sqlClient.end();
