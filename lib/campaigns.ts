import { getFollowupPool, withTransaction } from "@/lib/followup-db";

export const sourceCodes = ["usuarios_sdr", "clinica_nova"] as const;
export type SourceCode = (typeof sourceCodes)[number];
export type SenderRule = "sender_1" | "sender_2" | "balanced";
export type RotationRule = "sequential" | "random" | "no_repeat";
export type ContentMode = "text" | "sticker_text" | "image_text" | "sequence";

export type CampaignStepInput = {
  /** Preferência atual da interface. */
  delayHours?: number;
  /** Compatibilidade com campanhas criadas antes do suporte a horas. */
  delayDays?: number;
  /** Valor normalizado internamente após validar a entrada. */
  delayMinutes?: number;
  contentMode: ContentMode;
  senderRule: SenderRule;
  rotationRule: RotationRule;
  variants: Array<{ textTemplate?: string; mediaUrl?: string }>;
};

export type CreateCampaignInput = {
  name: string;
  sourceCode: SourceCode;
  status: "active" | "draft";
  autoEnroll: boolean;
  steps: CampaignStepInput[];
};

export type UpdateCampaignInput = CreateCampaignInput & { metadataOnly?: boolean };

export function validateCampaignInput(value: unknown): CreateCampaignInput {
  if (!value || typeof value !== "object") throw new Error("Dados da campanha inválidos.");
  const input = value as Partial<CreateCampaignInput>;
  const name = input.name?.trim();
  if (!name || name.length > 120) throw new Error("Informe um nome de campanha com até 120 caracteres.");
  if (!sourceCodes.includes(input.sourceCode as SourceCode)) throw new Error("Fonte de leads inválida.");
  if (input.status !== "active" && input.status !== "draft") throw new Error("Status da campanha inválido.");
  if (typeof input.autoEnroll !== "boolean") throw new Error("Configuração de gatilho inválida.");
  if (!Array.isArray(input.steps) || input.steps.length === 0 || input.steps.length > 12) {
    throw new Error("A campanha deve ter entre 1 e 12 etapas.");
  }

  const validContentModes: ContentMode[] = ["text", "sticker_text", "image_text", "sequence"];
  const validSenderRules: SenderRule[] = ["sender_1", "sender_2", "balanced"];
  const validRotationRules: RotationRule[] = ["sequential", "random", "no_repeat"];
  const steps = input.steps.map((step) => {
    const delayHours = step.delayHours === undefined
      ? Number(step.delayDays) * 24
      : Number(step.delayHours);
    if (!Number.isInteger(delayHours) || delayHours < 1 || delayHours > 90 * 24) {
      throw new Error("O atraso precisa estar entre 1 hora e 90 dias.");
    }
    if (!validContentModes.includes(step.contentMode)) throw new Error("Tipo de conteúdo inválido.");
    if (!validSenderRules.includes(step.senderRule)) throw new Error("Regra de remetente inválida.");
    if (!validRotationRules.includes(step.rotationRule)) throw new Error("Regra de rotação inválida.");
    if (!Array.isArray(step.variants) || step.variants.length > 8) throw new Error("Uma etapa pode ter até 8 variações de conteúdo.");
    const variants = step.variants.map((variant) => {
      const textTemplate = variant.textTemplate?.trim() || undefined;
      const mediaUrl = variant.mediaUrl?.trim() || undefined;
      if (!textTemplate && !mediaUrl) throw new Error("A variação precisa ter texto ou mídia.");
      if (textTemplate && textTemplate.length > 4_000) throw new Error("O texto da variação é muito longo.");
      return { textTemplate, mediaUrl };
    });
    return { delayMinutes: delayHours * 60, contentMode: step.contentMode, senderRule: step.senderRule, rotationRule: step.rotationRule, variants };
  });

  return { name, sourceCode: input.sourceCode as SourceCode, status: input.status, autoEnroll: input.autoEnroll, steps };
}

