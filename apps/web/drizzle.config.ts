import { defineConfig } from 'drizzle-kit';
export default defineConfig({dialect:'postgresql',schema:'./src/lib/server/db/schema.ts',out:'./drizzle',dbCredentials:{url:process.env.DATABASE_URL ?? 'postgres://chronicler:local-only@database:5432/chronicler'}});
