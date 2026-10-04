import { eq } from 'drizzle-orm';
import { db } from '../../../../lib/server/db/client';
import { assets } from '../../../../lib/server/db/schema';
import { assetPath } from '../../../../lib/server/storage';
import { id } from '../../../../lib/server/contracts';
export async function GET({params,request}:{params:{id:string};request:Request}) {
  if(!id.safeParse(params.id).success) return new Response('Not found',{status:404});
  const [asset]=await db.select().from(assets).where(eq(assets.id,params.id));
  if(!asset) return new Response('Not found',{status:404});
  const file=Bun.file(assetPath(asset.storageKey));
  const inline=/^(video\/(mp4|webm|quicktime)|audio\/[\w.+-]+|image\/(jpeg|png|webp|gif)|text\/plain|application\/pdf)$/.test(asset.mime);
  const headers={'Content-Type':asset.mime,'Content-Disposition':inline?'inline':'attachment','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','Cache-Control':'private, max-age=3600'};
  const range=request.headers.get('range');
  if(range) {
    const m=/^bytes=(\d+)-(\d*)$/.exec(range);
    const start=m?Number(m[1]):-1, end=m?(m[2]?Number(m[2]):asset.bytes-1):-1;
    if(start<0||start>=asset.bytes||end<start||end>=asset.bytes) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${asset.bytes}`}});
    return new Response(file.slice(start,end+1),{status:206,headers:{...headers,'Content-Range':`bytes ${start}-${end}/${asset.bytes}`,'Content-Length':String(end-start+1)}});
  }
  return new Response(file,{headers:{...headers,'Content-Length':String(asset.bytes)}});
}
