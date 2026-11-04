import "server-only";
import { randomBytes } from "node:crypto";
import { getFollowupPool, withTransaction } from "@/lib/followup-db";
import { decryptMetaSecret, encryptMetaSecret, metaEncryptionReady } from "@/lib/meta-secret";
import { classifyMetaDelivery, classifyMetaEvent, digest, duplicateMatches, equalDigest, extractAdDestination, protectedPhoneHash, metaEventName, type MetaStage, type MetaUnit, validateMetaInput } from "@/lib/meta-core";
import { validateMetaAssets, type MetaAssetValidation } from "@/lib/meta-asset-validation";

type UnitRow = {
  unit: MetaUnit; inbound_token_hash: string | null; encrypted_access_token: string | null;
  dataset_id: string | null; waba_id: string | null; enabled: boolean;
  enabled_at: Date | null; verified_at: Date | null; verified_number: string | null; capture_started_at: Date; updated_at: Date;
  asset_validation: MetaAssetValidation | null;
};
type PolicyRow = { unit: MetaUnit; event_type: MetaStage; approved: boolean; export_enabled: boolean; approved_by: string | null; approved_at: Date | null; enabled_at: Date | null };
type EventRow = { id: string; unit: MetaUnit; event_type: MetaStage; occurred_at: Date; encrypted_ctwa: string | null; state: string; attempts: number; auto_retry_count: number; source_event_id: string; chat_hash: string; ctwa_hash: string | null };

export class MetaInputError extends Error { constructor(message: string, public status = 400) { super(message); } }
const mode = () => process.env.META_EXPORT_MODE === "live" ? "live" : "record_only";
const graphVersion = () => {
  const value = process.env.META_GRAPH_API_VERSION?.trim();
  if (!value || !/^v\d+\.\d+$/.test(value)) throw new Error("Configure META_GRAPH_API_VERSION antes de testar ou enviar à Meta.");
  return value;
};

function maskChat(chat: string) {
  const tail = chat.replace(/\D/g, "").slice(-4);
  return tail ? `••••${tail}` : `••••${digest(chat).slice(0, 4)}`;
}

export async function authenticateN8nToken(header: string | null): Promise<MetaUnit | null> {
  const match = /^Bearer ([A-Za-z0-9_-]{32,150})$/.exec(header || "");
  if (!match) return null;
  const rows = await getFollowupPool().query<Pick<UnitRow, "unit" | "inbound_token_hash">>("SELECT unit, inbound_token_hash FROM followup.meta_unit_settings");
  // Hash and constant-time compare; the token, not JSON, determines the unit.
  return rows.rows.find((row) => row.inbound_token_hash && equalDigest(match[1], row.inbound_token_hash))?.unit || null;
}

export async function consumeIngestQuota(unit: MetaUnit) {
  const result = await getFollowupPool().query<{ request_count: number }>(
    `INSERT INTO followup.meta_ingest_rate(unit, minute_at, request_count)
     VALUES ($1, date_trunc('minute', now()), 1)
     ON CONFLICT (unit, minute_at) DO UPDATE SET request_count = followup.meta_ingest_rate.request_count + 1
     RETURNING request_count`, [unit],
  );
  return result.rows[0].request_count <= 120;
}

