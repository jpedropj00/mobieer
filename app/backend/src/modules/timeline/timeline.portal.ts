/**
 * §12 — A timeline vista pelo cliente no portal.
 *
 * O cliente vê o fluxo da especificação (briefing → … → assistência), não as
 * etapas internas de venda (lead, negociação) nem as de bastidor (termo de
 * produção, entrega). Não vê responsável nem observação interna, e "bloqueada"
 * aparece como "em andamento": o problema é da equipe resolver, não um estado
 * que o cliente consiga mudar.
 */
import { StageStatus, TimelineStageKey } from "@prisma/client";

export const CLIENT_STAGES: TimelineStageKey[] = [
  "BRIEFING",
  "ORCAMENTO",
  "CONTRATO",
  "PAGAMENTO_ENTRADA",
  "MEDICAO",
  "PROJETO_TECNICO",
  "APROVACAO",
  "PRODUCAO",
  "PRE_MONTAGEM",
  "MONTAGEM",
  "VISTORIA",
  "GARANTIA",
  "ASSISTENCIA",
];

const CLIENT_LABEL: Partial<Record<TimelineStageKey, string>> = {
  PAGAMENTO_ENTRADA: "Pagamento",
  PROJETO_TECNICO: "Projeto",
};

export type ClientStageStatus = "DONE" | "CURRENT" | "UPCOMING" | "NOT_APPLICABLE";

export function clientTimeline(
  stages: { key: TimelineStageKey; status: StageStatus; plannedAt: Date | null; startedAt: Date | null; completedAt: Date | null }[],
  labels: Record<TimelineStageKey, string>
) {
  const byKey = new Map(stages.map((s) => [s.key, s]));
  const rows = CLIENT_STAGES.map((key) => {
    const s = byKey.get(key);
    const st = s?.status ?? "PENDENTE";
    const status: ClientStageStatus =
      st === "CONCLUIDA" ? "DONE" : st === "NAO_APLICAVEL" ? "NOT_APPLICABLE" : st === "EM_ANDAMENTO" || st === "BLOQUEADA" ? "CURRENT" : "UPCOMING";
    return {
      key,
      label: CLIENT_LABEL[key] ?? labels[key],
      status,
      // previsão só enquanto não aconteceu; depois vale a data real
      plannedAt: status === "UPCOMING" || status === "CURRENT" ? s?.plannedAt ?? null : null,
      startedAt: s?.startedAt ?? null,
      completedAt: status === "DONE" ? s?.completedAt ?? null : null,
    };
  });
  // Sem etapa "em andamento" marcada, a atual é a primeira pendente depois da
  // última concluída — o cliente sempre enxerga onde o projeto está.
  if (!rows.some((r) => r.status === "CURRENT")) {
    const lastDone = rows.map((r) => r.status).lastIndexOf("DONE");
    const next = rows.findIndex((r, i) => i > lastDone && r.status === "UPCOMING");
    // garantia e assistência não viram "atual" por eliminação
    if (next >= 0 && rows[next].key !== "GARANTIA" && rows[next].key !== "ASSISTENCIA") rows[next].status = "CURRENT";
  }
  // como na timeline interna: a obra termina na vistoria; garantia e
  // assistência são pós-obra e não entram no percentual
  const applicable = rows.filter((r) => r.status !== "NOT_APPLICABLE" && r.key !== "GARANTIA" && r.key !== "ASSISTENCIA");
  const done = applicable.filter((r) => r.status === "DONE").length;
  return {
    stages: rows,
    current: rows.find((r) => r.status === "CURRENT")?.label ?? null,
    progress: applicable.length ? Math.round((done / applicable.length) * 100) : 0,
  };
}