export async function createCampaign(input: CreateCampaignInput) {
  return withTransaction(async (client) => {
    const sourceResult = await client.query("SELECT id FROM followup.sources WHERE code = $1 AND is_active = true", [input.sourceCode]);
    if (!sourceResult.rowCount) throw new Error("Fonte de leads indisponível.");

    const campaignResult = await client.query(
      `INSERT INTO followup.campaigns (source_id, name, status, auto_enroll, trigger_mode)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, status, created_at`,
      [sourceResult.rows[0].id, input.name, input.status, input.autoEnroll, input.autoEnroll ? "eligible_source_lead" : "manual"],
    );
    const campaign = campaignResult.rows[0];

    for (const [index, step] of input.steps.entries()) {
      const stepResult = await client.query(
        `INSERT INTO followup.campaign_steps
          (campaign_id, step_order, delay_minutes, content_mode, sender_rule, rotation_rule)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [campaign.id, index + 1, step.delayMinutes ?? 0, step.contentMode, step.senderRule, step.rotationRule],
      );
      const stepId = stepResult.rows[0]?.id;
      // INSERT acima não precisa retornar ID quando não há conteúdo; o ID é consultado abaixo para manter o SQL simples.
      const persistedStep = stepId ? stepId : (await client.query(
        "SELECT id FROM followup.campaign_steps WHERE campaign_id = $1 AND step_order = $2",
        [campaign.id, index + 1],
      )).rows[0].id;
      for (const [variantIndex, variant] of step.variants.entries()) {
        const contentType = step.contentMode === "text" ? "text" : step.contentMode === "sticker_text" ? "sticker" : step.contentMode === "image_text" ? "image" : "sequence";
        await client.query(
          `INSERT INTO followup.content_variants (step_id, variant_order, content_type, text_template, media_url)
           VALUES ($1, $2, $3, $4, $5)`,
          [persistedStep, variantIndex + 1, contentType, variant.textTemplate ?? null, variant.mediaUrl ?? null],
        );
      }
    }
    return { id: campaign.id, name: campaign.name, status: campaign.status, createdAt: campaign.created_at };
  });
}

async function insertCampaignSteps(client: import("pg").PoolClient, campaignId: string, steps: CampaignStepInput[]) {
  for (const [index, step] of steps.entries()) {
    const stepResult = await client.query(
      `INSERT INTO followup.campaign_steps
        (campaign_id, step_order, delay_minutes, content_mode, sender_rule, rotation_rule)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [campaignId, index + 1, step.delayMinutes ?? 0, step.contentMode, step.senderRule, step.rotationRule],
    );
    for (const [variantIndex, variant] of step.variants.entries()) {
      const contentType = step.contentMode === "text" ? "text" : step.contentMode === "sticker_text" ? "sticker" : step.contentMode === "image_text" ? "image" : "sequence";
      await client.query(
        `INSERT INTO followup.content_variants
          (step_id, variant_order, content_type, text_template, media_url)
         VALUES ($1, $2, $3, $4, $5)`,
        [stepResult.rows[0].id, variantIndex + 1, contentType, variant.textTemplate ?? null, variant.mediaUrl ?? null],
      );
    }
  }
}

export async function getCampaign(campaignId: string) {
  const campaign = await getFollowupPool().query(
    `SELECT c.id, c.name, c.description, c.status, c.auto_enroll, c.timezone,
      c.allowed_start_time::text, c.allowed_end_time::text, c.weekdays,
      c.created_at, c.updated_at, s.code AS source_code, s.name AS source_name,
      (SELECT COUNT(*)::int FROM followup.enrollments e WHERE e.campaign_id = c.id) AS enrollment_count
     FROM followup.campaigns c
     JOIN followup.sources s ON s.id = c.source_id
     WHERE c.id = $1`,
    [campaignId],
  );
  if (!campaign.rowCount) return null;
  const steps = await getFollowupPool().query(
    `SELECT cs.id, cs.step_order, cs.delay_minutes, cs.content_mode, cs.sender_rule,
      cs.rotation_rule, cs.is_active,
      COALESCE(jsonb_agg(jsonb_build_object(
        'id', cv.id, 'variantOrder', cv.variant_order, 'contentType', cv.content_type,
        'textTemplate', cv.text_template, 'mediaUrl', cv.media_url, 'weight', cv.weight,
        'isActive', cv.is_active
      ) ORDER BY cv.variant_order) FILTER (WHERE cv.id IS NOT NULL), '[]'::jsonb) AS variants
     FROM followup.campaign_steps cs
     LEFT JOIN followup.content_variants cv ON cv.step_id = cs.id
     WHERE cs.campaign_id = $1
     GROUP BY cs.id
     ORDER BY cs.step_order`,
    [campaignId],
  );
  const row = campaign.rows[0];
  const hasMultipleVariants = steps.rows.some((step) => step.variants.length > 1);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    autoEnroll: row.auto_enroll,
    sourceCode: row.source_code,
    sourceName: row.source_name,
    timezone: row.timezone,
    allowedStartTime: row.allowed_start_time,
    allowedEndTime: row.allowed_end_time,
    weekdays: row.weekdays,
    enrollmentCount: row.enrollment_count,
    canEditStructure: row.enrollment_count === 0 && !hasMultipleVariants,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    steps: steps.rows.map((step) => ({
      id: step.id,
      stepOrder: step.step_order,
      delayHours: step.delay_minutes / 60,
      contentMode: step.content_mode,
      senderRule: step.sender_rule,
      rotationRule: step.rotation_rule,
      isActive: step.is_active,
      variants: step.variants,
    })),
  };
}

export async function updateCampaign(campaignId: string, input: UpdateCampaignInput) {
  return withTransaction(async (client) => {
    const campaign = await client.query(
      `SELECT c.id,
        (SELECT COUNT(*)::int FROM followup.enrollments e WHERE e.campaign_id = c.id) AS enrollment_count
       FROM followup.campaigns c WHERE c.id = $1 FOR UPDATE`,
      [campaignId],
    );
    if (!campaign.rowCount) throw new Error("Campanha não encontrada.");
    const source = await client.query("SELECT id FROM followup.sources WHERE code = $1 AND is_active = true", [input.sourceCode]);
    if (!source.rowCount) throw new Error("Fonte de leads indisponível.");
    const structureLocked = campaign.rows[0].enrollment_count > 0;
    if (structureLocked && !input.metadataOnly) {
      throw new Error("Esta campanha já possui leads. Edite somente nome, status e entrada automática.");
    }
    await client.query(
      `UPDATE followup.campaigns
       SET name = $2, status = $3, auto_enroll = $4,
         trigger_mode = $5, source_id = CASE WHEN $6 THEN source_id ELSE $7 END
       WHERE id = $1`,
      [campaignId, input.name, input.status, input.autoEnroll,
        input.autoEnroll ? "eligible_source_lead" : "manual", structureLocked || input.metadataOnly === true, source.rows[0].id],
    );
    if (!structureLocked && !input.metadataOnly) {
      await client.query("DELETE FROM followup.campaign_steps WHERE campaign_id = $1", [campaignId]);
      await insertCampaignSteps(client, campaignId, input.steps);
    }
    if (structureLocked && input.status !== "active") {
      await client.query(
        `UPDATE followup.messages message
         SET state = 'cancelled', cancelled_at = NOW(), cancel_reason = 'Campanha pausada pelo administrador'
         FROM followup.enrollments enrollment
         WHERE message.enrollment_id = enrollment.id
           AND enrollment.campaign_id = $1
           AND message.state IN ('scheduled', 'reserved')`,
        [campaignId],
      );
      await client.query(
        `UPDATE followup.enrollments
         SET state = 'paused', paused_reason = 'Campanha pausada pelo administrador', dispatch_lock_at = NULL
         WHERE campaign_id = $1 AND state = 'active'`,
        [campaignId],
      );
      await client.query(
        `UPDATE followup.lead_followup_control control
         SET control_status = 'paused'
         FROM followup.enrollments enrollment
         WHERE enrollment.campaign_id = $1 AND control.lead_id = enrollment.lead_id`,
        [campaignId],
      );
    } else if (structureLocked && input.status === "active") {
      await client.query(
        `UPDATE followup.enrollments enrollment
         SET state = 'active',
           next_send_at = COALESCE(enrollment.next_send_at, control.next_followup_at, NOW()),
           paused_reason = NULL
         FROM followup.lead_followup_control control
         WHERE enrollment.campaign_id = $1
           AND enrollment.lead_id = control.lead_id
           AND enrollment.state = 'paused'
           AND enrollment.paused_reason = 'Campanha pausada pelo administrador'`,
        [campaignId],
      );
      await client.query(
        `UPDATE followup.lead_followup_control control
         SET control_status = 'in_progress'
         FROM followup.enrollments enrollment
         WHERE enrollment.campaign_id = $1
           AND control.lead_id = enrollment.lead_id
           AND enrollment.state = 'active'`,
        [campaignId],
      );
    }
    await client.query(
      "INSERT INTO followup.audit_log (entity_type, entity_id, action, metadata) VALUES ('campaign', $1, 'updated', $2::jsonb)",
      [campaignId, JSON.stringify({ metadataOnly: structureLocked || input.metadataOnly === true })],
    );
    return { id: campaignId, structureLocked: structureLocked || input.metadataOnly === true };
  });
}

export async function deleteCampaign(campaignId: string) {
  return withTransaction(async (client) => {
    const campaign = await client.query(
      `SELECT c.id, c.name,
        (SELECT COUNT(*)::int FROM followup.enrollments e WHERE e.campaign_id = c.id) AS enrollment_count
       FROM followup.campaigns c WHERE c.id = $1 FOR UPDATE`,
      [campaignId],
    );
    if (!campaign.rowCount) throw new Error("Campanha não encontrada.");
    const used = campaign.rows[0].enrollment_count > 0;
    if (used) {
      await client.query(
        `UPDATE followup.messages message
         SET state = 'cancelled', cancelled_at = NOW(), cancel_reason = 'Campanha arquivada'
         FROM followup.enrollments enrollment
         WHERE message.enrollment_id = enrollment.id
           AND enrollment.campaign_id = $1
           AND message.state IN ('scheduled', 'reserved')`,
        [campaignId],
      );
      await client.query(
        "UPDATE followup.campaigns SET status = 'archived', auto_enroll = false WHERE id = $1",
        [campaignId],
      );
      await client.query(
        "UPDATE followup.enrollments SET state = 'paused', paused_reason = 'Campanha arquivada' WHERE campaign_id = $1 AND state = 'active'",
        [campaignId],
      );
      await client.query(
        `UPDATE followup.lead_followup_control control
         SET control_status = 'paused', next_followup_at = NULL
         FROM followup.enrollments enrollment
         WHERE enrollment.campaign_id = $1 AND control.lead_id = enrollment.lead_id`,
        [campaignId],
      );
    } else {
      await client.query("DELETE FROM followup.campaigns WHERE id = $1", [campaignId]);
    }
    await client.query(
      "INSERT INTO followup.audit_log (entity_type, entity_id, action, metadata) VALUES ('campaign', $1, $2, $3::jsonb)",
      [campaignId, used ? "archived" : "deleted", JSON.stringify({ name: campaign.rows[0].name })],
    );
    return { id: campaignId, mode: used ? "archived" : "deleted" };
  });
}

export async function listCampaigns() {
  const result = await getFollowupPool().query(
    `SELECT c.id, c.name, c.status, c.auto_enroll, c.created_at, s.code AS source_code, s.name AS source_name,
      COUNT(cs.id)::int AS step_count
     FROM followup.campaigns c
     JOIN followup.sources s ON s.id = c.source_id
     LEFT JOIN followup.campaign_steps cs ON cs.campaign_id = c.id
     WHERE c.status <> 'archived'
     GROUP BY c.id, s.id
     ORDER BY c.created_at DESC`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    sourceCode: row.source_code,
    sourceName: row.source_name,
    autoEnroll: row.auto_enroll,
    stepCount: row.step_count,
    createdAt: row.created_at,
  }));
}