export async function recordMetaEvent(body: unknown, tokenUnit: MetaUnit) {
  let event: ReturnType<typeof validateMetaInput>;
  try { event = validateMetaInput(body); }
  catch (error) { throw new MetaInputError(error instanceof Error ? error.message : "Corpo inválido."); }
  if (event.unit !== tokenUnit) throw new MetaInputError("O token não pertence à unidade informada.", 403);
  const chatHash = digest(`${event.unit}:${event.chatId}`);
  const phoneHash = event.phone ? protectedPhoneHash(event.unit, event.phone, Buffer.from(process.env.AI_SETTINGS_ENCRYPTION_KEY || "", "base64")) : null;
  if (event.phone && !metaEncryptionReady()) throw new MetaInputError("Proteção de identidade indisponível no servidor.", 503);
  const inputParts: unknown[] = [chatHash,event.occurredAt.toISOString(),event.ctwaClid,event.sourceId,phoneHash];
  if (Object.keys(event.attribution).length) inputParts.push(event.attribution);
  const inputHash = digest(JSON.stringify(inputParts));
  const pool = getFollowupPool();
  const existing = await pool.query<EventRow & {input_hash: string | null}>(
    `SELECT input_hash,id, unit, event_type, source_event_id, chat_hash, occurred_at, ctwa_hash, state, attempts, encrypted_ctwa
     FROM followup.meta_events WHERE unit=$1 AND event_type=$2 AND source_event_id=$3`,
    [event.unit, event.eventType, event.sourceEventId],
  );
  if (existing.rows[0]) {
    const row = existing.rows[0];
    if ((row.input_hash && row.input_hash !== inputHash) || !duplicateMatches(row, { chatHash, occurredAt: event.occurredAt, ctwaClid: event.ctwaClid })) {
      throw new MetaInputError("source_event_id já foi usado com dados diferentes.", 409);
    }
    return { id: row.id, state: row.state, duplicate: true };
  }

  return withTransaction(async (client) => {
    // Serialize a contact's identity, click history and idempotency decisions.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [chatHash]);
    let identityConflict = false;
    if (phoneHash) {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [phoneHash]);
      await client.query("INSERT INTO followup.meta_contacts(unit,chat_hash,phone_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [event.unit, chatHash, phoneHash]);
      const contact = await client.query<{ phone_hash: string }>("SELECT phone_hash FROM followup.meta_contacts WHERE unit=$1 AND chat_hash=$2", [event.unit, chatHash]);
      if (contact.rows[0]?.phone_hash !== phoneHash) throw new MetaInputError("Telefone divergente para o mesmo chat.", 409);
      const matches = await client.query("SELECT 1 FROM followup.meta_contacts WHERE unit=$1 AND phone_hash=$2 AND chat_hash<>$3 LIMIT 1", [event.unit, phoneHash, chatHash]);
      identityConflict = Boolean(matches.rowCount);
    }
    if (event.ctwaClid) {
      const previous=await client.query<{source_id:string|null}>("SELECT source_id FROM followup.meta_clicks WHERE unit=$1 AND chat_hash=$2 AND ctwa_hash=$3",[event.unit,chatHash,digest(event.ctwaClid)]);
      if (previous.rows[0] && previous.rows[0].source_id!==event.sourceId) throw new MetaInputError("CTWA já registrado com outro source_id.",409);
      await client.query(
        `INSERT INTO followup.meta_clicks(unit, chat_hash, ctwa_hash, encrypted_ctwa, observed_at,source_id,attribution)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT (unit, chat_hash, ctwa_hash) DO NOTHING`,
        [event.unit, chatHash, digest(event.ctwaClid), encryptMetaSecret(event.ctwaClid), event.occurredAt, event.sourceId,JSON.stringify(event.attribution)],
      );
    }
    const click = await client.query<{ id: string; ctwa_hash: string; encrypted_ctwa: string; source_id: string | null; dataset_id: string | null; page_id: string | null; resolution_state: string }>(
      `SELECT id,ctwa_hash,encrypted_ctwa,source_id,dataset_id,page_id,resolution_state FROM followup.meta_clicks
       WHERE unit=$1 AND chat_hash=$2 AND observed_at <= $3 ORDER BY observed_at DESC LIMIT 1`,
      [event.unit, chatHash, event.occurredAt],
    );
    const ctwa = click.rows[0];
    const origin = ctwa ? "history" : null;
    const setting = await client.query<UnitRow>("SELECT * FROM followup.meta_unit_settings WHERE unit=$1", [event.unit]);
    const policy = await client.query<PolicyRow>("SELECT * FROM followup.meta_event_policy WHERE unit=$1 AND event_type=$2", [event.unit, event.eventType]);
    const config = setting.rows[0]; const rule = policy.rows[0];
    const historical = event.occurredAt < config.capture_started_at || event.occurredAt.getTime() < Date.now() - 7 * 86_400_000;
    const candidate = metaEventName(event.eventType) !== null;
    const classified = classifyMetaEvent({ hasCtwa: Boolean(ctwa), historical, candidate, live: mode() === "live", unitEnabled: config.enabled,
      unitEnabledAt: config.enabled_at, typeApproved: rule.approved, typeEnabled: rule.export_enabled, typeEnabledAt: rule.enabled_at,
      occurredAt: event.occurredAt, configured: Boolean(config.encrypted_access_token && config.waba_id && config.verified_at) });
    const exportEligible = classified.state === "queued";
    const state = exportEligible && (identityConflict || ctwa?.resolution_state !== "resolved") ? "awaiting_approval" : classified.state;
    const reason = identityConflict ? "Telefone associado a mais de um chat; revisão necessária" : state === "awaiting_approval" && exportEligible ? "Aguardando descoberta e validação do dataset" : classified.reason;
    const inserted = await client.query<{ id: string; state: string }>(
      `INSERT INTO followup.meta_events(unit,event_type,source_event_id,chat_hash,chat_mask,occurred_at,ctwa_hash,encrypted_ctwa,ctwa_origin,state,reason,next_attempt_at,click_id,phone_hash,identity_conflict,source_id,dataset_id,page_id,export_eligible_at_ingest)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CASE WHEN $10='queued' THEN now() ELSE NULL END,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (unit,event_type,source_event_id) DO NOTHING RETURNING id,state`,
      [event.unit, event.eventType, event.sourceEventId, chatHash, maskChat(event.chatId), event.occurredAt, ctwa?.ctwa_hash || null, ctwa?.encrypted_ctwa || null, origin, state, reason,ctwa?.id || null,phoneHash,identityConflict,ctwa?.source_id || null,ctwa?.dataset_id || null,ctwa?.page_id || null,exportEligible],
    );
    if (inserted.rows[0]) {
      await client.query("UPDATE followup.meta_events SET input_hash=$2,attribution=$3::jsonb WHERE id=$1", [inserted.rows[0].id,inputHash,JSON.stringify(event.attribution)]);
      return { ...inserted.rows[0], duplicate: false };
    }
    const raced = await client.query<EventRow & {input_hash: string | null}>(
      "SELECT input_hash,id, unit, event_type, source_event_id, chat_hash, occurred_at, ctwa_hash, state, attempts, encrypted_ctwa FROM followup.meta_events WHERE unit=$1 AND event_type=$2 AND source_event_id=$3",
      [event.unit, event.eventType, event.sourceEventId],
    );
    const row = raced.rows[0];
    if ((row.input_hash && row.input_hash !== inputHash) || !duplicateMatches(row, { chatHash, occurredAt: event.occurredAt, ctwaClid: event.ctwaClid })) throw new MetaInputError("source_event_id já foi usado com dados diferentes.", 409);
    return { id: row.id, state: row.state, duplicate: true };
  });
}

