import { extractAdDestination } from "./meta-core.ts";

export type AssetCheck = {
  key: "configuration" | "token" | "ad" | "destination" | "page" | "dataset";
  status: "passed" | "failed" | "skipped";
  reason: string;
  httpStatus?: number;
  errorCode?: number;
};
export type MetaAssetValidation = {
  checkedAt: string;
  status: "passed" | "failed";
  reason: string;
  graphVersion: string | null;
  sourceId: string | null;
  pageId: string | null;
  datasetId: string | null;
  checks: AssetCheck[];
  noEventSent: true;
  exportAuthorized: false;
  numberAssociationVerified: false;
};

const numericId = (value: unknown): value is string => typeof value === "string" && /^\d{5,30}$/.test(value);

/** GETs only. A successful result proves readable assets, NOT WhatsApp export support,
 * ownership, connection to a clinic's number, or advertising attribution. */
export async function validateMetaAssets(
  input: { accessToken: string | null; graphVersion: string | null; sourceId: string | null; sourceBelongsToUnit: boolean },
  read: typeof fetch = fetch,
): Promise<MetaAssetValidation> {
  const result: MetaAssetValidation = {
    checkedAt: new Date().toISOString(), status: "failed", reason: "Verificação incompleta.",
    graphVersion: input.graphVersion, sourceId: input.sourceId, pageId: null, datasetId: null,
    checks: [], noEventSent: true, exportAuthorized: false, numberAssociationVerified: false,
  };
  const add = (key: AssetCheck["key"], status: AssetCheck["status"], reason: string) => result.checks.push({ key, status, reason });
  const finish = () => {
    for (const key of ["token", "ad", "destination", "page", "dataset"] as const) {
      if (!result.checks.some((check) => check.key === key)) add(key, "skipped", "Não consultado porque uma verificação anterior não foi concluída.");
    }
    result.status = result.checks.every((check) => check.status === "passed") ? "passed" : "failed";
    result.reason = result.status === "passed"
      ? "Acesso ao anúncio, à Página e ao dataset confirmado. Vínculo ao número e envio WhatsApp sem WABA não foram comprovados. Somente registro interno."
      : result.checks.find((check) => check.status === "failed")?.reason || "Verificação incompleta.";
    return result;
  };
  if (!input.accessToken) {
    add("configuration", "failed", "Salve o token Meta desta unidade antes de testar.");
    return finish();
  }
  if (!input.graphVersion || !/^v\d+\.\d+$/.test(input.graphVersion)) {
    add("configuration", "failed", "Configure META_GRAPH_API_VERSION no servidor com uma versão Graph suportada (formato vNN.N).");
    return finish();
  }
  add("configuration", "passed", `Versão Graph ${input.graphVersion}; credencial exclusiva desta unidade.`);
  // Do not persist raw Graph messages, names, tokens or returned profiles.
  const get = async (key: AssetCheck["key"], path: string): Promise<Record<string, unknown> | null> => {
    try {
      const response = await read(`https://graph.facebook.com/${input.graphVersion}/${path}`, {
        method: "GET", headers: { Authorization: `Bearer ${input.accessToken}` },
        signal: AbortSignal.timeout(5_000), cache: "no-store", redirect: "error",
      });
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid_json");
      const object = payload as Record<string, unknown>;
      const error = object.error as { code?: unknown } | undefined;
      if (!response.ok || error) {
        const code = typeof error?.code === "number" ? error.code : undefined;
        const reason = code === 190 ? "Token inválido, expirado ou revogado. Gere outro token e salve nesta unidade."
          : response.status === 429 || response.status >= 500 ? "Meta temporariamente indisponível ou limite de consultas atingido. Tente novamente mais tarde."
          : code === 10 || code === 200 || response.status === 403 ? "Sem permissão de leitura para este recurso. Verifique as permissões do token e o acesso ao ativo."
          : "A Meta não disponibilizou este recurso/campo. Confira o ID, a versão Graph e as permissões do token.";
        result.checks.push({ key, status: "failed", reason, httpStatus: response.status, ...(code !== undefined ? { errorCode: code } : {}) });
        return null;
      }
      return object;
    } catch {
      add(key, "failed", "Não foi possível concluir a consulta à Meta: falha de rede, tempo esgotado ou resposta inválida. Tente novamente.");
      return null;
    }
  };
  const identity = await get("token", "me?fields=id");
  if (!identity) return finish();
  if (!numericId(identity.id)) {
    add("token", "failed", "A Meta não confirmou a identidade associada ao token.");
    return finish();
  }
  add("token", "passed", "Token aceito para consulta de identidade. Isso não comprova permissão de envio de eventos.");
  if (!numericId(input.sourceId) || !input.sourceBelongsToUnit) {
    add("ad", "failed", "Informe um source_id numérico já capturado pelo n8n nesta unidade. Sem esse vínculo, o anúncio não é consultado.");
    return finish();
  }
  const ad = await get("ad", `${input.sourceId}?fields=id,tracking_specs`);
  if (!ad) return finish();
  if (ad.id !== input.sourceId) {
    add("ad", "failed", "O ID retornado pela Meta não corresponde ao anúncio solicitado.");
    return finish();
  }
  add("ad", "passed", "Anúncio acessível com o token desta unidade; source_id presente na captação interna.");
  try {
    const destination = extractAdDestination(ad);
    result.pageId = destination.pageId;
    result.datasetId = destination.datasetId;
    add("destination", "passed", "tracking_specs referencia exatamente uma Página e um dataset. Isso não confirma vínculo ao número WhatsApp.");
  } catch {
    add("destination", "failed", "tracking_specs não contém uma única Página e um único dataset com IDs válidos. Revise o anúncio; nenhum destino foi escolhido arbitrariamente.");
    return finish();
  }
  // Sequential checks preserve the report's reading order and bound the test to four GETs.
  for (const [key, id] of [["page", result.pageId], ["dataset", result.datasetId]] as const) {
    const asset = await get(key, `${id}?fields=id`);
    if (!asset) continue;
    add(key, asset.id === id ? "passed" : "failed", asset.id === id
      ? "ID referenciado pelo anúncio confirmado e acessível em consulta de leitura."
      : "O recurso retornado não corresponde ao ID referenciado pelo anúncio.");
  }
  return finish();
}
