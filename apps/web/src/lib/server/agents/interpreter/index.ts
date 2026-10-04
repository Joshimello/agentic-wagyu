import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { assets, uploads, runs, revisions } from '../../db/schema';
import { assetPath } from '../../storage';
import { validateStage, type Stage } from '../../contracts';
import { buildVideo } from './video';

export async function interpret(runId: string) {
  const [run]=await db.select().from(runs).where(eq(runs.id,runId));
  if (!run || run.revisionId || run.state==='canceled') return;
  await db.update(runs).set({state:'processing',progress:'Extracting source',attempts:sql`${runs.attempts}+1`,error:null,updatedAt:new Date()}).where(eq(runs.id,runId));
  try {
    const [input]=await db.select().from(uploads).innerJoin(assets,eq(uploads.assetId,assets.id)).where(eq(uploads.id,run.uploadId));
    const raw=input.assets, upload=input.uploads;
    let stage:Stage={schemaVersion:1,id:crypto.randomUUID(),uploadId:upload.id,rawAssetId:raw.id,parentRevisionId:upload.currentRevisionId,createdAt:new Date().toISOString(),metadata:upload.metadata,
      primitives:[],annotations:[],coverage:{complete:true,durationMs:null,warnings:[]},provenance:{adapter:'text-1',model:null,modelRevision:null,promptVersion:null}};
    if (/\.(txt|md|csv|json)$/i.test(upload.filename)) {
      const text=await Bun.file(assetPath(raw.storageKey)).text();
      stage.primitives.push({id:crypto.randomUUID(),kind:'text',role:'native',text,speaker:null,locator:{kind:'text',start:0,end:text.length}});
    } else if (/\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(upload.filename)) {
      stage=await buildVideo(stage,raw.storageKey,runId,async progress=>{await db.update(runs).set({progress,updatedAt:new Date()}).where(eq(runs.id,runId));});
    } else throw new Error('This file adapter is not available yet. Your original is preserved; retry after the adapter is installed.');
    validateStage(stage);
    await db.transaction(async tx=>{
      const [locked]=await tx.select().from(runs).where(eq(runs.id,runId)).for('update');
      if (locked.revisionId) return;
      const [current]=await tx.select().from(uploads).where(eq(uploads.id,upload.id)).for('update');
      if(current.currentRevisionId===stage.parentRevisionId) await tx.update(uploads).set({currentRevisionId:stage.id}).where(eq(uploads.id,upload.id));
      else stage.coverage.warnings.push('A newer correction remains current; this interpretation is available in revision history.');
      await tx.insert(revisions).values({id:stage.id,uploadId:upload.id,runId,parentRevisionId:stage.parentRevisionId,manifest:stage});
      await tx.update(runs).set({state:stage.coverage.warnings.length?'ready_with_warnings':'ready',progress:'Ready for review',revisionId:stage.id,updatedAt:new Date()}).where(eq(runs.id,runId));
    });
  } catch (error) {
    await db.update(runs).set({state:'failed',progress:'Interpretation failed',error:error instanceof Error?error.message:'Interpretation failed',updatedAt:new Date()}).where(eq(runs.id,runId));
    throw error;
  }
}