export async function getMetaOverview(unit: MetaUnit | "all", days: number, search: string) {
  const pool = getFollowupPool();
  const params = [unit === "all" ? null : unit, days, search.trim().slice(0, 80)];
  const where = "($1::text IS NULL OR unit=$1) AND occurred_at >= now()-($2::integer * interval '1 day')";
  const [settings, policies, stats, funnel, events] = await Promise.all([
    pool.query<UnitRow>("SELECT * FROM followup.meta_unit_settings ORDER BY unit"),
    pool.query<PolicyRow>("SELECT * FROM followup.meta_event_policy ORDER BY unit,event_type"),
    pool.query<{ state: string; count: string }>(`SELECT state,count(*)::text AS count FROM followup.meta_events WHERE ${where} GROUP BY state`, params.slice(0, 2)),
    pool.query<{ event_type: MetaStage; count: string }>(`SELECT event_type,count(*)::text AS count FROM followup.meta_events WHERE ${where} GROUP BY event_type`, params.slice(0, 2)),
    pool.query<{ id: string; unit: MetaUnit; event_type: MetaStage; state: string; reason: string | null; occurred_at: Date; created_at: Date; attempts: number; chat_mask: string; ctwa_origin: string | null; fbtrace_id: string | null }>(
      `SELECT id,unit,event_type,state,reason,occurred_at,created_at,attempts,chat_mask,ctwa_origin,fbtrace_id,source_id,dataset_id,page_id,identity_conflict
       FROM followup.meta_events WHERE ${where} AND ($3='' OR chat_mask ILIKE '%'||$3||'%' OR source_event_id ILIKE '%'||$3||'%')
       ORDER BY occurred_at DESC LIMIT 100`, params),
  ]);
  const counts = Object.fromEntries(stats.rows.map((row) => [row.state, Number(row.count)]));
  return {
    mode: mode(), encryptionReady: metaEncryptionReady(), graphVersionConfigured: /^v\d+\.\d+$/.test(process.env.META_GRAPH_API_VERSION?.trim() || ""),
    ingestUrl: process.env.META_INGEST_PUBLIC_URL?.trim() || null,
    counts: { received: Object.values(counts).reduce((a, b) => a + b, 0), noCtwa: counts.no_ctwa || 0, awaitingApproval: counts.awaiting_approval || 0, queued: (counts.queued || 0) + (counts.sending || 0), accepted: counts.accepted || 0, failed: counts.failed || 0 },
    funnel: Object.fromEntries(funnel.rows.map((row) => [row.event_type, Number(row.count)])),
    events: events.rows,
    units: settings.rows.map((row) => ({ unit: row.unit, enabled: row.enabled, verifiedAt: row.verified_at, datasetId: row.dataset_id, wabaId: row.waba_id,
      assetValidation: row.asset_validation,
      tokenConfigured: Boolean(row.encrypted_access_token), inboundTokenConfigured: Boolean(row.inbound_token_hash), updatedAt: row.updated_at,
      policies: policies.rows.filter((policy) => policy.unit === row.unit).map((policy) => ({ eventType: policy.event_type, approved: policy.approved, exportEnabled: policy.export_enabled, approvedBy: policy.approved_by, approvedAt: policy.approved_at })) })),
  };
}

