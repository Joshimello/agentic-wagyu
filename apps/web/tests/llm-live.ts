import OpenAI from 'openai';
const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY,baseURL:process.env.OPENAI_BASE_URL,timeout:120000});
const model=process.env.OPENAI_MODEL!;
const reply=await client.chat.completions.create({model,messages:[{role:'user',content:'Return exactly: compatible'}],temperature:0,max_tokens:64});
if(!reply.choices[0]?.message.content?.toLowerCase().includes('compatible'))throw new Error('SDK text response failed');
const stream=await client.chat.completions.create({model,messages:[{role:'user',content:'Return exactly: streaming works'}],max_tokens:64,stream:true});
let text='';for await(const chunk of stream) text+=chunk.choices[0]?.delta.content??'';
if(!text.includes('streaming works'))throw new Error('SDK stream failed');
console.log(JSON.stringify({sdk:'openai',model,text:true,streaming:true}));
