import OpenAI from 'openai';
import { modelFetch, modelTimeoutMs } from './fallback';
export function llmClient() {
  if (
    !process.env.OPENAI_API_KEY ||
    !process.env.OPENAI_MODEL ||
    !process.env.OPENAI_BASE_URL
  )
    throw new Error(
      'Configure the server LLM credentials before visual interpretation',
    );
  return {
    client: new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
      timeout: modelTimeoutMs(),
      maxRetries: 1,
      fetch: modelFetch(),
    }),
    model: process.env.OPENAI_MODEL,
  };
}
