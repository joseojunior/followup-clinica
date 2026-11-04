import type { MetaStage, MetaUnit } from "./meta-core.ts";

export const consultingStageLabels: Record<MetaStage,string> = {
  conversation_started:"Conversa iniciada",lead_qualified:"Lead qualificado",payment_requested:"Pedido de sinal",
  payment_pending:"Pagamento pendente",payment_confirmed:"Pagamento confirmado",appointment_confirmed:"Agendamento com sinal",
};
export const consultingStateLabels:Record<string,string>={excluded:"Fora da produção",internal:"Somente interno",no_ctwa:"Sem CTWA",queued:"Na fila",preparing:"Validando destino",sending:"Enviando",accepted:"Recebido pela Meta",failed:"Falhou",unknown:"Entrega inconclusiva",test_ready:"Pronto para teste"};
export const dashboardStatuses=["all","accepted","pending","attention","no_ctwa","excluded","internal"] as const;
export type DashboardStatus=typeof dashboardStatuses[number];
export type DashboardFilters={unit:"all"|MetaUnit;days:number;scope:"real"|"tests";status:DashboardStatus;stage:"all"|MetaStage;day:string;search:string;page:number};
export function parseConsultingDashboardFilters(params:URLSearchParams):DashboardFilters {
  const unit=params.get("unit")||"all",scope=params.get("scope")||"real",status=params.get("status")||"all",stage=params.get("stage")||"all";
  const days=Number(params.get("days")||7),page=Number(params.get("page")||1),day=params.get("day")||"",search=(params.get("search")||"").trim();
  if(unit!=="all"&&unit!=="sender_1"&&unit!=="sender_2")throw new Error("Unidade inválida.");
  if(scope!=="real"&&scope!=="tests")throw new Error("Ambiente inválido.");
  if(![1,7,30,90].includes(days)||!Number.isInteger(page)||page<1||page>4000)throw new Error("Período ou página inválidos.");
  if(!dashboardStatuses.includes(status as DashboardStatus)||(stage!=="all"&&!Object.hasOwn(consultingStageLabels,stage)))throw new Error("Filtro de evento inválido.");
  if(day&&(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(+new Date(day))||new Date(day).toISOString().slice(0,10)!==day))throw new Error("Dia inválido.");
  if(search.length>100||/[\u0000-\u001f\u007f]/.test(search))throw new Error("Busca inválida; use até 100 caracteres.");
  return {unit,scope,days,page,day,search,status:status as DashboardStatus,stage:stage as DashboardFilters["stage"]};
}
export function effectiveConsultingState(event:{is_synthetic:boolean;test_state:string;production_state:string;event_type:MetaStage}) {
  if(event.event_type==="payment_pending"||event.event_type==="payment_confirmed")return "internal";
  return event.is_synthetic||event.test_state!=="new"?event.test_state==="new"?"test_ready":event.test_state:event.production_state;
}
export type ConsultingDashboard={
  updatedAt:string;summary:{received:number;accepted:number;pending:number;attention:number;excluded:number;noCtwa:number;purchaseValue:number};
  units:Array<{unit:MetaUnit;production_enabled:boolean;production_enabled_at:string|null;received:number;accepted:number;attention:number}>;
  daily:Array<{day:string;received:number;accepted:number;attention:number}>;
  stages:Array<{stage:MetaStage;events:number;conversations:number}>;
  campaigns:Array<{unit:MetaUnit;sourceId:string|null;campaign:string|null;events:number;accepted:number}>;
  total:number;events:Array<{id:string;unit:MetaUnit;event_type:MetaStage;occurred_at:string;reference:string;value:string|null;state:string;is_test:boolean;has_ctwa:boolean;attempts:number;source_id:string|null;attribution:Record<string,string>;result:Record<string,unknown>|null}>;
};
