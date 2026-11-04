import { NextResponse } from "next/server";
import { requireMetaAdmin } from "@/lib/meta-admin";
import { parseConsultingDashboardFilters } from "@/lib/consulting-dashboard-core";
import { consultingDashboard } from "@/lib/consulting-dashboard";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
export async function GET(request:Request){
  if(!await requireMetaAdmin())return json({error:"Entre no painel para consultar os eventos."},401);
  let filters;
  try{filters=parseConsultingDashboardFilters(new URL(request.url).searchParams);}catch(e){return json({error:e instanceof Error?e.message:"Filtros inválidos."},400);}
  try{return json(await consultingDashboard(filters));}catch{return json({error:"Não foi possível consultar o dashboard. Tente atualizar; se persistir, confira a conexão com o banco e as migrações 023/024."},503);}
}
