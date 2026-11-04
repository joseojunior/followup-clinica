export type OperationalDashboardData={
  campaigns:{total:number;active:number};enrollments:{total:number;active:number;attention:number};
  messages:{sent_today:number;queued:number;failed:number};
  controls:{total:number;pending:number;in_progress:number;completed:number;followups_done:number;with_source_stage:number;source_stages_observed:number};
  recent:Array<{id:string;state:string;scheduled_at:string;sent_at:string|null;source_chat_id:string;source_name:string;campaign_name:string;activity_at:string}>;
  daily:Array<{day:string;sent:number;failed:number;simulated:number}>;sendMode:"live"|"dry_run";updatedAt:string;
};
export function parseOperationalPeriod(params:URLSearchParams){
  const days=Number(params.get("days")||7),day=params.get("day")||"";
  if(![7,30].includes(days))throw new Error("Período inválido.");
  if(day&&(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(+new Date(day))||new Date(day).toISOString().slice(0,10)!==day))throw new Error("Dia inválido.");
  return {days,day};
}
