"use client";

import { useEffect, useMemo, useState } from "react";
import { LogoutButton } from "@/components/logout-button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type ContentKind = "Texto" | "Sticker + texto" | "Imagem + texto";

type Step = {
  id: number;
  delay: number;
  kind: ContentKind;
  sender: "Unidade 1" | "Unidade 2" | "Balanceado";
  rotation: "Sem repetir" | "Sequencial" | "Aleatória";
  textTemplate: string;
  mediaUrl: string;
};

const initialSteps: Step[] = [
  { id: 1, delay: 24, kind: "Texto", sender: "Unidade 1", rotation: "Sem repetir", textTemplate: "", mediaUrl: "" },
  { id: 2, delay: 48, kind: "Sticker + texto", sender: "Balanceado", rotation: "Sem repetir", textTemplate: "", mediaUrl: "" },
  { id: 3, delay: 168, kind: "Imagem + texto", sender: "Unidade 2", rotation: "Aleatória", textTemplate: "", mediaUrl: "" },
];

const navItems = [
  { label: "Visão geral", mark: "●" },
  { label: "Campanhas", mark: "↗" },
  { label: "Disparo único", mark: "➤" },
  { label: "Leads", mark: "◎" },
  { label: "Biblioteca", mark: "✦" },
  { label: "Conexões", mark: "⌁" },
  { label: "Histórico", mark: "≋" },
  { label: "Pendências", mark: "!" },
];

type SavedCampaign = {
  id: string;
  name: string;
  status: "active" | "draft" | "paused";
  sourceCode: "usuarios_sdr" | "clinica_nova";
  sourceName: string;
  stepCount: number;
  autoEnroll: boolean;
  enrollmentCount: number;
  scheduledCount: number;
};

type CampaignDetail = {
  id: string;
  name: string;
  status: string;
  autoEnroll: boolean;
  sourceCode: "usuarios_sdr" | "clinica_nova";
  sourceName: string;
  timezone: string;
  allowedStartTime: string;
  allowedEndTime: string;
  weekdays: number[];
  enrollmentCount: number;
  canEditStructure: boolean;
  steps: Array<{
    stepOrder: number;
    delayHours: number;
    contentMode: "text" | "sticker_text" | "image_text" | "sequence";
    senderRule: "sender_1" | "sender_2" | "balanced";
    rotationRule: "sequential" | "random" | "no_repeat";
    variants: Array<{ id: string; textTemplate: string | null; mediaUrl: string | null }>;
  }>;
};

type CampaignTestConfig = {
  campaign: { id: string; name: string; status: string };
  sendMode: "dry_run" | "live";
  senders: Array<{ code: "sender_1" | "sender_2"; name: string; whatsapp_number: string | null }>;
  steps: Array<{
    step_order: number;
    content_mode: string;
    variants: Array<{
      id: string;
      textTemplate: string | null;
      mediaUrl: string | null;
      contentType: string;
      variantOrder: number;
    }>;
  }>;
  recent: Array<{ id: string; recipient_phone: string; step_order: number; send_mode: string; state: string; error_message: string | null; created_at: string }>;
};

type DashboardData = {
  campaigns: { total: number; active: number };
  enrollments: { total: number; active: number; attention: number };
  messages: { sent_today: number; queued: number; failed: number };
  controls: {
    total: number;
    pending: number;
    in_progress: number;
    completed: number;
    followups_done: number;
    with_source_stage: number;
    source_stages_observed: number;
  };
  recent: Array<{ state: string; scheduled_at: string; sent_at: string | null; source_chat_id: string; source_name: string }>;
};

type LeadRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  origin_kind: "database" | "csv";
  source_code: "usuarios_sdr" | "clinica_nova";
  source_name: string;
  campaign_name: string | null;
  state: string | null;
  current_step_order: number | null;
  next_send_at: string | null;
  reference_at: string;
  is_eligible: boolean;
  eligibility_reason: string | null;
  import_filename: string | null;
  source_stage: number | null;
  source_legacy_stage: string | null;
  source_followup_enabled: boolean | null;
  source_last_message_at: string | null;
  source_created_at: string | null;
  control_status: string | null;
  control_stage: number | null;
  followup_count: number | null;
  last_followup_at: string | null;
  next_followup_at: string | null;
};
type MessageRow = { id: string; state: string; scheduled_at: string; sent_at: string | null; error_message: string | null; content_snapshot: { text?: string; type?: string }; source_chat_id: string; source_name: string; campaign_name: string };
type LibraryItem = { id: string; name: string; content_type: "text" | "sticker" | "image"; text_template: string | null; media_url: string | null; storage_path: string | null; is_active: boolean; created_at: string };
type BroadcastSetup = {
  senders: Array<{ code: "sender_1" | "sender_2"; name: string; whatsapp_number: string | null }>;
  broadcasts: Array<{ id: string; name: string; status: string; scheduled_at: string; created_at: string; recipients: number; sent: number; failed: number }>;
};
type ConnectionStatus = "connected" | "connecting" | "disconnected" | "hibernated" | "unavailable" | "unknown";
type SenderConnection = {
  code: "sender_1" | "sender_2";
  name: string;
  whatsappNumber: string | null;
  instanceName: string | null;
  profileName: string | null;
  profilePicUrl: string | null;
  status: ConnectionStatus;
  checkedAt: string | null;
  statusChangedAt: string | null;
  lastDisconnectAt: string | null;
  lastDisconnectReason: string | null;
  error: string | null;
  qrcode?: string | null;
};
type SenderDeliverySettings = {
  code: "sender_1" | "sender_2";
  name: string;
  dailyLimit: number;
  minIntervalSeconds: number;
  timezone: string;
  sentToday: number;
  remainingToday: number;
};