export async function rotateInboundToken(unit: MetaUnit, actor: string) {
  const token = `mt_${randomBytes(32).toString("base64url")}`;
  await withTransaction(async (client) => {
    await client.query("UPDATE followup.meta_unit_settings SET inbound_token_hash=$2, updated_at=now() WHERE unit=$1", [unit, digest(token)]);
    await client.query("INSERT INTO followup.meta_admin_audit(unit,action,actor) VALUES($1,'rotate_inbound_token',$2)", [unit, actor]);
  });
  return token;
}

export async function saveMetaUnit(unit: MetaUnit, input: { datasetId?: unknown; wabaId?: unknown; accessToken?: unknown; enabled?: unknown }, actor: string) {
  const dataset = typeof input.datasetId === "string" ? input.datasetId.trim() || null : null;
  const waba = typeof input.wabaId === "string" ? input.wabaId.trim() : null;
  const token = typeof input.accessToken === "string" ? input.accessToken.trim() : "";
  if (dataset !== null && !/^\d{5,30}$/.test(dataset)) throw new MetaInputError("Dataset ID deve conter somente dígitos.");
  if (waba !== null && !/^\d{5,30}$/.test(waba)) throw new MetaInputError("WABA ID deve conter somente dígitos.");
  if (input.accessToken !== undefined && (!token || token.length > 2000 || /\s/.test(token))) throw new MetaInputError("Token Meta inválido.");
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw new MetaInputError("enabled deve ser booleano.");
  if (token && !metaEncryptionReady()) throw new MetaInputError("Chave de criptografia indisponível no servidor.", 503);
  await withTransaction(async (client) => {
    const stored = await client.query<UnitRow>("SELECT * FROM followup.meta_unit_settings WHERE unit=$1 FOR UPDATE", [unit]);
    if (input.enabled === true && !stored.rows[0]?.verified_at) throw new MetaInputError("Teste dataset, WABA e número antes de habilitar a unidade.", 409);
    await client.query(
      `UPDATE followup.meta_unit_settings SET
       dataset_id=CASE WHEN $6 THEN $2 ELSE dataset_id END, waba_id=COALESCE($3,waba_id),
       encrypted_access_token=COALESCE($4,encrypted_access_token),
       enabled=CASE WHEN $6 OR $3 IS NOT NULL OR $4 IS NOT NULL THEN false ELSE COALESCE($5,enabled) END,
       enabled_at=CASE WHEN $6 OR $3 IS NOT NULL OR $4 IS NOT NULL OR $5=false THEN NULL WHEN $5=true AND enabled=false THEN now() ELSE enabled_at END,
       verified_at=CASE WHEN $6 OR $3 IS NOT NULL OR $4 IS NOT NULL THEN NULL ELSE verified_at END,
       verified_number=CASE WHEN $6 OR $3 IS NOT NULL OR $4 IS NOT NULL THEN NULL ELSE verified_number END,
       asset_validation=CASE WHEN $6 OR $3 IS NOT NULL OR $4 IS NOT NULL THEN NULL ELSE asset_validation END,
       updated_at=now() WHERE unit=$1`,
      [unit, dataset, waba, token ? encryptMetaSecret(token) : null, input.enabled ?? null,input.datasetId!==undefined],
    );
    await client.query("INSERT INTO followup.meta_admin_audit(unit,action,actor) VALUES($1,$2,$3)", [unit, input.enabled === undefined ? "save_credentials" : input.enabled ? "enable_unit" : "disable_unit", actor]);
    if (token || waba) await client.query("UPDATE followup.meta_clicks SET resolution_state='pending',resolution_attempts=0,next_resolution_at=now() WHERE unit=$1 AND resolution_state='review' AND source_id IS NOT NULL", [unit]);
  });
}

