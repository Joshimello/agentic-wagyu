import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { config } from '../config';
import * as schema from './schema';
export const sqlClient = postgres(config.databaseUrl,{max:8,connect_timeout:10});
export const db = drizzle(sqlClient,{schema});