export function FollowupDashboard() {
  const [activeNav, setActiveNav] = useState("Visão geral");
  const [source, setSource] = useState<"usuarios_sdr" | "clinica_nova">("usuarios_sdr");
  const [campaignName, setCampaignName] = useState("Novos leads · Estética");
  const [autoEnroll, setAutoEnroll] = useState(false);
  const [steps, setSteps] = useState(initialSteps);
  const [savedCampaigns, setSavedCampaigns] = useState<SavedCampaign[]>([]);
  const [campaignComposerOpen, setCampaignComposerOpen] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
  const [editingCampaignStatus, setEditingCampaignStatus] = useState<SavedCampaign["status"]>("draft");
  const [editingStructureLocked, setEditingStructureLocked] = useState(false);
  const [viewedCampaign, setViewedCampaign] = useState<CampaignDetail | null>(null);
  const [campaignTest, setCampaignTest] = useState<CampaignTestConfig | null>(null);
  const [campaignAction, setCampaignAction] = useState<"idle" | "loading" | "deleting" | "status">("idle");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [databaseLeads, setDatabaseLeads] = useState<LeadRow[]>([]);
  const [csvLeads, setCsvLeads] = useState<LeadRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryFilter, setLibraryFilter] = useState<"all" | LibraryItem["content_type"]>("all");
  const [broadcastSetup, setBroadcastSetup] = useState<BroadcastSetup>({ senders: [], broadcasts: [] });
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [connections, setConnections] = useState<SenderConnection[]>([]);
  const [connectionAction, setConnectionAction] = useState<string | null>(null);
  const [connectionMessage, setConnectionMessage] = useState("");
  const [senderSettings, setSenderSettings] = useState<SenderDeliverySettings[]>([]);
  const [senderSettingsAction, setSenderSettingsAction] = useState<string | null>(null);
  const [senderSettingsMessage, setSenderSettingsMessage] = useState("");
  const [leadSource, setLeadSource] = useState<"usuarios_sdr" | "clinica_nova">("usuarios_sdr");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [enrollCampaign, setEnrollCampaign] = useState("");
  const [leadAction, setLeadAction] = useState<"idle" | "syncing" | "importing">("idle");
  const [leadMessage, setLeadMessage] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const totalHours = useMemo(() => Math.max(0, ...steps.map((step) => step.delay)), [steps]);
  const filteredLibraryItems = useMemo(() => {
    const term = libraryQuery.trim().toLocaleLowerCase("pt-BR");
    return libraryItems.filter((item) => {
      const matchesType = libraryFilter === "all" || item.content_type === libraryFilter;
      const searchable = `${item.name} ${item.text_template ?? ""}`.toLocaleLowerCase("pt-BR");
      return matchesType && (!term || searchable.includes(term));
    });
  }, [libraryFilter, libraryItems, libraryQuery]);
  const sourceName = source === "usuarios_sdr" ? "Usuários SDR" : "Clínica nova";

  async function loadCampaigns() {
    const response = await fetch("/api/campaigns");
    if (!response.ok) throw new Error("Não foi possível carregar as campanhas.");
    const data = await response.json() as { campaigns: SavedCampaign[] };
    setSavedCampaigns(data.campaigns);
  }

  async function fetchCampaign(campaignId: string) {
    const response = await fetch(`/api/campaigns/${campaignId}`);
    const data = await response.json() as { campaign?: CampaignDetail; error?: string };
    if (!response.ok || !data.campaign) throw new Error(data.error ?? "Não foi possível carregar a campanha.");
    return data.campaign;
  }

  async function viewCampaign(campaignId: string) {
    setCampaignAction("loading");
    setSaveMessage("");
    try {
      setViewedCampaign(await fetchCampaign(campaignId));
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Falha ao visualizar.");
    } finally {
      setCampaignAction("idle");
    }
  }

  async function editCampaign(campaignId: string) {
    setCampaignAction("loading");
    setSaveMessage("");
    try {
      const campaign = await fetchCampaign(campaignId);
      const contentKind = { text: "Texto", sticker_text: "Sticker + texto", image_text: "Imagem + texto", sequence: "Texto" } as const;
      const sender = { sender_1: "Unidade 1", sender_2: "Unidade 2", balanced: "Balanceado" } as const;
      const rotation = { no_repeat: "Sem repetir", sequential: "Sequencial", random: "Aleatória" } as const;
      setEditingCampaignId(campaign.id);
      setEditingCampaignStatus(campaign.status as SavedCampaign["status"]);
      setEditingStructureLocked(!campaign.canEditStructure);
      setCampaignName(campaign.name);
      setSource(campaign.sourceCode);
      setAutoEnroll(campaign.autoEnroll);
      setSteps(campaign.steps.map((step, index) => ({
        id: index + 1,
        delay: step.delayHours,
        kind: contentKind[step.contentMode],
        sender: sender[step.senderRule],
        rotation: rotation[step.rotationRule],
        textTemplate: step.variants[0]?.textTemplate ?? "",
        mediaUrl: step.variants[0]?.mediaUrl ?? "",
      })));
      setViewedCampaign(null);
      setCampaignComposerOpen(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Falha ao editar.");
    } finally {
      setCampaignAction("idle");
    }
  }

  async function openCampaignTest(campaignId: string) {
    setCampaignAction("loading");
    setSaveMessage("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/test`);
      const data = await response.json() as CampaignTestConfig & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível preparar o teste.");
      setCampaignTest(data);
      setViewedCampaign(null);
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Falha ao preparar teste.");
    } finally {
      setCampaignAction("idle");
    }
  }

  function resetCampaignForm() {
    setEditingCampaignId(null);
    setEditingCampaignStatus("draft");
    setEditingStructureLocked(false);
    setCampaignName("Novos leads · Estética");
    setSource("usuarios_sdr");
    setAutoEnroll(false);
    setSteps(initialSteps);
  }

  function openNewCampaign() {
    resetCampaignForm();
    setSaveMessage("");
    setSaveState("idle");
    setViewedCampaign(null);
    setCampaignTest(null);
    setCampaignComposerOpen(true);
  }

  function cancelCampaignEdit() {
    resetCampaignForm();
    setCampaignComposerOpen(false);
    setSaveMessage("");
  }

  async function toggleCampaignStatus(campaign: SavedCampaign) {
    const nextStatus = campaign.status === "active" ? "paused" : "active";
    if (nextStatus === "active" && !window.confirm(`Ativar “${campaign.name}”? Apenas leads recentes e elegíveis entrarão na cadência.`)) return;
    setCampaignAction("status");
    setSaveMessage("");
    try {
      const response = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível alterar a campanha.");
      await loadCampaigns();
      setSaveMessage(nextStatus === "active" ? "Campanha ativada. Novos leads já podem entrar na cadência." : "Campanha pausada. A fila foi preservada.");
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Não foi possível alterar a campanha.");
    } finally {
      setCampaignAction("idle");
    }
  }

  async function removeCampaign(campaign: SavedCampaign) {
    const confirmed = window.confirm(`Excluir a campanha “${campaign.name}”? Se ela já tiver histórico, será arquivada.`);
    if (!confirmed) return;
    setCampaignAction("deleting");
    setSaveMessage("");
    try {
      const response = await fetch(`/api/campaigns/${campaign.id}`, { method: "DELETE" });
      const data = await response.json() as { mode?: "deleted" | "archived"; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível excluir a campanha.");
      if (editingCampaignId === campaign.id) cancelCampaignEdit();
      if (viewedCampaign?.id === campaign.id) setViewedCampaign(null);
      if (campaignTest?.campaign.id === campaign.id) setCampaignTest(null);
      await loadCampaigns();
      setSaveMessage(data.mode === "archived" ? "Campanha arquivada e removida da operação." : "Campanha excluída definitivamente.");
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Falha ao excluir.");
    } finally {
      setCampaignAction("idle");
    }
  }

  async function loadLeads() {
    const response = await fetch("/api/leads");
    if (!response.ok) throw new Error("Não foi possível carregar os leads.");
    const data = await response.json() as { databaseLeads: LeadRow[]; csvLeads: LeadRow[] };
    setDatabaseLeads(data.databaseLeads);
    setCsvLeads(data.csvLeads);
  }

  async function loadLibrary() {
    const response = await fetch("/api/library");
    if (!response.ok) throw new Error("Não foi possível carregar a biblioteca.");
    const data = await response.json() as { items: LibraryItem[] };
    setLibraryItems(data.items);
  }

  async function loadBroadcastSetup() {
    const response = await fetch("/api/broadcasts");
    if (!response.ok) throw new Error("Não foi possível carregar os disparos.");
    setBroadcastSetup(await response.json() as BroadcastSetup);
  }

  async function loadConnections(showProgress = false) {
    if (showProgress) setConnectionAction("refresh");
    try {
      const response = await fetch("/api/connections", { cache: "no-store" });
      const data = await response.json() as { connections?: SenderConnection[]; error?: string };
      if (!response.ok || !data.connections) throw new Error(data.error ?? "Não foi possível consultar as conexões.");
      setConnections(data.connections);
      setConnectionMessage("");
    } catch (error) {
      setConnectionMessage(error instanceof Error ? error.message : "Falha ao atualizar as conexões.");
    } finally {
      if (showProgress) setConnectionAction(null);
    }
  }

  async function loadSenderSettings() {
    const response = await fetch("/api/senders", { cache: "no-store" });
    const data = await response.json() as { senders?: SenderDeliverySettings[]; error?: string };
    if (!response.ok || !data.senders) throw new Error(data.error ?? "Não foi possível carregar os limites de envio.");
    setSenderSettings(data.senders);
  }

  async function saveSenderSettings(senderCode: SenderDeliverySettings["code"], dailyLimit: number, minIntervalSeconds: number) {
    setSenderSettingsAction(senderCode);
    setSenderSettingsMessage("");
    try {
      const response = await fetch("/api/senders", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: senderCode, dailyLimit, minIntervalSeconds }),
      });
      const data = await response.json() as { senders?: SenderDeliverySettings[]; error?: string };
      if (!response.ok || !data.senders) throw new Error(data.error ?? "Não foi possível atualizar a unidade.");
      setSenderSettings(data.senders);
      setSenderSettingsMessage("Ritmo de envio atualizado. A fila seguirá usando o novo limite.");
    } catch (error) {
      setSenderSettingsMessage(error instanceof Error ? error.message : "Não foi possível atualizar a unidade.");
    } finally {
      setSenderSettingsAction(null);
    }
  }

  async function connectWhatsapp(senderCode: SenderConnection["code"]) {
    setConnectionAction(senderCode);
    setConnectionMessage("");
    try {
      const response = await fetch(`/api/connections/${senderCode}/connect`, { method: "POST" });
      const data = await response.json() as { connection?: SenderConnection; error?: string };
      if (!response.ok || !data.connection) throw new Error(data.error ?? "Não foi possível gerar o QR Code.");
      setConnections((current) => current.map((item) => item.code === senderCode ? data.connection! : item));
      setConnectionMessage(data.connection.status === "connected" ? "Esta clínica já está conectada." : "QR Code gerado. Abra o WhatsApp no celular e escaneie para concluir.");
    } catch (error) {
      setConnectionMessage(error instanceof Error ? error.message : "Falha ao iniciar a conexão.");
    } finally {
      setConnectionAction(null);
    }
  }

  async function createBroadcast(input: { name: string; senderCode: string; leadIds: string[]; text: string; scheduledAt: string }) {
    setBroadcastMessage("");
    const response = await fetch("/api/broadcasts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await response.json() as { broadcast?: { recipients: number }; error?: string };
    if (!response.ok) {
      setBroadcastMessage(data.error ?? "Não foi possível agendar o disparo.");
      return false;
    }
    setBroadcastMessage(`Disparo agendado para ${data.broadcast?.recipients ?? 0} contato(s).`);
    await loadBroadcastSetup();
    return true;
  }

  useEffect(() => {
    Promise.all([
      loadCampaigns(),
      fetch("/api/dashboard").then((response) => response.ok ? response.json() : Promise.reject()),
      fetch("/api/leads").then((response) => response.ok ? response.json() : Promise.reject()),
      fetch("/api/messages").then((response) => response.ok ? response.json() : Promise.reject()),
      loadLibrary(),
      loadBroadcastSetup(),
      loadConnections(),
      loadSenderSettings(),
    ]).then(([, dashboardData, leadData, messageData]) => {
      setDashboard(dashboardData as DashboardData);
      const catalog = leadData as { databaseLeads: LeadRow[]; csvLeads: LeadRow[] };
      setDatabaseLeads(catalog.databaseLeads);
      setCsvLeads(catalog.csvLeads);
      setMessages((messageData as { messages: MessageRow[] }).messages);
    }).catch(() => setSaveMessage("Conecte o banco para visualizar os dados do painel."));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => loadConnections(), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!campaignComposerOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelCampaignEdit();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [campaignComposerOpen]);

  async function syncLeads() {
    setLeadAction("syncing");
    setLeadMessage("");
    try {
      const response = await fetch("/api/leads/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceCode: leadSource }),
      });
      const result = await response.json() as { synchronized?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível atualizar os contatos.");
      await loadLeads();
      setLeadMessage(`${result.synchronized ?? 0} contatos atualizados.`);
    } catch (error) {
      setLeadMessage(error instanceof Error ? error.message : "Não foi possível atualizar os contatos.");
    } finally {
      setLeadAction("idle");
    }
  }

  async function importCsv() {
    if (!csvFile) {
      setLeadMessage("Selecione um arquivo CSV.");
      return;
    }
    setLeadAction("importing");
    setLeadMessage("");
    try {
      const form = new FormData();
      form.set("file", csvFile);
      form.set("sourceCode", leadSource);
      const response = await fetch("/api/imports/csv", { method: "POST", body: form });
      const result = await response.json() as { imported?: number; rejected?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Falha ao importar.");
      await loadLeads();
      setCsvFile(null);
      setLeadMessage(`${result.imported ?? 0} leads importados; ${result.rejected ?? 0} linhas rejeitadas.`);
    } catch (error) {
      setLeadMessage(error instanceof Error ? error.message : "Falha ao importar.");
    } finally {
      setLeadAction("idle");
    }
  }

  async function enrollLead(leadId: string) {
    if (!enrollCampaign) {
      setLeadMessage("Selecione uma campanha ativa.");
      return;
    }
    setLeadMessage("");
    const response = await fetch("/api/leads/enroll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leadId, campaignId: enrollCampaign }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) {
      setLeadMessage(result.error ?? "Não foi possível incluir o lead.");
      return;
    }
    await loadLeads();
    setLeadMessage("Lead incluído na cadência; o próximo horário já foi calculado.");
  }

  function addStep() {
    setSteps((current) => [
      ...current,
      { id: Math.max(0, ...current.map((step) => step.id)) + 1, delay: 24, kind: "Texto", sender: "Balanceado", rotation: "Sem repetir", textTemplate: "", mediaUrl: "" },
    ]);
  }

  function removeStep(id: number) {
    setSteps((current) => current.length > 1 ? current.filter((step) => step.id !== id) : current);
  }

  function updateStep(id: number, field: keyof Step, value: string | number) {
    setSteps((current) => current.map((step) => step.id === id ? { ...step, [field]: value } : step));
  }

  function useLibraryItem(stepId: number, itemId: string) {
    const item = libraryItems.find((candidate) => candidate.id === itemId);
    if (!item) return;
    const kind: ContentKind = item.content_type === "text" ? "Texto" : item.content_type === "sticker" ? "Sticker + texto" : "Imagem + texto";
    setSteps((current) => current.map((step) => step.id === stepId ? {
      ...step,
      kind,
      textTemplate: item.text_template ?? "",
      mediaUrl: item.media_url ?? "",
    } : step));
  }

  async function saveCampaign() {
    setSaveState("saving");
    setSaveMessage("");
    const contentMode = { "Texto": "text", "Sticker + texto": "sticker_text", "Imagem + texto": "image_text" } as const;
    const senderRule = { "Unidade 1": "sender_1", "Unidade 2": "sender_2", "Balanceado": "balanced" } as const;
    const rotationRule = { "Sequencial": "sequential", "Aleatória": "random", "Sem repetir": "no_repeat" } as const;

    try {
      const response = await fetch(editingCampaignId ? `/api/campaigns/${editingCampaignId}` : "/api/campaigns", {
        method: editingCampaignId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: campaignName,
          sourceCode: source,
          status: editingCampaignId ? editingCampaignStatus : "draft",
          autoEnroll,
          metadataOnly: editingStructureLocked,
          steps: steps.map((step) => ({
            delayHours: step.delay,
            contentMode: contentMode[step.kind],
            senderRule: senderRule[step.sender],
            rotationRule: rotationRule[step.rotation],
            variants: step.textTemplate || step.mediaUrl ? [{ textTemplate: step.textTemplate, mediaUrl: step.mediaUrl }] : [],
          })),
        }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível salvar a campanha.");
      await loadCampaigns();
      setSaveState("saved");
      setSaveMessage(editingCampaignId ? "Campanha atualizada com sucesso." : "Campanha criada como rascunho. Revise e ative quando estiver pronta.");
      resetCampaignForm();
      setCampaignComposerOpen(false);
    } catch (error) {
      setSaveState("error");
      setSaveMessage(error instanceof Error ? error.message : "Não foi possível salvar a campanha.");
    }
  }

  const connectedCount = connections.filter((connection) => connection.status === "connected").length;
  const connectionAlerts = connections.filter((connection) => connection.status !== "connected");

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">F</span><span>fluxo<span>.</span></span></div>
        <p className="workspace">CENTRAL DE FOLLOW-UP<br />CLÍNICA · OPERAÇÃO</p>
        <nav aria-label="Navegação principal">
          {navItems.map((item) => (
            <button key={item.label} className={activeNav === item.label ? "nav-item active" : "nav-item"} onClick={() => setActiveNav(item.label)} title={item.label}>
              <span className="nav-dot" aria-hidden="true">{item.mark}</span><span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>
        <div className={`source-status ${connectionAlerts.length ? "has-alert" : ""}`}><span className="status-dot" /><span className="sidebar-detail">LINHAS WHATSAPP<br /><strong>{connectedCount} de {connections.length || 2} conectadas</strong></span></div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div><p className="eyebrow">CENTRAL / {activeNav}</p><h1>{activeNav === "Visão geral" ? "O ritmo da operação" : activeNav}</h1></div>
          <div className="topbar-actions">
            <div className="pulse-status"><span /><div><strong>{dashboard?.controls.in_progress ?? 0} em andamento</strong><small>monitoramento contínuo</small></div></div>
            <button className="quick-action" onClick={() => { setActiveNav("Campanhas"); openNewCampaign(); }}>+ Nova campanha</button>
            <div className="user"><span>Admin</span><div className="avatar">A</div><LogoutButton /></div>
          </div>
        </header>

        {connectionAlerts.length > 0 && <button className="connection-alert" onClick={() => setActiveNav("Conexões")}>
          <span aria-hidden="true">!</span>
          <strong>{connectionAlerts.length === 1 ? "Uma clínica precisa de atenção" : `${connectionAlerts.length} clínicas precisam de atenção`}</strong>
          <small>{connectionAlerts.map((item) => item.name).join(" · ")} — os envios dessas linhas ficam aguardando.</small>
          <em>Ver conexões →</em>
        </button>}

        {activeNav === "Visão geral" && <div className="pulse-rail" aria-label="Status da operação"><span>AGORA</span><i /><strong>{dashboard?.messages.queued ?? 0} mensagens aguardam processamento</strong><i /><span>PRÓXIMAS AÇÕES</span></div>}

        {activeNav === "Visão geral" && <>
          <section className="metric-grid" aria-label="Resumo operacional">
            <Metric label="Envios hoje" value={String(dashboard?.messages.sent_today ?? 0)} hint="Modo de simulação ativo" />
            <Metric label="Follow-ups feitos" value={String(dashboard?.controls.followups_done ?? 0)} hint={`${dashboard?.controls.source_stages_observed ?? 0} etapas já acompanhadas`} />
            <Metric label="Leads controlados" value={String(dashboard?.controls.total ?? 0)} hint={`${dashboard?.controls.in_progress ?? 0} em andamento`} />
            <Metric label="Atenção" value={String((dashboard?.messages.failed ?? 0) + (dashboard?.enrollments.attention ?? 0))} hint="Falhas e pausas" alert />
          </section>
          <section className="overview-card">
            <div><p className="eyebrow">Atividade recente</p><h2>Últimas movimentações</h2></div>
            {dashboard?.recent.length ? <div className="activity-list">{dashboard.recent.map((item, index) => <article key={`${item.source_chat_id}-${index}`}><span className={`activity-dot ${item.state}`} /><div><strong>{item.source_name}</strong><small>Atendimento acompanhado pela cadência</small></div><span>{item.state === "sent" ? "enviado" : item.state === "scheduled" ? "agendado" : item.state}</span></article>)}</div> : <p className="empty-state">Quando uma mensagem for processada, ela aparecerá aqui.</p>}
          </section>
        </>}

        {activeNav === "Campanhas" && <>
        {campaignComposerOpen && <section className="builder-card campaign-composer" role="dialog" aria-modal="true" aria-labelledby="campaign-composer-title">
          <div className="builder-heading">
            <div>
              <p className="eyebrow">{editingCampaignId ? "Editando campanha" : "Nova campanha"}</p>
              <input id="campaign-composer-title" aria-label="Nome da campanha" value={campaignName} onChange={(event) => setCampaignName(event.target.value)} />
              <p className="builder-description">Configure os momentos e conteúdos. A ativação acontece separadamente, na lista de campanhas.</p>
            </div>
            <button className="composer-close" onClick={cancelCampaignEdit} aria-label="Fechar criação de campanha">×</button>
          </div>
          <div className="composer-safety">
            <strong>{editingCampaignId ? `Status preservado: ${editingCampaignStatus === "active" ? "ativa" : editingCampaignStatus === "paused" ? "pausada" : "rascunho"}.` : "A campanha será salva como rascunho."}</strong>
            <span>Revise unidade, conteúdo e intervalos antes de ativar.</span>
          </div>
          {editingCampaignId && <div className={editingStructureLocked ? "edit-notice locked" : "edit-notice"}>
            <span>{editingStructureLocked ? "Esta campanha já possui histórico. Nome e entrada automática ainda podem ser ajustados; a estrutura permanece protegida." : "Você pode editar toda a estrutura desta campanha."}</span>
            <button type="button" onClick={cancelCampaignEdit}>Cancelar edição</button>
          </div>}

          <div className="source-picker">
            <div><strong>Unidade que fará o contato</strong><span>Cada unidade mantém sua própria agenda e seu histórico.</span></div>
            <label>Operação
              <select value={source} disabled={editingStructureLocked} onChange={(event) => setSource(event.target.value as typeof source)}>
                <option value="usuarios_sdr">Usuários SDR · Unidade 1</option>
                <option value="clinica_nova">Clínica nova · Unidade 2</option>
              </select>
            </label>
          </div>

          <div className="guardrail">
            <strong>Proteção ativa em {sourceName}:</strong> antes de cada envio, verificamos se o atendimento já foi concluído ou assumido pela equipe. O cadastro original não é alterado.
          </div>
          <label className="auto-enroll-control">
            <input type="checkbox" checked={autoEnroll} onChange={(event) => setAutoEnroll(event.target.checked)} />
            <span><strong>Entrada automática</strong><small>Ao ativar, começa apenas pelos leads recentes cujo primeiro horário ainda não venceu.</small></span>
          </label>

          <div className="steps">
            {steps.map((step, index) => (
              <article className="step" key={step.id}>
                <div className="step-number">{index + 1}</div>
                <div className="step-main">
                  <div className="step-title-row"><h2>Etapa {index + 1}</h2><span>{formatDuration(step.delay)} após a última mensagem</span></div>
                  <label className="step-library-picker">Usar conteúdo da biblioteca
                    <select defaultValue="" disabled={editingStructureLocked || libraryItems.length === 0} onChange={(event) => { useLibraryItem(step.id, event.target.value); event.currentTarget.value = ""; }}>
                      <option value="" disabled>{libraryItems.length ? "Escolher texto, sticker ou imagem" : "Biblioteca vazia"}</option>
                      {libraryItems.map((item) => <option key={item.id} value={item.id}>{libraryTypeLabel(item.content_type)} · {item.name}</option>)}
                    </select>
                  </label>
                  <div className="step-controls">
                    <label>Momento
                      <input type="number" min={index === 0 ? 1 : steps[index - 1].delay + 1} max="2160" disabled={editingStructureLocked} value={step.delay} onChange={(event) => updateStep(step.id, "delay", Number(event.target.value))} /> horas
                    </label>
                    <Select label="Conteúdo" value={step.kind} disabled={editingStructureLocked} options={["Texto", "Sticker + texto", "Imagem + texto"]} onChange={(value) => updateStep(step.id, "kind", value as ContentKind)} />
                    <Select label="Remetente" value={step.sender} disabled={editingStructureLocked} options={["Unidade 1", "Unidade 2", "Balanceado"]} onChange={(value) => updateStep(step.id, "sender", value as Step["sender"])} />
                    <Select label="Rotação" value={step.rotation} disabled={editingStructureLocked} options={["Sem repetir", "Sequencial", "Aleatória"]} onChange={(value) => updateStep(step.id, "rotation", value as Step["rotation"])} />
                  </div>
                  <div className="content-fields">
                    <label>Texto da mensagem
                      <textarea disabled={editingStructureLocked} value={step.textTemplate} placeholder="Ex.: Oi, {{nome | 'tudo bem'}}! Posso te ajudar?" onChange={(event) => updateStep(step.id, "textTemplate", event.target.value)} />
                    </label>
                    {step.kind !== "Texto" && <label>URL da mídia
                      <input disabled={editingStructureLocked} value={step.mediaUrl} placeholder={step.kind === "Sticker + texto" ? "URL do sticker" : "URL da imagem"} onChange={(event) => updateStep(step.id, "mediaUrl", event.target.value)} />
                    </label>}
                  </div>
                </div>
                <button className="remove-step" disabled={editingStructureLocked} onClick={() => removeStep(step.id)} aria-label={`Remover etapa ${index + 1}`}>×</button>
              </article>
            ))}
          </div>
          <div className="builder-footer">
            <button className="secondary-button" disabled={editingStructureLocked} onClick={addStep}>+ Adicionar etapa</button>
            <span>Última etapa: <strong>{formatDuration(totalHours)}</strong></span>
            <button className="primary-button" onClick={saveCampaign} disabled={saveState === "saving"}>{saveState === "saving" ? "Salvando..." : editingCampaignId ? "Salvar alterações" : "Salvar rascunho"}</button>
          </div>
          {saveMessage && <p className={saveState === "error" ? "save-message error" : "save-message"}>{saveMessage}</p>}
        </section>}

        <section className="saved-section">
          <div className="saved-heading"><div><p className="eyebrow">Controle de cadências</p><h2>{savedCampaigns.length} campanha{savedCampaigns.length === 1 ? "" : "s"}</h2></div><div><span>{savedCampaigns.filter((campaign) => campaign.status === "active").length} ativas agora</span><button className="primary-button" onClick={openNewCampaign}>+ Criar campanha</button></div></div>
          {saveMessage && !campaignComposerOpen && <p className={saveState === "error" ? "save-message error" : "save-message"}>{saveMessage}</p>}
          {savedCampaigns.length === 0 ? <div className="campaign-empty"><strong>Nenhuma campanha configurada.</strong><span>Crie a primeira cadência e revise as etapas antes de ativá-la.</span><button onClick={openNewCampaign}>Criar campanha</button></div> : (
            <div className="saved-list">{savedCampaigns.map((campaign) => <article className={`saved-campaign ${campaign.status}`} key={campaign.id}>
              <div className="campaign-main"><span className={`campaign-status ${campaign.status}`}>{campaign.status === "active" ? "Ativa" : campaign.status === "paused" ? "Pausada" : "Rascunho"}</span><strong>{campaign.name}</strong><span>{campaign.sourceName} · {campaign.stepCount} etapa{campaign.stepCount === 1 ? "" : "s"} · {campaign.autoEnroll ? "entrada automática" : "entrada manual"}</span></div>
              <div className="campaign-volume"><span><strong>{campaign.enrollmentCount}</strong> leads</span><span><strong>{campaign.scheduledCount}</strong> na fila</span></div>
              <button className={`campaign-power ${campaign.status === "active" ? "on" : ""}`} onClick={() => toggleCampaignStatus(campaign)} disabled={campaignAction !== "idle"} aria-label={campaign.status === "active" ? `Pausar ${campaign.name}` : `Ativar ${campaign.name}`} aria-pressed={campaign.status === "active"}><i /><span>{campaign.status === "active" ? "Pausar" : "Ativar"}</span></button>
              <div className="campaign-actions">
                <button onClick={() => viewCampaign(campaign.id)} disabled={campaignAction !== "idle"}>Visualizar</button>
                <button onClick={() => editCampaign(campaign.id)} disabled={campaignAction !== "idle"}>Editar</button>
                <button onClick={() => openCampaignTest(campaign.id)} disabled={campaignAction !== "idle"}>Testar</button>
                <button className="danger" onClick={() => removeCampaign(campaign)} disabled={campaignAction !== "idle"}>Excluir</button>
              </div>
            </article>)}</div>
          )}
          {viewedCampaign && <CampaignViewer campaign={viewedCampaign} onClose={() => setViewedCampaign(null)} />}
          {campaignTest && <CampaignTestPanel initialConfig={campaignTest} onClose={() => setCampaignTest(null)} />}
        </section>
        </>}

        {activeNav === "Leads" && <>
          <section className="lead-actions">
            <div>
              <p className="eyebrow">Entrada de leads</p>
              <h2>Escolha a unidade antes de recuperar ou importar</h2>
              <p>Os contatos da clínica são apenas consultados. As listas importadas ficam separadas para manter tudo organizado.</p>
            </div>
            <label>Unidade
              <select value={leadSource} onChange={(event) => setLeadSource(event.target.value as typeof leadSource)}>
                <option value="usuarios_sdr">Unidade 1 · Usuários SDR</option>
                <option value="clinica_nova">Unidade 2 · Clínica nova</option>
              </select>
            </label>
            <label>Campanha para inclusão
              <select value={enrollCampaign} onChange={(event) => setEnrollCampaign(event.target.value)}>
                <option value="">Selecione uma campanha ativa</option>
                {savedCampaigns.filter((campaign) => campaign.status === "active").map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>{campaign.name} · {campaign.sourceName}</option>
                ))}
              </select>
            </label>
            <button className="secondary-button" onClick={syncLeads} disabled={leadAction !== "idle"}>
              {leadAction === "syncing" ? "Atualizando..." : "Atualizar contatos"}
            </button>
            <div className="csv-control">
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => setCsvFile(event.target.files?.[0] ?? null)}
              />
              <button className="primary-button" onClick={importCsv} disabled={leadAction !== "idle"}>
                {leadAction === "importing" ? "Importando..." : "Importar CSV"}
              </button>
              <small>Colunas: nome, telefone, email, data_referencia. Aceita vírgula ou ponto e vírgula.</small>
            </div>
            {leadMessage && <p className="lead-message">{leadMessage}</p>}
          </section>

          <DataPanel hasRows={databaseLeads.length > 0} title={`Contatos da clínica (${databaseLeads.length})`} subtitle="Dados atualizados sem alterar o cadastro original" empty="Clique em “Atualizar contatos” para ver os contatos desta unidade.">
            <LeadTable leads={databaseLeads} campaignId={enrollCampaign} campaigns={savedCampaigns} onEnroll={enrollLead} />
          </DataPanel>

          <DataPanel hasRows={csvLeads.length > 0} title={`Importados por CSV (${csvLeads.length})`} subtitle="Listas externas · área separada" empty="Nenhuma lista CSV foi importada.">
            <LeadTable leads={csvLeads} campaignId={enrollCampaign} campaigns={savedCampaigns} onEnroll={enrollLead} />
          </DataPanel>
        </>}

        {activeNav === "Disparo único" && <BroadcastPanel
          leads={[...databaseLeads, ...csvLeads]}
          senders={broadcastSetup.senders}
          broadcasts={broadcastSetup.broadcasts}
          onCreate={createBroadcast}
          message={broadcastMessage}
        />}

        {activeNav === "Histórico" && <DataPanel hasRows={messages.length > 0} title="Fila e histórico" subtitle="Cada tentativa de mensagem fica auditada" empty="Nenhuma mensagem foi enfileirada ainda.">
          <div className="data-table">{messages.map((message) => <article key={message.id}><div><strong>{message.content_snapshot?.text || message.content_snapshot?.type || "Mensagem"}</strong><small>{message.source_name} · {message.campaign_name}</small></div><span className={`table-status ${message.state}`}>{message.state}</span></article>)}</div>
        </DataPanel>}

        {activeNav === "Biblioteca" && <LibraryPanel
          items={libraryItems}
          filteredItems={filteredLibraryItems}
          query={libraryQuery}
          filter={libraryFilter}
          onQueryChange={setLibraryQuery}
          onFilterChange={setLibraryFilter}
          onReload={loadLibrary}
        />}

        {activeNav === "Conexões" && <ConnectionsPanel
          connections={connections}
          senderSettings={senderSettings}
          action={connectionAction}
          message={connectionMessage}
          settingsAction={senderSettingsAction}
          settingsMessage={senderSettingsMessage}
          onRefresh={() => loadConnections(true)}
          onConnect={connectWhatsapp}
          onSaveSettings={saveSenderSettings}
        />}

        {activeNav === "Pendências" && <DataPanel hasRows={[...databaseLeads, ...csvLeads].some((lead) => Boolean(lead.state && ["paused", "blocked", "pending_data"].includes(lead.state)) || !lead.is_eligible)} title="Pendências operacionais" subtitle="Leads pausados, bloqueados ou com dados ausentes" empty="Nenhuma pendência operacional.">
          <div className="data-table">{[...databaseLeads, ...csvLeads].filter((lead) => Boolean(lead.state && ["paused", "blocked", "pending_data"].includes(lead.state)) || !lead.is_eligible).map((lead) => <article key={lead.id}><div><strong>{lead.name || lead.phone || "Contato"}</strong><small>{lead.eligibility_reason || "Verifique os dados deste contato"}</small></div><span className={`table-status ${lead.state ?? "pending_data"}`}>{lead.state ?? "pending_data"}</span></article>)}</div>
        </DataPanel>}
      </section>
    </main>
  );
}

function Metric({ label, value, hint, alert = false }: { label: string; value: string; hint: string; alert?: boolean }) {
  return <article className="metric"><p>{label}</p><strong className={alert ? "metric-alert" : ""}>{value}</strong><span>{hint}</span></article>;
}

function DataPanel({ title, subtitle, empty, children, hasRows }: { title: string; subtitle: string; empty: string; children: React.ReactNode; hasRows: boolean }) {
  return <section className="saved-section data-panel"><div><p className="eyebrow">{subtitle}</p><h2>{title}</h2></div>{hasRows ? children : <p className="empty-state">{empty}</p>}</section>;
}

function ConnectionsPanel({ connections, senderSettings, action, message, settingsAction, settingsMessage, onRefresh, onConnect, onSaveSettings }: {
  connections: SenderConnection[];
  senderSettings: SenderDeliverySettings[];
  action: string | null;
  message: string;
  settingsAction: string | null;
  settingsMessage: string;
  onRefresh: () => void;
  onConnect: (senderCode: SenderConnection["code"]) => void;
  onSaveSettings: (senderCode: SenderDeliverySettings["code"], dailyLimit: number, minIntervalSeconds: number) => Promise<void>;
}) {
  const labels: Record<ConnectionStatus, string> = {
    connected: "Conectado", connecting: "Aguardando leitura", disconnected: "Desconectado",
    hibernated: "Em espera", unavailable: "Sem comunicação", unknown: "Não verificado",
  };
  return <section className="connections-screen">
    <header className="connections-heading">
      <div><p className="eyebrow">Linhas da operação</p><h2>Conexões WhatsApp</h2><p>Acompanhe cada clínica e reconecte a linha sem sair da plataforma.</p></div>
      <button className="secondary-button" onClick={onRefresh} disabled={action === "refresh"}>{action === "refresh" ? "Verificando..." : "Verificar agora"}</button>
    </header>
    {message && <p className="connection-message" role="status">{message}</p>}
    <div className="connection-grid">
      {connections.length === 0 ? <article className="connection-empty"><strong>Consultando as linhas</strong><span>O primeiro estado aparecerá em instantes.</span></article> : connections.map((connection, index) => {
        const disconnected = connection.status !== "connected";
        const setting = senderSettings.find((item) => item.code === connection.code);
        return <article className={`connection-card ${connection.status}`} key={connection.code}>
          <i className="line-signal" aria-hidden="true" />
          <div className="connection-card-top">
            <span className="unit-index">0{index + 1}</span>
            <div><small>CLÍNICA / LINHA {index + 1}</small><h3>{connection.name}</h3></div>
            <span className={`connection-badge ${connection.status}`}><i />{labels[connection.status]}</span>
          </div>
          <div className="connection-identity">
            {connection.profilePicUrl ? <img src={connection.profilePicUrl} alt="" /> : <span>{connection.profileName?.slice(0, 1) || connection.name.slice(0, 1)}</span>}
            <div><strong>{connection.profileName || connection.instanceName || "WhatsApp ainda não identificado"}</strong><small>{connection.whatsappNumber ? `+${connection.whatsappNumber}` : "Número disponível após conectar"}</small></div>
          </div>
          {connection.qrcode && connection.status === "connecting" ? <div className="qr-stage">
            <div className="qr-frame"><img src={connection.qrcode} alt={`QR Code para conectar ${connection.name}`} /></div>
            <div><strong>Escaneie no WhatsApp</strong><ol><li>Abra Aparelhos conectados</li><li>Toque em Conectar aparelho</li><li>Aponte para este código</li></ol></div>
          </div> : <div className={`connection-state-copy ${connection.status}`}>
            <strong>{connection.status === "connected" ? "Linha pronta para os envios" : connection.status === "hibernated" ? "Sessão preservada, mas pausada" : "Os envios desta linha estão aguardando"}</strong>
            <span>{connection.error || connection.lastDisconnectReason || (disconnected ? "Gere um QR Code para restabelecer a sessão." : "A cadência seguirá usando esta clínica normalmente.")}</span>
          </div>}
          <dl className="connection-facts">
            <div><dt>Última verificação</dt><dd>{connection.checkedAt ? new Date(connection.checkedAt).toLocaleString("pt-BR") : "Ainda não realizada"}</dd></div>
            <div><dt>Última desconexão</dt><dd>{connection.lastDisconnectAt ? new Date(connection.lastDisconnectAt).toLocaleString("pt-BR") : "Sem registro"}</dd></div>
          </dl>
          {setting && <form className="sender-capacity" onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            void onSaveSettings(connection.code, Number(values.get("dailyLimit")), Number(values.get("minIntervalSeconds")));
          }}>
            <div className="sender-capacity-heading"><div><small>Ritmo de envio</small><strong>{setting.sentToday} de {setting.dailyLimit} enviados hoje</strong></div><span>{setting.remainingToday} disponíveis</span></div>
            <div className="sender-capacity-bar" aria-label={`${setting.sentToday} de ${setting.dailyLimit} mensagens enviadas hoje`}><i style={{ width: `${Math.min(100, (setting.sentToday / setting.dailyLimit) * 100)}%` }} /></div>
            <div className="sender-capacity-controls">
              <label>Limite diário<input name="dailyLimit" type="number" min="1" max="10000" defaultValue={setting.dailyLimit} /></label>
              <label>Intervalo entre mensagens<input name="minIntervalSeconds" type="number" min="0" max="3600" defaultValue={setting.minIntervalSeconds} /><small>segundos</small></label>
              <button className="secondary-button" type="submit" disabled={settingsAction === connection.code}>{settingsAction === connection.code ? "Salvando..." : "Salvar ritmo"}</button>
            </div>
            <p>O limite é reiniciado à meia-noite do fuso da unidade ({setting.timezone}).</p>
          </form>}
          <footer>
            <span>{connection.status === "connected" ? "Monitoramento automático a cada 15 segundos" : "A fila permanece preservada enquanto a linha estiver fora"}</span>
            {disconnected && <button className="primary-button" onClick={() => onConnect(connection.code)} disabled={action === connection.code}>{action === connection.code ? "Gerando..." : connection.status === "connecting" ? "Gerar novo QR" : "Conectar com QR Code"}</button>}
          </footer>
        </article>;
      })}
    </div>
    {settingsMessage && <p className="connection-message" role="status">{settingsMessage}</p>}
    <aside className="connection-safety"><strong>Proteção da cadência</strong><span>Uma linha desconectada não consome tentativas nem falha mensagens. Os envios retomam na próxima rodada depois da reconexão.</span></aside>
  </section>;
}