export async function setMetaPolicy(unit: MetaUnit, stage: MetaStage, action: "approve" | "enable" | "disable", actor: string, privacyReviewConfirmed: boolean) {
  if (action !== "disable" && !metaEventName(stage)) throw new MetaInputError("Agendamento e pagamento permanecem somente internos nesta versão.");
  if (action === "approve" && !privacyReviewConfirmed) throw new MetaInputError("Confirme a revisão de privacidade e dos Termos da Meta antes de aprovar.");
  await withTransaction(async (client) => {
    if (action === "approve") {
      await client.query("UPDATE followup.meta_event_policy SET approved=true, approved_by=$3, approved_at=now(), updated_at=now() WHERE unit=$1 AND event_type=$2", [unit, stage, actor]);
    } else if (action === "enable") {
      const result = await client.query(
        "UPDATE followup.meta_event_policy SET export_enabled=true, enabled_at=now(), updated_at=now() WHERE unit=$1 AND event_type=$2 AND approved=true RETURNING unit", [unit, stage],
      );
      if (!result.rowCount) throw new MetaInputError("A etapa precisa ser aprovada antes de habilitar a exportação.", 409);
    } else {
      await client.query("UPDATE followup.meta_event_policy SET export_enabled=false, enabled_at=NULL, updated_at=now() WHERE unit=$1 AND event_type=$2", [unit, stage]);
    }
    await client.query("INSERT INTO followup.meta_admin_audit(unit,action,actor,event_type) VALUES($1,$2,$3,$4)", [unit, `${action}_event`, actor, stage]);
  });
}

export async function retryMetaEvent(id: string, actor: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new MetaInputError("Evento inválido.");
  return withTransaction(async (client) => {
    const row = await client.query<EventRow>(
      "SELECT id,unit,event_type,occurred_at,encrypted_ctwa,state,attempts,source_event_id,chat_hash,ctwa_hash FROM followup.meta_events WHERE id=$1 FOR UPDATE", [id],
    );
    const event = row.rows[0];
    const destination=await client.query("SELECT 1 FROM followup.meta_events e JOIN followup.meta_clicks c ON c.id=e.click_id WHERE e.id=$1 AND e.export_eligible_at_ingest AND NOT e.identity_conflict AND c.resolution_state='resolved' AND e.dataset_id=c.dataset_id",[id]);
    if (!event || !destination.rowCount || event.state !== "failed" || !event.encrypted_ctwa || !metaEventName(event.event_type)) throw new MetaInputError("Só falhas elegíveis com CTWA e dataset validado podem ser reprocessadas.", 409);
    if (event.occurred_at.getTime() < Date.now() - 7 * 86_400_000) throw new MetaInputError("Evento fora da janela de 7 dias.", 409);
    const check = await client.query(
      `SELECT 1 FROM followup.meta_unit_settings s JOIN followup.meta_event_policy p ON p.unit=s.unit
       JOIN followup.senders snd ON snd.code=s.unit
       WHERE s.unit=$1 AND p.event_type=$2 AND s.enabled AND p.approved AND p.export_enabled
       AND s.enabled_at <= $3 AND p.enabled_at <= $3 AND s.waba_id IS NOT NULL AND s.encrypted_access_token IS NOT NULL
       AND s.verified_at IS NOT NULL AND regexp_replace(COALESCE(snd.whatsapp_number,''),'[^0-9]','','g')=s.verified_number`,
      [event.unit, event.event_type, event.occurred_at],
    );
    if (mode() !== "live" || !check.rowCount) throw new MetaInputError("A unidade e o tipo precisam estar habilitados, aprovados e em modo live.", 409);
    await client.query("UPDATE followup.meta_events SET state='queued',auto_retry_count=0,reason=NULL,next_attempt_at=now(),updated_at=now() WHERE id=$1", [id]);
    await client.query("INSERT INTO followup.meta_admin_audit(unit,action,actor,event_type,event_id) VALUES($1,'retry_event',$2,$3,$4)", [event.unit, actor, event.event_type, id]);
    return { queued: true };
  });
}

