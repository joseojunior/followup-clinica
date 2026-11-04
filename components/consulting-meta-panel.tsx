"use client";
import { useEffect,useState } from "react";
import type { MetaStage,MetaUnit } from "@/lib/meta-core";

const stages: Record<MetaStage,string>={conversation_started:"Conversa iniciada → LeadSubmitted",lead_qualified:"Interessado em agendar → QualifiedLead",payment_requested:"Pedido de sinal → InitiateCheckout",payment_pending:"Pagamento pendente → interno",payment_confirmed:"Pagamento confirmado → interno",appointment_confirmed:"Agendamento com sinal pago → Purchase"};
type Overview={productionAvailable:boolean;settings:{page_id:string|null;dataset_id:string|null;test_code:string;capture_started_at:string;production_enabled:boolean;production_enabled_at:string|null};policies:Array<{event_type:MetaStage;enabled:boolean}>;events:Array<{id:string;event_type:MetaStage;occurred_at:string;reference:string;value:string|null;test_state:string;test_result:Record<string,unknown>|null;is_synthetic:boolean;production_eligible:boolean;production_state:string;production_result:Record<string,unknown>|null}>};
const productionStates:Record<string,string>={excluded:"Fora da produção",internal:"Somente interno",no_ctwa:"Sem CTWA",queued:"Na fila",preparing:"Validando destino",sending:"Enviando",accepted:"Recebido pela Meta",failed:"Falhou",unknown:"Revisar entrega"};
function sample(unit:MetaUnit,stage:MetaStage) {
  return JSON.stringify({context:"consulting_v1",unit,is_synthetic:true,chat_id:"CHAT_NOVO_DE_CONSULTORIA",event_type:stage,source_event_id:"ID_ESTAVEL_DA_MUDANCA",occurred_at:new Date().toISOString(),
    ...(stage==="conversation_started"?{source_id:"123456789012345",ctwa_clid:"CTWA_DA_NOVA_CONVERSA",phone:"+5511999999999",name:"Nome Exemplo"}:{}),
    ...(stage==="appointment_confirmed"?{deposit_paid:true,transaction_id:"ID_REAL_DA_TRANSACAO",value:50}:{})},null,2);
}
export function ConsultingMetaPanel({unit}:{unit:MetaUnit}) {
  const [data,setData]=useState<Overview|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  const [pageId,setPageId]=useState(""),[datasetId,setDatasetId]=useState(""),[testCode,setTestCode]=useState("TEST28037");
  const [stage,setStage]=useState<MetaStage>("conversation_started"),[body,setBody]=useState(""),[confirmed,setConfirmed]=useState(false);
  async function load() {
    const r=await fetch(`/api/consulting-meta?unit=${unit}`,{cache:"no-store"});const b=await r.json();
    if (!r.ok) throw new Error(b.error||"Falha de leitura.");
    setData(b);setPageId(b.settings.page_id||"");setDatasetId(b.settings.dataset_id||"");setTestCode(b.settings.test_code);
  }
  useEffect(()=>{setData(null);setConfirmed(false);setMessage("");setBody(sample(unit,"conversation_started"));setStage("conversation_started");void load().catch(e=>setMessage(e.message));},[unit]);
  async function action(action:string,extra:Record<string,unknown>={}) {
    setBusy(true);setMessage("");
    try {
      const r=await fetch("/api/consulting-meta",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,unit,confirmNonHealth:confirmed,...extra})});
      const b=await r.json();if(!r.ok)throw new Error(b.error||"Ação indisponível.");
      setMessage(b.reason||b.message||(action==="register"?"Registrado internamente. Nenhum evento foi enviado.":"Concluído."));
      if(action==="register")setBody(sample(unit,stage));
      await load();
    } catch(e){setMessage(e instanceof Error?e.message:"JSON ou ação inválida.");}finally{setBusy(false);}
  }
  const live=Boolean(data?.settings.production_enabled);
  return <section className="meta-config consulting-meta-panel" aria-label="Eventos de consultoria">
    <div className="meta-section-head"><div><h3>Consultoria · {live?"envio automático":"testes e ativação"}</h3><p>Somente novos serviços não relacionados à saúde. Histórico antigo e testes nunca entram na fila de produção.</p></div><span className="meta-state">{live?"Produção ativa":"Produção pausada"}</span></div>
    <div className="meta-config-grid"><div className="meta-config-form">
      <h4>Destino e código de teste</h4>
      <p>Usa o token Meta salvo acima para esta unidade. O anúncio novo tem prioridade; IDs manuais só completam informações ausentes. Pause a produção antes de trocar o destino.</p>
      <label>page_id manual · fallback<input value={pageId} inputMode="numeric" onChange={e=>setPageId(e.target.value)} disabled={busy||live}/></label>
      <label>Dataset / pixel ID manual · fallback<input value={datasetId} inputMode="numeric" onChange={e=>setDatasetId(e.target.value)} disabled={busy||live}/></label>
      <label>test_event_code<input value={testCode} onChange={e=>setTestCode(e.target.value)} disabled={busy}/></label>
      <button className="secondary-button" disabled={busy||!data} onClick={()=>void action("save",{pageId,datasetId,testCode})}>Salvar configuração de teste</button>
      <p>O código de teste não é uma sandbox: os dados chegam à Meta. Confirme no Gerenciador de Eventos e use contatos próprios de teste, não exemplos fictícios como identificadores reais.</p>
      <label className="meta-toggle"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy}/>Confirmo novos dados de consultoria, sem saúde ou histórico antigo, e autorizo o envio ao testar ou liberar produção.</label>
      <button className="secondary-button" disabled={busy||!data||(!live&&(!confirmed||!data.productionAvailable))} onClick={()=>void action("production",{enabled:!live})}>{live?"Pausar envio automático nesta unidade":"Liberar envio automático nesta unidade"}</button>
      {!data?.productionAvailable&&<small>Envio automático bloqueado no servidor.</small>}
      <p>{live&&data?.settings.production_enabled_at?`Corte de produção: ${new Date(data.settings.production_enabled_at).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}. `:"Ao liberar, um novo corte temporal é registrado. "}Somente conversas novas após esse corte podem enviar. Pausar e reativar não recupera registros anteriores. A liberação exige os quatro testes aceitos neste destino nos últimos sete dias.</p>
      {live&&<fieldset disabled={busy}><legend>Tipos de evento desta unidade</legend>{data?.policies.map(policy=><label className="meta-toggle" key={policy.event_type}><input type="checkbox" checked={policy.enabled} disabled={!policy.enabled&&!confirmed} onChange={e=>void action("production_policy",{eventType:policy.event_type,enabled:e.target.checked})}/>{stages[policy.event_type]}</label>)}</fieldset>}
    </div><div className="meta-config-form">
      <h4>Registrar um acontecimento de teste</h4>
      <p>Este formulário sempre marca o registro como sintético, mesmo sem is_synthetic no JSON. Eventos reais devem chegar pelo n8n.</p>
      <label>Etapa<select value={stage} disabled={busy} onChange={e=>{const s=e.target.value as MetaStage;setStage(s);setBody(sample(unit,s));}}>{Object.entries(stages).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label>JSON de entrada · substitua os exemplos<textarea rows={15} value={body} disabled={busy} onChange={e=>setBody(e.target.value)} spellCheck={false}/></label>
      <button className="secondary-button" disabled={busy||!data||!confirmed} onClick={()=>{try{void action("register",{event:JSON.parse(body)});}catch{setMessage("JSON inválido.");}}}>Registrar sem enviar</button>
      <details className="meta-guide-detail"><summary>Como enviar pelo n8n</summary><p>POST HTTPS para <code>/api/integrations/n8n/consulting-events</code>, com o mesmo Bearer exclusivo da unidade criado no guia abaixo. Corpo: o JSON deste formulário com os dados reais; remova is_synthetic ou use false apenas em acontecimentos reais. Use true nos testes. context=consulting_v1 é obrigatório. Não redirecione o fluxo antigo para esta URL.</p><p>202 = registrado, não entregue; 200 = duplicata; 409 = conflito de IDs ou ausência de nova conversa. productionState informa fila, exclusão ou etapa interna. Repita falhas de rede/5xx com exatamente os mesmos IDs, corpo e horário. Eventos reais só entram na fila automática quando a unidade e o tipo estão ativos e a conversa começou depois do corte. Testes sintéticos e registros antigos nunca são enviados em produção.</p><p>Na primeira conversa, envie CTWA, source_id do anúncio e opcionalmente phone/name. Telefone e nome são guardados como SHA-256; CTWA fica criptografado. attribution é opcional e só interno: utm_source, utm_medium, utm_campaign, utm_content, utm_term, ad_title, source_url e thumbnail_url. URLs HTTPS; sem dados pessoais nas UTMs. Nos próximos marcos envie apenas context, unit, chat_id, event_type, source_event_id e occurred_at; a identidade vem da conversa armazenada.</p><p>Purchase exige deposit_paid=true e transaction_id estável; value é opcional, padrão R$ 50. payment_pending e payment_confirmed são internos e não duplicam Purchase. Não use o ID de execução do n8n como identificador de negócio. Timeout ou resposta inconclusiva da Meta exige revisão, sem repetição automática.</p></details>
    </div></div>
    {message&&<p className="meta-feedback" role="status">{message}</p>}
    <div className="meta-section-head"><h3>Novos eventos desta unidade</h3><button className="secondary-button" disabled={busy} onClick={()=>void load().catch(e=>setMessage(e.message))}>Atualizar consultoria</button></div>
    <div className="meta-log-list">{data?.events.length?data.events.map(event=><article key={event.id}><time>{new Date(event.occurred_at).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}</time><div><strong>{stages[event.event_type]}</strong><small>Referência {event.reference}{event.value!==null?` · R$ ${Number(event.value).toFixed(2)}`:""}{event.is_synthetic?" · Teste sintético":""}</small></div><span className="meta-state">{event.production_eligible?productionStates[event.production_state]:event.test_state!=="new"?`Teste · ${event.test_state}`:productionStates[event.production_state]}</span><small>{(event.production_result?.reason||event.test_result?.reason) as string||"Apenas registrado"}</small>{!event.production_eligible&&["conversation_started","lead_qualified","payment_requested","appointment_confirmed"].includes(event.event_type)&&event.test_state==="new"?<button className="secondary-button" disabled={busy||!confirmed} onClick={()=>void action("test",{eventId:event.id})}>Enviar teste à Meta</button>:<small>{event.production_eligible?"Envio controlado pelo worker":"Sem reenvio automático"}</small>}{(event.production_result||event.test_result)&&<details className="meta-guide-detail"><summary>{event.production_result?"Resultado de produção":"Resultado do teste"}</summary><pre>{JSON.stringify(event.production_result||event.test_result,null,2)}</pre></details>}</article>):<p className="meta-empty">Nenhum novo evento de consultoria. Registre primeiro a nova conversa; o histórico antigo não aparece aqui.</p>}</div>
  </section>;
}