function libraryFilterLabel(value: "all" | LibraryItem["content_type"]) {
  return { all: "Todos", text: "Textos", sticker: "Stickers", image: "Imagens" }[value];
}

function libraryTypeLabel(value: LibraryItem["content_type"]) {
  return { text: "Texto", sticker: "Sticker", image: "Imagem" }[value];
}

function LibraryPanel({ items, filteredItems, query, filter, onQueryChange, onFilterChange, onReload }: {
  items: LibraryItem[];
  filteredItems: LibraryItem[];
  query: string;
  filter: "all" | LibraryItem["content_type"];
  onQueryChange: (value: string) => void;
  onFilterChange: (value: "all" | LibraryItem["content_type"]) => void;
  onReload: () => Promise<void>;
}) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [name, setName] = useState("");
  const [contentType, setContentType] = useState<LibraryItem["content_type"]>("text");
  const [textTemplate, setTextTemplate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [action, setAction] = useState<"idle" | "saving" | "archiving">("idle");
  const [message, setMessage] = useState("");

  function resetForm() {
    setName("");
    setContentType("text");
    setTextTemplate("");
    setFile(null);
    setComposerOpen(false);
  }

  async function saveItem(event: React.FormEvent) {
    event.preventDefault();
    setAction("saving");
    setMessage("");
    let uploadedPath: string | null = null;
    try {
      let mediaUrl: string | null = null;
      if (contentType !== "text") {
        if (!file) throw new Error("Selecione a imagem ou o sticker.");
        if (file.size > 10 * 1024 * 1024) throw new Error("O arquivo deve ter no máximo 10 MB.");
        const extensions: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
        const extension = extensions[file.type];
        if (!extension) throw new Error("Use PNG, JPG, WEBP ou GIF.");
        uploadedPath = `library/${crypto.randomUUID()}.${extension}`;
        const supabase = createSupabaseBrowserClient();
        const uploaded = await supabase.storage.from("followup-library").upload(uploadedPath, file, { contentType: file.type, cacheControl: "31536000", upsert: false });
        if (uploaded.error) throw new Error(uploaded.error.message);
        mediaUrl = supabase.storage.from("followup-library").getPublicUrl(uploadedPath).data.publicUrl;
      }
      const response = await fetch("/api/library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, contentType, textTemplate, mediaUrl, storagePath: uploadedPath }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível salvar o conteúdo.");
      await onReload();
      resetForm();
      setMessage("Conteúdo adicionado à biblioteca.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível salvar o conteúdo.");
    } finally {
      setAction("idle");
    }
  }

  async function archiveItem(item: LibraryItem) {
    if (!window.confirm(`Arquivar “${item.name}”? Campanhas que já usam esse conteúdo não serão alteradas.`)) return;
    setAction("archiving");
    setMessage("");
    try {
      const response = await fetch(`/api/library/${item.id}`, { method: "DELETE" });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível arquivar o conteúdo.");
      await onReload();
      setMessage("Conteúdo arquivado. Campanhas existentes foram preservadas.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível arquivar o conteúdo.");
    } finally {
      setAction("idle");
    }
  }

  return <section className="library-screen">
    <header className="library-heading">
      <div><p className="eyebrow">Conteúdos da clínica</p><h2>Biblioteca de mensagens</h2><p>Cadastre uma vez e reutilize textos, stickers e imagens em qualquer campanha.</p></div>
      <div className="library-heading-actions"><span>{items.length} conteúdo{items.length === 1 ? "" : "s"}</span><button className="primary-button" onClick={() => setComposerOpen((open) => !open)}>{composerOpen ? "Fechar cadastro" : "+ Adicionar conteúdo"}</button></div>
    </header>
    {composerOpen && <form className="library-composer" onSubmit={saveItem}>
      <div><p className="eyebrow">Novo item</p><h3>Prepare o conteúdo reutilizável</h3><p>Imagens e stickers ficam hospedados no Supabase Storage e podem ser lidos pelo WhatsApp.</p></div>
      <label>Nome do conteúdo<input value={name} maxLength={100} required onChange={(event) => setName(event.target.value)} placeholder="Ex.: Retorno após avaliação" /></label>
      <label>Tipo<select value={contentType} onChange={(event) => { setContentType(event.target.value as LibraryItem["content_type"]); setFile(null); }}><option value="text">Texto</option><option value="sticker">Sticker + texto</option><option value="image">Imagem + texto</option></select></label>
      <label className="library-message-field">Texto da mensagem<textarea value={textTemplate} required={contentType === "text"} maxLength={4000} onChange={(event) => setTextTemplate(event.target.value)} placeholder="Use {{nome}} para personalizar." /></label>
      {contentType !== "text" && <label className="library-file-field">Arquivo<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" required onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><small>PNG, JPG, WEBP ou GIF · até 10 MB</small></label>}
      <button className="primary-button" disabled={action !== "idle"}>{action === "saving" ? "Enviando..." : "Salvar na biblioteca"}</button>
    </form>}
    {message && <p className="library-message">{message}</p>}
    <div className="library-tools">
      <label className="library-search"><span>Buscar</span><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Ex.: retorno, avaliação, sorriso" /></label>
      <div className="library-filters" aria-label="Filtrar conteúdos">
        {(["all", "text", "sticker", "image"] as const).map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => onFilterChange(value)}>{libraryFilterLabel(value)}</button>)}
      </div>
    </div>
    {filteredItems.length ? <div className="content-library-grid">{filteredItems.map((item) => <article className="content-library-card" key={item.id}>
      <div className="content-card-top"><span className={`content-type ${item.content_type}`}>{libraryTypeLabel(item.content_type)}</span><button onClick={() => archiveItem(item)} disabled={action !== "idle"}>Arquivar</button></div>
      {item.media_url && <a className="library-media-preview" href={item.media_url} target="_blank" rel="noreferrer"><img src={item.media_url} alt="" /></a>}
      <h3>{item.name}</h3>
      <p>{item.text_template || "Conteúdo visual sem texto adicional."}</p>
      <footer><span>Pronto para campanhas</span><small>{new Date(item.created_at).toLocaleDateString("pt-BR")}</small></footer>
    </article>)}</div> : <div className="library-empty"><strong>Nenhum conteúdo encontrado.</strong><span>Adicione um texto, sticker ou imagem para reutilizar nas campanhas.</span></div>}
  </section>;
}

