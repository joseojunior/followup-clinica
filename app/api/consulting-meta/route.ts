import { NextResponse } from "next/server";
import { requireMetaAdmin } from "@/lib/meta-admin";
import { MetaInputError } from "@/lib/meta-events";
import { isMetaUnit } from "@/lib/meta-core";
import { readMetaEventBody } from "@/lib/meta-request";
import { consultingOverview, recordConsultingEvent, saveConsultingSettings, sendConsultingTest } from "@/lib/consulting-meta";
import { setConsultingProduction,setConsultingProductionPolicy } from "@/lib/consulting-production";
import { consultingEventName } from "@/lib/consulting-meta-core";
import { isMetaStage } from "@/lib/meta-core";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{"Cache-Control":"no-store"}});
export async function GET(request:Request) {
  if (!await requireMetaAdmin()) return json({error:"Entre no painel."},401);
  const unit=new URL(request.url).searchParams.get("unit");
  if (!isMetaUnit(unit)) return json({error:"Unidade inválida."},400);
  try { return json(await consultingOverview(unit)); }
  catch { return json({error:"Área de consultoria indisponível. Verifique as migrações 022 a 024."},503); }
}
export async function POST(request:Request) {
  const actor=await requireMetaAdmin();
  if (!actor) return json({error:"Entre no painel."},401);
  try {
    const body=JSON.parse(await readMetaEventBody(request));
    if (!body || !isMetaUnit(body.unit)) throw new MetaInputError("Unidade inválida.");
    if (body.action==="save") { await saveConsultingSettings(body.unit,body,actor); return json({message:"Configuração de teste salva."}); }
    if (body.action==="register") {
      if (body.confirmNonHealth!==true) throw new MetaInputError("Confirme que são dados novos de consultoria, sem dados de saúde ou registros antigos.");
      return json(await recordConsultingEvent({...body.event,is_synthetic:true},body.unit),202);
    }
    if (body.action==="test") return json(await sendConsultingTest(body.unit,body.eventId,actor,body.confirmNonHealth===true));
    if(body.action==="production"){
      if(typeof body.enabled!=="boolean")throw new MetaInputError("enabled deve ser booleano.");
      return json(await setConsultingProduction(body.unit,body.enabled,actor,body.confirmNonHealth===true));
    }
    if(body.action==="production_policy"){
      if(!isMetaStage(body.eventType)||!consultingEventName(body.eventType)||typeof body.enabled!=="boolean"||(body.enabled&&!body.confirmNonHealth))throw new MetaInputError("Tipo de evento/liberação inválidos.");
      return json(await setConsultingProductionPolicy(body.unit,body.eventType,body.enabled,actor));
    }
    throw new MetaInputError("Ação inválida.");
  } catch(e) {
    if (e instanceof MetaInputError) return json({error:e.message},e.status);
    if (e instanceof RangeError) return json({error:"Corpo excede 16 KB."},413);
    if (e instanceof SyntaxError) return json({error:"JSON inválido."},400);
    return json({error:"Não foi possível concluir a ação de consultoria."},503);
  }
}
