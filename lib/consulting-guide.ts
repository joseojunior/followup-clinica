import type { MetaStage, MetaUnit } from "./meta-core.ts";
export function buildConsultingGuideCurl(url:string,sample:string){
  const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
  return [
    "curl --request POST "+quote(url),
    "  --header 'Authorization: Bearer SEU_TOKEN_DA_UNIDADE'",
    "  --header 'Content-Type: application/json'",
    "  --data-raw "+quote(sample),
  ].join(" \\" + "\n");
}
export function buildConsultingGuideSample(unit:MetaUnit,stage:MetaStage,timestamp:string,synthetic=true){
  return {context:"consulting_v1",unit,is_synthetic:synthetic,chat_id:"CHAT_REAL_DO_CONTATO",event_type:stage,
    source_event_id:stage==="conversation_started"?"ID_REAL_DA_MENSAGEM":stage==="appointment_confirmed"?"ID_REAL_DO_AGENDAMENTO":"ID_ESTAVEL_DESTA_MUDANCA",occurred_at:timestamp,
    ...(stage==="conversation_started"?{ctwa_clid:"CTWA_REAL_DO_REFERRAL",source_id:"123456789012345",phone:"+5511999999999",name:"Nome Sobrenome",attribution:{utm_source:"facebook",utm_medium:"paid",utm_campaign:"consultoria_exemplo",ad_title:"Titulo do anuncio",source_url:"https://example.com/anuncio",thumbnail_url:"https://example.com/imagem.jpg"}}:{}),
    ...(stage==="appointment_confirmed"?{deposit_paid:true,transaction_id:"ID_REAL_DA_TRANSACAO_DO_SINAL",value:50}:{})};
}
