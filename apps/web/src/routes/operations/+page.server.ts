import { usageSummary } from '../../lib/server/llm/usage';
export async function load() {
  return { usage: await usageSummary() };
}
