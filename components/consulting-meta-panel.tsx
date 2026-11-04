"use client";
import { useEffect,useState } from "react";
import type { MetaStage,MetaUnit } from "@/lib/meta-core";

const stages: Record<MetaStage,string>={conversation_started:"Conversa iniciada → LeadSubmitted",lead_qualified:"Interessado em agendar → QualifiedLead",payment_requested:"Pedido de sinal → InitiateCheckout",payment_pending:"Pagamento pendente → interno",payment_confirmed:"Pagamento confirmado → interno",appointment_confirmed:"Agendamento com sinal pago → Purchase"};
type Overview={settings:{page_id:string|null;dataset_id:string|null;test_code:string;capture_started_at:string};events:Array<{id:string;event_type:MetaStage;occurred_at:string;reference:string;value:string|null;test_state:string;test_result:Record<string,unknown>|null}>};
function sample(unit:MetaUnit,stage:MetaStage) {
  return JSON.stringify({context:"consulting_v1",unit,chat_id:"CHAT_NOVO_DE_CONSULTORIA",event_type:stage,source_event_id:"ID_ESTAVEL_DA_MUDANCA",occurred_at:new Date().toISOString(),
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
  return <section className="meta-config consulting-meta-panel" aria-label="Consultoria em homologação">
    <div className="meta-section-head"><div><h3>Consultoria · somente testes</h3><p>Área isolada para novos serviços não relacionados à saúde. Nenhum histórico anterior é importado e não há liberação de produção nesta versão.</p></div><span className="meta-state">Teste manual</span></div>
    <div className="meta-config-grid"><div className="meta-config-form">
      <h4>Destino e código de teste</h4>
      <p>Usa o token Meta salvo acima para esta unidade. O anúncio novo tem prioridade; IDs manuais só completam informações ausentes. IDs distintos no anúncio bloqueiam o teste.</p>
      <label>page_id manual · fallback<input value={pageId} inputMode="numeric" onChange={e=>setPageId(e.target.value)} disabled={busy}/></label>
      <label>Dataset / pixel ID manual · fallback<input value={datasetId} inputMode="numeric" onChange={e=>setDatasetId(e.target.value)} disabled={busy}/></label>
      <label>test_event_code<input value={testCode} onChange={e=>setTestCode(e.target.value)} disabled={busy}/></label>
      <button className="secondary-button" disabled={busy||!data} onClick={()=>void action("save",{pageId,datasetId,testCode})}>Salvar configuração de teste</button>
      <p>O código de teste não é uma sandbox: os dados chegam à Meta. Confirme no Gerenciador de Eventos e use contatos próprios de teste, não exemplos fictícios como identificadores reais.</p>
      <label className="meta-toggle"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy}/>Confirmo que são novos dados de consultoria, sem saúde ou histórico antigo, e autorizo o envio à Meta ao clicar em Enviar teste.</label>
      <button className="secondary-button" disabled title="Produção não implementada nesta etapa">Produção desativada</button>
    </div><div className="meta-config-form">
      <h4>Registrar um novo acontecimento</h4>
      <label>Etapa<select value={stage} disabled={busy} onChange={e=>{const s=e.target.value as MetaStage;setStage(s);setBody(sample(unit,s));}}>{Object.entries(stages).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label>JSON de entrada · substitua os exemplos<textarea rows={15} value={body} disabled={busy} onChange={e=>setBody(e.target.value)} spellCheck={false}/></label>
      <button className="secondary-button" disabled={busy||!data||!confirmed} onClick={()=>{try{void action("register",{event:JSON.parse(body)});}catch{setMessage("JSON inválido.");}}}>Registrar sem enviar</button>
      <details className="meta-guide-detail"><summary>Como enviar pelo n8n</summary><p>POST HTTPS para <code>/api/integrations/n8n/consulting-events</code>, com o mesmo Bearer exclusivo da unidade criado no guia abaixo. Corpo: o JSON deste formulário. O campo context=consulting_v1 é obrigatório. Não redirecione o fluxo antigo para esta URL.</p><p>202 = registro interno; 200 = duplicata; 409 = dados conflitantes, ausência de nova conversa ou tentativa de importar histórico. Repita erros de rede/5xx com os mesmos IDs e horário. O envio à Meta só acontece no botão de teste abaixo. Telefone/nome são opcionais, enviados somente no primeiro contato e guardados como SHA-256; CTWA fica criptografado.</p><p>Purchase exige sinal confirmado e ID da transação; o valor padrão é R$ 50. Pagamento confirmado sozinho não gera outra compra. Em cada teste, os identificadores novos são vinculados à conversa desta área, nunca ao banco antigo.</p></details>
    </div></div>
    {message&&<p className="meta-feedback" role="status">{message}</p>}
    <div className="meta-section-head"><h3>Novos eventos desta unidade</h3><button className="secondary-button" disabled={busy} onClick={()=>void load().catch(e=>setMessage(e.message))}>Atualizar consultoria</button></div>
    <div className="meta-log-list">{data?.events.length?data.events.map(event=><article key={event.id}><time>{new Date(event.occurred_at).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}</time><div><strong>{stages[event.event_type]}</strong><small>Referência {event.reference}{event.value!==null?` · R$ ${Number(event.value).toFixed(2)}`:""}</small></div><span className="meta-state">{event.test_state}</span><small>{event.test_result?.reason as string||"Apenas registrado"}</small>{["conversation_started","lead_qualified","payment_requested","appointment_confirmed"].includes(event.event_type)&&event.test_state==="new"?<button className="secondary-button" disabled={busy||!confirmed} onClick={()=>void action("test",{eventId:event.id})}>Enviar teste à Meta</button>:<small>Sem reenvio automático</small>}{event.test_result&&<details className="meta-guide-detail"><summary>Resultado do teste</summary><pre>{JSON.stringify(event.test_result,null,2)}</pre></details>}</article>):<p className="meta-empty">Nenhum novo evento de consultoria. Registre primeiro a nova conversa; o histórico antigo não aparece aqui.</p>}</div>
  </section>;
}
