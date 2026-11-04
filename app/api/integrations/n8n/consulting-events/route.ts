import { NextResponse } from "next/server";
import { authenticateN8nToken,consumeIngestQuota,MetaInputError } from "@/lib/meta-events";
import { readMetaEventBody } from "@/lib/meta-request";
import { recordConsultingEvent } from "@/lib/consulting-meta";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{"Cache-Control":"no-store"}});
export async function POST(request:Request) {
  try {
    if (process.env.NODE_ENV==="production" && request.headers.get("x-forwarded-proto")!=="https" && new URL(request.url).protocol!=="https:") return json({error:"HTTPS obrigatório."},403);
    const unit=await authenticateN8nToken(request.headers.get("authorization"));
    if (!unit) return json({error:"Token inválido."},401);
    if (!await consumeIngestQuota(unit)) return NextResponse.json({error:"Limite por unidade excedido."},{status:429,headers:{"Retry-After":"60"}});
    const result=await recordConsultingEvent(JSON.parse(await readMetaEventBody(request)),unit);
    return json({...result,message:"Registrado; consulte productionState. 202 não confirma entrega à Meta."},result.duplicate?200:202);
  } catch(e) {
    if (e instanceof MetaInputError) return json({error:e.message},e.status);
    if (e instanceof RangeError) return json({error:"Corpo excede 16 KB."},413);
    if (e instanceof SyntaxError) return json({error:"JSON inválido."},400);
    return json({error:"Falha ao registrar consultoria; verifique migração e configuração."},503);
  }
}
