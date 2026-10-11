import { z } from 'zod';
import {
  stageSchema,
  pushSchema,
  memorySchema,
  querySchema,
} from '../../src/lib/server/contracts';
import { mkdir } from 'node:fs/promises';
const out = process.argv[2] ?? '/data/contracts';
await mkdir(out, { recursive: true });
for (const [name, schema] of Object.entries({
  stage: stageSchema,
  push: pushSchema,
  memory: memorySchema,
  query: querySchema,
}))
  await Bun.write(
    `${out}/${name}.schema.json`,
    JSON.stringify(z.toJSONSchema(schema), null, 2),
  );