export async function testMetaConfiguration(unit: MetaUnit, actor: string, sourceId?: unknown) {
  // This diagnostic cannot authorize export or mutate event/click queues.
  if (mode() !== "record_only") throw new MetaInputError("Este diagnóstico exige META_EXPORT_MODE=record_only no servidor.", 409);
  if (sourceId !== undefined && (typeof sourceId !== "string" || (sourceId.trim() !== "" && !/^\d{5,30}$/.test(sourceId.trim())))) {
    throw new MetaInputError("sourceId deve conter somente dígitos (5 a 30) ou ficar vazio para usar o último anúncio desta unidade.");
  }
  const pool = getFollowupPool();
  const row = await pool.query<UnitRow>("SELECT * FROM followup.meta_unit_settings WHERE unit=$1", [unit]);
  const setting = row.rows[0];
  if (!setting) throw new MetaInputError("Unidade não configurada.", 404);
  const selected = typeof sourceId === "string" ? sourceId.trim() : "";
  const captured = await pool.query<{ source_id: string }>(
    `SELECT source_id FROM followup.meta_clicks WHERE unit=$1 AND source_id IS NOT NULL
     AND ($2='' OR source_id=$2) ORDER BY created_at DESC LIMIT 1`, [unit, selected]);
  const report = await validateMetaAssets({
    accessToken: setting.encrypted_access_token ? decryptMetaSecret(setting.encrypted_access_token) : null,
    graphVersion: process.env.META_GRAPH_API_VERSION?.trim() || null,
    sourceId: selected || captured.rows[0]?.source_id || null, sourceBelongsToUnit: Boolean(captured.rowCount),
  });
  await withTransaction(async (client) => {
    // A credential rotation during the network calls invalidates this result.
    const saved = await client.query(
      `UPDATE followup.meta_unit_settings SET asset_validation=$2::jsonb
       WHERE unit=$1 AND encrypted_access_token IS NOT DISTINCT FROM $3 RETURNING unit`,
      [unit, JSON.stringify(report), setting.encrypted_access_token]);
    if (!saved.rowCount) throw new MetaInputError("O token mudou durante o teste. Execute novamente com a credencial atual.", 409);
    await client.query("INSERT INTO followup.meta_admin_audit(unit,action,actor) VALUES($1,'test_assets_read_only',$2)", [unit, actor]);
  });
  return report;
}

function readWabaDataset(payload: unknown): string | null {
  const obj = payload as {id?: unknown; data?: Array<{id?: unknown}>};
  const ids = obj?.data ? obj.data.map((row) => row.id) : [obj?.id];
  return ids.length === 1 && typeof ids[0] === "string" && /^\d{5,30}$/.test(ids[0]) ? ids[0] : null;
}

