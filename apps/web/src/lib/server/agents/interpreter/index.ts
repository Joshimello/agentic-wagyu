import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { assets, uploads, runs, revisions } from '../../db/schema';
import { assetPath } from '../../storage';
import { validateStage, type Stage } from '../../contracts';

export async function interpret(runId: string) {
  const [run]=await db.select().from(runs).where(eq(runs.id,runId));
  if (!run || run.revisionId || run.state==='canceled') return;
  await db.update(runs).set({state:'processing',progress:'Extracting source',attempts:sql`${runs.attempts}+1`,error:null,updatedAt:new Date()}).where(eq(runs.id,runId));
  try {
    const [input]=await db.select().from(uploads).innerJoin(assets,eq(uploads.assetId,assets.id)).where(eq(uploads.id,run.uploadId));
    const raw=input.assets, upload=input.uploads;
    if (!/\.(txt|md|csv|json)$/i.test(upload.filename)) throw new Error('This file adapter is not available yet. Your original is preserved; retry after the adapter is installed.');
    const text=await Bun.file(assetPath(raw.storageKey)).text();
    const stage:Stage={schemaVersion:1,id:crypto.randomUUID(),uploadId:upload.id,rawAssetId:raw.id,parentRevisionId:upload.currentRevisionId,createdAt:new Date().toISOString(),metadata:upload.metadata,
      primitives:[{id:crypto.randomUUID(),kind:'text',role:'native',text,speaker:null,locator:{kind:'text',start:0,end:text.length}}],annotations:[],coverage:{complete:true,durationMs:null,warnings:[]},provenance:{adapter:'text-1',model:null,modelRevision:null,promptVersion:null}};
    validateStage(stage);
    await db.transaction(async tx=>{
      const [locked]=await tx.select().from(runs).where(eq(runs.id,runId)).for('update');
      if (locked.revisionId) return;
      await tx.insert(revisions).values({id:stage.id,uploadId:upload.id,runId,parentRevisionId:stage.parentRevisionId,manifest:stage});
      await tx.update(uploads).set({currentRevisionId:stage.id}).where(eq(uploads.id,upload.id));
      await tx.update(runs).set({state:'ready',progress:'Ready for review',revisionId:stage.id,updatedAt:new Date()}).where(eq(runs.id,runId));
    });
  } catch (error) {
    await db.update(runs).set({state:'failed',progress:'Interpretation failed',error:error instanceof Error?error.message:'Interpretation failed',updatedAt:new Date()}).where(eq(runs.id,runId));
    throw error;
  }
}