function BroadcastPanel({ leads, senders, broadcasts, onCreate, message }: {
  leads: LeadRow[];
  senders: BroadcastSetup["senders"];
  broadcasts: BroadcastSetup["broadcasts"];
  onCreate: (input: { name: string; senderCode: string; leadIds: string[]; text: string; scheduledAt: string }) => Promise<boolean>;
  message: string;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("Novo disparo");
  const [text, setText] = useState("");
  const [senderCode, setSenderCode] = useState("sender_1");
  const [scheduledAt, setScheduledAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [submitting, setSubmitting] = useState(false);
  const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
  const visible = leads.filter((lead) => {
    if (!normalizedSearch) return true;
    return `${lead.name ?? ""} ${lead.phone ?? ""} ${lead.email ?? ""}`.toLocaleLowerCase("pt-BR").includes(normalizedSearch);
  });
  const database = visible.filter((lead) => lead.origin_kind === "database");
  const csv = visible.filter((lead) => lead.origin_kind === "csv");

  function toggle(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }
  function toggleGroup(group: LeadRow[]) {
    const available = group.filter((lead) => lead.is_eligible && lead.phone).map((lead) => lead.id);
    const allSelected = available.length > 0 && available.every((id) => selectedIds.includes(id));
    setSelectedIds((current) => allSelected ? current.filter((id) => !available.includes(id)) : [...new Set([...current, ...available])]);
  }
  async function submit() {
    setSubmitting(true);
    const created = await onCreate({ name, senderCode, leadIds: selectedIds, text, scheduledAt: new Date(scheduledAt).toISOString() });
    if (created) {
      setSelectedIds([]);
      setText("");
    }
    setSubmitting(false);
  }
  const LeadGroup = ({ title, subtitle, group }: { title: string; subtitle: string; group: LeadRow[] }) => <section className="broadcast-group">
    <header><div><strong>{title}</strong><span>{subtitle}</span></div><button type="button" onClick={() => toggleGroup(group)}>Selecionar visíveis</button></header>
    {group.length ? <div className="broadcast-lead-list">{group.map((lead) => <label key={lead.id} className={!lead.is_eligible || !lead.phone ? "disabled" : ""}>
      <input type="checkbox" checked={selectedIds.includes(lead.id)} disabled={!lead.is_eligible || !lead.phone} onChange={() => toggle(lead.id)} />
      <span><strong>{lead.name || lead.phone || "Contato sem nome"}</strong><small>{lead.phone || "Sem telefone"}</small></span>
      {!lead.is_eligible && <em>Indisponível</em>}
    </label>)}</div> : <p>Nenhum contato encontrado.</p>}
  </section>;

  return <section className="broadcast-screen">
    <header className="broadcast-heading"><div><p className="eyebrow">Envio pontual</p><h2>Disparo único</h2><p>Escolha os contatos e envie uma única mensagem, sem alterar a cadência deles.</p></div><strong>{selectedIds.length} selecionado{selectedIds.length === 1 ? "" : "s"}</strong></header>
    <div className="broadcast-composer">
      <label>Nome do disparo<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Condição especial de agosto" /></label>
      <label>Unidade remetente<select value={senderCode} onChange={(event) => setSenderCode(event.target.value)}>{senders.map((sender) => <option value={sender.code} key={sender.code}>{sender.name}{sender.whatsapp_number ? ` · ${sender.whatsapp_number}` : ""}</option>)}</select></label>
      <label>Enviar em<input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></label>
      <label className="broadcast-text">Mensagem<textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Escreva a mensagem que os contatos selecionados receberão." rows={5} /></label>
      <button className="primary-button" onClick={submit} disabled={submitting || !selectedIds.length || !text.trim() || !senders.length}>{submitting ? "Agendando..." : "Agendar disparo"}</button>
      <small>O envio respeita o modo de segurança configurado e faz uma nova checagem antes de cada mensagem.</small>
      {message && <p className="lead-message">{message}</p>}
    </div>
    <div className="broadcast-picker"><div className="broadcast-picker-heading"><div><p className="eyebrow">Público</p><h3>Quem deve receber?</h3></div><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome ou telefone" /></div>
      <div className="broadcast-groups"><LeadGroup title="Contatos da clínica" subtitle="Recuperados da base da unidade" group={database} /><LeadGroup title="Listas CSV" subtitle="Importadas separadamente" group={csv} /></div>
    </div>
    <section className="broadcast-history"><p className="eyebrow">Últimos disparos</p>{broadcasts.length ? broadcasts.map((broadcast) => <article key={broadcast.id}><div><strong>{broadcast.name}</strong><span>{broadcast.recipients} contatos · {new Date(broadcast.scheduled_at).toLocaleString("pt-BR")}</span></div><span className={`table-status ${broadcast.status}`}>{broadcast.status}</span><small>{broadcast.sent} enviados · {broadcast.failed} falhas</small></article>) : <p>Nenhum disparo único foi agendado.</p>}</section>
  </section>;
}

function LeadTable({ leads, campaignId, campaigns, onEnroll }: {
  leads: LeadRow[];
  campaignId: string;
  campaigns: SavedCampaign[];
  onEnroll: (leadId: string) => Promise<void>;
}) {
  const campaign = campaigns.find((item) => item.id === campaignId);
  return <div className="data-table">{leads.map((lead) => (
    <article key={lead.id}>
      <div>
        <strong>{lead.name || lead.phone || "Lead sem nome"}</strong>
        <small>{lead.phone || "Contato sem telefone"} · {lead.origin_kind === "csv" ? "Lista importada" : "Base da clínica"}</small>
        <small>{lead.followup_count ?? 0} follow-up{(lead.followup_count ?? 0) === 1 ? " realizado" : "s realizados"}</small>
      </div>
      <span>{lead.campaign_name || "Aguardando inclusão em uma cadência"}</span>
      <span>{lead.last_followup_at ? `Último follow-up: ${new Date(lead.last_followup_at).toLocaleString("pt-BR")}` : "Nenhum follow-up enviado"}</span>
      <span>{lead.next_followup_at ? `Próximo: ${new Date(lead.next_followup_at).toLocaleString("pt-BR")}` : lead.campaign_name || "Sem cadência"}</span>
      <span className={`table-status ${lead.control_status ?? lead.state ?? (lead.is_eligible ? "ready" : "blocked")}`}>
        {lead.control_status ?? lead.state ?? (lead.is_eligible ? "pronto" : "bloqueado")}
      </span>
      {!lead.state && lead.is_eligible && <button
        className="table-action"
        disabled={!campaign || campaign.sourceCode !== lead.source_code}
        title={campaign && campaign.sourceCode !== lead.source_code ? "A campanha pertence a outra unidade." : undefined}
        onClick={() => onEnroll(lead.id)}
      >Incluir</button>}
    </article>
  ))}</div>;
}

function CampaignTestPanel({ initialConfig, onClose }: { initialConfig: CampaignTestConfig; onClose: () => void }) {
  const [config, setConfig] = useState(initialConfig);
  const [phone, setPhone] = useState("");
  const [recipientName, setRecipientName] = useState("Teste");
  const [senderCode, setSenderCode] = useState(initialConfig.senders[0]?.code ?? "sender_1");
  const [stepOrder, setStepOrder] = useState(initialConfig.steps[0]?.step_order ?? 1);
  const firstVariant = initialConfig.steps[0]?.variants[0]?.id ?? "";
  const [variantId, setVariantId] = useState(firstVariant);
  const [testState, setTestState] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");
  const selectedStep = config.steps.find((step) => step.step_order === stepOrder);
  const selectedVariant = selectedStep?.variants.find((variant) => variant.id === variantId) ?? selectedStep?.variants[0];
  const previewText = (selectedVariant?.textTemplate ?? "")
    .replace(/{{\s*nome(?:\s*\|\s*["'][^"']*["'])?\s*}}/gi, recipientName || "Teste");

  function changeStep(value: number) {
    setStepOrder(value);
    setVariantId(config.steps.find((step) => step.step_order === value)?.variants[0]?.id ?? "");
  }

  async function refreshHistory() {
    const response = await fetch(`/api/campaigns/${config.campaign.id}/test`);
    if (response.ok) setConfig(await response.json() as CampaignTestConfig);
  }

  async function runTest() {
    if (!phone.trim()) {
      setTestState("error");
      setTestMessage("Informe o número destinatário com DDI e DDD.");
      return;
    }
    const confirmed = config.sendMode !== "live" || window.confirm(
      `ENVIO REAL: enviar a etapa ${stepOrder} para ${phone} usando ${config.senders.find((sender) => sender.code === senderCode)?.name}?`,
    );
    if (!confirmed) return;
    setTestState("sending");
    setTestMessage("");
    try {
      const response = await fetch(`/api/campaigns/${config.campaign.id}/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phone,
          recipientName,
          senderCode,
          stepOrder,
          variantId: selectedVariant?.id,
          confirmLive: config.sendMode === "live",
        }),
      });
      const data = await response.json() as { state?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Falha ao executar teste.");
      setTestState("success");
      setTestMessage(data.state === "sent" ? "Mensagem de teste enviada." : "Teste simulado: nenhuma mensagem externa foi enviada.");
      await refreshHistory();
    } catch (error) {
      setTestState("error");
      setTestMessage(error instanceof Error ? error.message : "Falha ao executar teste.");
    }
  }

  return <section className="campaign-test-panel">
    <div className="campaign-viewer-heading">
      <div><p className="eyebrow">Teste isolado</p><h3>{config.campaign.name}</h3></div>
      <button onClick={onClose} aria-label="Fechar teste">×</button>
    </div>
    <div className={`test-mode ${config.sendMode}`}>
      {config.sendMode === "live" ? "Modo LIVE — enviará mensagem real" : "Modo DRY RUN — apenas simulação"}
    </div>
    <div className="test-form">
      <label>Número destinatário
        <input value={phone} placeholder="Ex.: 5592982492872" onChange={(event) => setPhone(event.target.value)} />
      </label>
      <label>Nome para personalização
        <input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} />
      </label>
      <label>Número remetente
        <select value={senderCode} onChange={(event) => setSenderCode(event.target.value as "sender_1" | "sender_2")}>
          {config.senders.map((sender) => <option key={sender.code} value={sender.code}>{sender.name}{sender.whatsapp_number ? ` · ${sender.whatsapp_number}` : ""}</option>)}
        </select>
      </label>
      <label>Etapa
        <select value={stepOrder} onChange={(event) => changeStep(Number(event.target.value))}>
          {config.steps.map((step) => <option key={step.step_order} value={step.step_order}>Etapa {step.step_order}</option>)}
        </select>
      </label>
      <label>Variação
        <select value={selectedVariant?.id ?? ""} onChange={(event) => setVariantId(event.target.value)}>
          {(selectedStep?.variants ?? []).map((variant) => <option key={variant.id} value={variant.id}>Variação {variant.variantOrder}</option>)}
        </select>
      </label>
    </div>
    <div className="test-preview">
      <div><strong>Prévia</strong><span>Etapa {stepOrder} · {selectedVariant?.contentType ?? "sem conteúdo"}</span></div>
      <p>{previewText || "Esta variação não possui texto."}</p>
      {selectedVariant?.mediaUrl && <a href={selectedVariant.mediaUrl} target="_blank" rel="noreferrer">Abrir mídia do teste</a>}
    </div>
    <div className="test-footer">
      <span>O teste não cria lead nem avança estágio.</span>
      <button className="primary-button" onClick={runTest} disabled={testState === "sending" || !selectedVariant}>
        {testState === "sending" ? "Executando..." : config.sendMode === "live" ? "Enviar teste real" : "Simular teste"}
      </button>
    </div>
    {testMessage && <p className={`test-result ${testState}`}>{testMessage}</p>}
    {config.recent.length > 0 && <div className="test-history">
      <strong>Testes recentes</strong>
      {config.recent.map((test) => <span key={test.id}>{new Date(test.created_at).toLocaleString("pt-BR")} · {test.recipient_phone} · etapa {test.step_order} · {test.state}</span>)}
    </div>}
  </section>;
}

function formatDuration(hours: number) {
  if (hours >= 24 && hours % 24 === 0) {
    const days = hours / 24;
    return `${days} dia${days === 1 ? "" : "s"}`;
  }
  return `${hours} hora${hours === 1 ? "" : "s"}`;
}

function CampaignViewer({ campaign, onClose }: { campaign: CampaignDetail; onClose: () => void }) {
  const modeLabel = { text: "Texto", sticker_text: "Sticker + texto", image_text: "Imagem + texto", sequence: "Sequência" };
  return <section className="campaign-viewer">
    <div className="campaign-viewer-heading">
      <div><p className="eyebrow">Detalhes da campanha</p><h3>{campaign.name}</h3></div>
      <button onClick={onClose} aria-label="Fechar detalhes">×</button>
    </div>
    <div className="campaign-facts">
      <span><strong>Unidade</strong>{campaign.sourceName}</span>
      <span><strong>Status</strong>{campaign.status === "active" ? "Ativa" : "Rascunho"}</span>
      <span><strong>Entrada</strong>{campaign.autoEnroll ? "Automática" : "Manual"}</span>
      <span><strong>Leads inscritos</strong>{campaign.enrollmentCount}</span>
      <span><strong>Janela</strong>{campaign.allowedStartTime.slice(0, 5)}–{campaign.allowedEndTime.slice(0, 5)}</span>
      <span><strong>Fuso</strong>{campaign.timezone}</span>
    </div>
    <div className="viewer-steps">{campaign.steps.map((step) => (
      <article key={step.stepOrder}>
        <div><strong>Etapa {step.stepOrder}</strong><span>Após {formatDuration(step.delayHours)} · {modeLabel[step.contentMode]}</span></div>
        {step.variants.length === 0 ? <small>Sem conteúdo cadastrado.</small> : step.variants.map((variant) => (
          <div className="viewer-variant" key={variant.id}>
            <p>{variant.textTemplate || "Sem texto"}</p>
            {variant.mediaUrl && <a href={variant.mediaUrl} target="_blank" rel="noreferrer">Abrir mídia</a>}
          </div>
        ))}
      </article>
    ))}</div>
  </section>;
}

function Select({ label, value, options, onChange, disabled = false }: { label: string; value: string; options: string[]; onChange: (value: string) => void; disabled?: boolean }) {
  return <label>{label}<select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}