/** Read-only Graph discovery also runs in record_only; never posts events. */
export async function resolveMetaDestinations(limit = 2) {
  const pool = getFollowupPool();
  let resolved = 0;
  for (let i=0;i<Math.min(limit,20);i++) {
    const click = await withTransaction(async (c) => {
      const r=await c.query<{id:string;unit:MetaUnit;source_id:string|null;resolution_attempts:number}>(
        "SELECT id,unit,source_id,resolution_attempts FROM followup.meta_clicks WHERE resolution_state='pending' AND next_resolution_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1");
      if (!r.rows[0]) return null;
      await c.query("UPDATE followup.meta_clicks SET next_resolution_at=now()+interval '5 minutes',resolution_attempts=resolution_attempts+1 WHERE id=$1",[r.rows[0].id]);
      return r.rows[0];
    });
    if (!click) break;
    let datasetId:string|null=null; let pageId:string|null=null; let reason:string|null=null; let transient=false;
    try {
      const config=(await pool.query<UnitRow>("SELECT * FROM followup.meta_unit_settings WHERE unit=$1",[click.unit])).rows[0];
      if (!click.source_id) throw new Error("source_id ausente");
      if (!config.encrypted_access_token || !config.waba_id || !config.verified_at) throw new Error("Configure e teste token/WABA da unidade");
      const token=decryptMetaSecret(config.encrypted_access_token);
      const read=async (path:string) => {
        const response=await fetch(`https://graph.facebook.com/${graphVersion()}/${path}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(5000),cache:"no-store"});
        if (!response.ok) { transient=response.status===429 || response.status>=500; throw new Error(`Graph HTTP ${response.status}; verificar acesso ao anúncio e WABA`); }
        return response.json();
      };
      const destination=extractAdDestination(await read(`${click.source_id}?fields=tracking_specs`));
      const wabaDataset=readWabaDataset(await read(`${config.waba_id}/dataset?fields=id`));
      if (!wabaDataset || wabaDataset!==destination.datasetId || (config.dataset_id && config.dataset_id!==destination.datasetId)) throw new Error("Dataset do anúncio não corresponde à WABA/unidade");
      datasetId=destination.datasetId; pageId=destination.pageId;
    } catch(error) {
      reason=error instanceof Error ? error.message : "Falha na descoberta";
      if (error instanceof Error && ["TimeoutError","AbortError","TypeError"].includes(error.name)) { transient=true; reason="Rede indisponível na descoberta"; }
    }
    const state=datasetId ? "resolved" : transient && click.resolution_attempts<4 ? "pending" : "review";
    await withTransaction(async (c)=>{
      await c.query("UPDATE followup.meta_clicks SET dataset_id=$2,page_id=$3,resolution_state=$4,resolution_reason=$5,next_resolution_at=now()+interval '5 minutes' WHERE id=$1",[click.id,datasetId,pageId,state,reason]);
      await c.query(`UPDATE followup.meta_events SET dataset_id=$2,page_id=$3,
        state=CASE WHEN $2::text IS NOT NULL AND $4 AND export_eligible_at_ingest AND NOT identity_conflict AND state='awaiting_approval' THEN 'queued' ELSE state END,
        next_attempt_at=CASE WHEN $2::text IS NOT NULL AND $4 AND export_eligible_at_ingest AND NOT identity_conflict AND state='awaiting_approval' THEN now() ELSE next_attempt_at END,
        reason=CASE WHEN identity_conflict OR state IN ('no_ctwa','internal_only','accepted','failed') THEN reason WHEN $2::text IS NULL THEN $5 ELSE NULL END,updated_at=now()
        WHERE click_id=$1`,[click.id,datasetId,pageId,mode()==="live",reason]);
    });
    if (datasetId) resolved++;
  }
  return {resolved};
}

export async function dispatchMetaEvents(limit = 20) {
  const pool = getFollowupPool();
  await pool.query("DELETE FROM followup.meta_ingest_rate WHERE minute_at < now() - interval '2 days'");
  const discovery=await resolveMetaDestinations();
  if (mode() !== "live") return { mode: "record_only", processed: 0, ...discovery };
  await pool.query("UPDATE followup.meta_events SET state='queued',next_attempt_at=now(),reason='Tentativa interrompida; reenviar com mesmo event_id' WHERE state='sending' AND updated_at < now()-interval '5 minutes'");
  const results = { mode: "live", processed: 0, accepted: 0, failed: 0, retried: 0 };
  for (let index = 0; index < Math.min(Math.max(limit, 1), 50); index++) {
    const event = await withTransaction(async (client) => {
      const row = await client.query<EventRow & {dataset_id:string|null;identity_conflict:boolean;export_eligible_at_ingest:boolean}>(
        `SELECT id,unit,event_type,occurred_at,encrypted_ctwa,state,attempts,auto_retry_count,source_event_id,chat_hash,ctwa_hash,dataset_id,identity_conflict,export_eligible_at_ingest
         FROM followup.meta_events WHERE state='queued' AND next_attempt_at<=now()
         ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 1`,
      );
      if (!row.rows[0]) return null;
      await client.query("UPDATE followup.meta_events SET state='sending',attempts=attempts+1,auto_retry_count=auto_retry_count+1,updated_at=now() WHERE id=$1", [row.rows[0].id]);
      return row.rows[0];
    });
    if (!event) break;
    results.processed++;
    const settings = await pool.query<UnitRow>("SELECT * FROM followup.meta_unit_settings WHERE unit=$1", [event.unit]);
    const policies = await pool.query<PolicyRow>("SELECT * FROM followup.meta_event_policy WHERE unit=$1 AND event_type=$2", [event.unit, event.event_type]);
    const setting = settings.rows[0]; const policy = policies.rows[0];
    const currentNumber = await pool.query<{ whatsapp_number: string | null }>("SELECT whatsapp_number FROM followup.senders WHERE code=$1", [event.unit]);
    const numberStillMatches = Boolean(setting?.verified_number && setting.verified_number === (currentNumber.rows[0]?.whatsapp_number || "").replace(/\D/g, ""));
    const conflict=await pool.query("SELECT 1 FROM followup.meta_contacts a JOIN followup.meta_contacts b ON a.unit=b.unit AND a.phone_hash=b.phone_hash AND a.chat_hash<>b.chat_hash WHERE a.unit=$1 AND a.chat_hash=$2 LIMIT 1",[event.unit,event.chat_hash]);
    const permitted = !conflict.rowCount && !event.identity_conflict && event.export_eligible_at_ingest && numberStillMatches && setting?.verified_at && setting.enabled && setting.enabled_at && event.occurred_at >= setting.enabled_at && setting.encrypted_access_token && event.dataset_id && setting.waba_id &&
      policy?.approved && policy.export_enabled && policy.enabled_at && event.occurred_at >= policy.enabled_at && event.encrypted_ctwa && metaEventName(event.event_type);
    if (!permitted) {
      await pool.query("UPDATE followup.meta_events SET state='awaiting_approval',reason='Configuração ou aprovação removida',next_attempt_at=NULL,updated_at=now() WHERE id=$1", [event.id]);
      continue;
    }
    let httpStatus: number | null = null; let trace: string | null = null; let errorCode: string | null = null; let eventsReceived = 0;
    try {
      if (event.occurred_at.getTime() < Date.now() - 7 * 86_400_000) throw new Error("outside_meta_window");
      const linked=await fetch(`https://graph.facebook.com/${graphVersion()}/${setting.waba_id}/dataset?fields=id`,{headers:{Authorization:`Bearer ${decryptMetaSecret(setting.encrypted_access_token!)}`},signal:AbortSignal.timeout(10000),cache:"no-store"});
      if (!linked.ok || readWabaDataset(await linked.json())!==event.dataset_id) { httpStatus=400; throw new Error("Vínculo WABA/dataset não confirmado"); }
      const response = await fetch(`https://graph.facebook.com/${graphVersion()}/${event.dataset_id}/events`, {
        method: "POST", headers: { Authorization: `Bearer ${decryptMetaSecret(setting.encrypted_access_token! )}`, "content-type": "application/json" },
        body: JSON.stringify({ data: [{ event_name: metaEventName(event.event_type), event_time: Math.floor(event.occurred_at.getTime() / 1000), event_id: event.id,
          action_source: "business_messaging", messaging_channel: "whatsapp", user_data: { ctwa_clid: decryptMetaSecret(event.encrypted_ctwa!), whatsapp_business_account_id: setting.waba_id } }] }),
        signal: AbortSignal.timeout(15_000), cache: "no-store",
      });
      httpStatus = response.status;
      const payload = await response.json().catch(() => ({})) as { events_received?: number; fbtrace_id?: string; error?: { code?: number } };
      trace = payload.fbtrace_id || response.headers.get("x-fb-trace-id");
      errorCode = payload.error?.code ? String(payload.error.code) : null;
      eventsReceived = Number(payload.events_received) || 0;
    } catch (error) { errorCode = error instanceof Error ? error.message.slice(0, 80) : "network_error"; }
    const nextState = classifyMetaDelivery({ httpStatus, eventsReceived, errorCode, autoRetryCount: event.auto_retry_count });
    const delay = Math.min(3600, 30 * 2 ** event.auto_retry_count);
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE followup.meta_events SET state=$2,reason=$3,fbtrace_id=$4,next_attempt_at=CASE WHEN $2='queued' THEN now()+($5::integer * interval '1 second') ELSE NULL END,
         accepted_at=CASE WHEN $2='accepted' THEN now() ELSE accepted_at END,updated_at=now() WHERE id=$1`,
        [event.id, nextState, nextState === "accepted" ? null : errorCode || `HTTP ${httpStatus || "sem resposta"}`, trace, delay],
      );
      await client.query("INSERT INTO followup.meta_delivery_attempts(event_id,http_status,outcome,error_code,fbtrace_id) VALUES($1,$2,$3,$4,$5)", [event.id, httpStatus, nextState, errorCode, trace]);
    });
    if (nextState === "accepted") results.accepted++; else if (nextState === "queued") results.retried++; else results.failed++;
  }
  return results;
}
