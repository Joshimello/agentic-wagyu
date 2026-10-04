import OpenAI from 'openai';
export function llmClient() {
  if(!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL || !process.env.OPENAI_BASE_URL) throw new Error('Configure the server LLM credentials before visual interpretation');
  return {client:new OpenAI({apiKey:process.env.OPENAI_API_KEY,baseURL:process.env.OPENAI_BASE_URL,timeout:120000,maxRetries:1}),model:process.env.OPENAI_MODEL};
}
