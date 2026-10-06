import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileDown, FileSignature, Loader2, Plus, Save, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiGet, apiOpen, apiPost, apiPut } from "@/services/api";
import { errorMessage } from "@/lib/errors";

type Term = { contractNumber: string; rooms: { date: string; room: string }[]; deadlines: { label: string; date: string | null }[]; deliveryDays: number; city: string; date: string };
type Published = { id: string; version: number; signatureStatus: "NOT_REQUIRED" | "PENDING" | "SIGNED"; signatures: { role: string; signerName: string; signedAt: string }[] };
type Payload = { saved: boolean; data: Term; client: { name: string; document: string | null }; document: Published | null };

const ROLE_LABEL: Record<string, string> = { MOBIEER: "Loja", CLIENTE: "Cliente" };

/**
 * Termo de entrega (preparação do ambiente + autorização de produção): a loja
 * preenche, envia ao portal do cliente e os dois assinam.
 */
export function DeliveryTermPanel({ projectId, canManage, onPublished }: { projectId: string; canManage: boolean; onPublished: () => void }) {
  const qc = useQueryClient();
  const key = ["delivery-term", projectId];
  const base = `/production/projects/${projectId}/delivery-term`;
  const q = useQuery({ queryKey: key, queryFn: () => apiGet<{ data: Payload }>(base) });
  const [t, setT] = useState<Term | null>(null);
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (q.data && !dirty) setT(q.data.data.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  const fail = (e: unknown) => toast.error(errorMessage(e, "Não foi possível atualizar o termo de entrega"));
  const body = () => ({ ...t!, rooms: t!.rooms.filter((r) => r.room.trim()), deadlines: t!.deadlines.filter((d) => d.label.trim()) });
  const persist = async () => {
    await apiPut(base, body());
    setDirty(false);
  };
  const save = useMutation({ mutationFn: persist, onSuccess: () => { toast.success("Termo salvo"); qc.invalidateQueries({ queryKey: key }); }, onError: fail });
  const openPdf = useMutation({ mutationFn: async () => { if (canManage && (dirty || !q.data?.data.saved)) await persist(); await apiOpen(`${base}.pdf`); }, onError: fail });
  const publish = useMutation({
    mutationFn: async () => { await persist(); return apiPost<{ message?: string }>(`${base}/publish`, {}); },
    onSuccess: (r) => { toast.success(r.message ?? "Termo enviado ao portal do cliente"); qc.invalidateQueries({ queryKey: key }); onPublished(); },
    onError: fail,
  });

  if (q.isLoading || !t) return null;
  const d = q.data!.data;
  const edit = (patch: Partial<Term>) => { setT({ ...t, ...patch }); setDirty(true); };
  const signedBy = (role: string) => d.document?.signatures.find((s) => s.role === role);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 py-4">
        <div>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <FileSignature className="h-4 w-4" /> Termo de entrega
            {d.document && (
              <Badge variant={d.document.signatureStatus === "SIGNED" ? "success" : "warning"}>
                {d.document.signatureStatus === "SIGNED" ? "Assinado" : `Enviado (v${d.document.version}) · assinatura pendente`}
              </Badge>
            )}
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Preparação do ambiente e autorização de produção. Vai para o portal do cliente, e a loja e o cliente assinam.</p>
          {d.document && (
            <p className="mt-1 text-xs text-muted-foreground">
              {["MOBIEER", "CLIENTE"].map((r) => `${ROLE_LABEL[r]}: ${signedBy(r) ? `assinou (${signedBy(r)!.signerName})` : "falta assinar"}`).join(" · ")}
              {d.document.signatureStatus !== "SIGNED" && " — a loja assina na lista abaixo, no botão Assinar."}
            </p>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>{open ? "Fechar" : d.document ? "Editar e reenviar" : "Preencher"}</Button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1"><Label className="text-xs">Nº do contrato</Label><Input disabled={!canManage} value={t.contractNumber} onChange={(e) => edit({ contractNumber: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Prazo (dias úteis)</Label><Input disabled={!canManage} inputMode="numeric" value={String(t.deliveryDays)} onChange={(e) => edit({ deliveryDays: Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1) })} /></div>
            <div className="space-y-1"><Label className="text-xs">Cidade</Label><Input disabled={!canManage} value={t.city} onChange={(e) => edit({ city: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Data do termo</Label><Input disabled={!canManage} type="date" value={t.date} onChange={(e) => edit({ date: e.target.value })} /></div>
          </div>
          <p className="text-xs text-muted-foreground">Cliente: <span className="font-medium text-foreground">{d.client.name}</span>{d.client.document ? ` · ${d.client.document}` : " · sem CPF/CNPJ no cadastro (sai em branco no termo)"}</p>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Relação de ambientes</Label>
              {canManage && <Button type="button" size="sm" variant="outline" onClick={() => edit({ rooms: [...t.rooms, { date: t.date, room: "" }] })}><Plus className="mr-1 h-3.5 w-3.5" /> Ambiente</Button>}
            </div>
            {!t.rooms.length && <p className="text-xs text-muted-foreground">Nenhum ambiente. Adicione os ambientes aprovados.</p>}
            {t.rooms.map((r, i) => (
              <div key={i} className="flex gap-2">
                <Input disabled={!canManage} type="date" className="w-40 shrink-0" value={r.date} onChange={(e) => edit({ rooms: t.rooms.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) })} />
                <Input disabled={!canManage} placeholder="Ambiente (ex.: Cozinha)" value={r.room} onChange={(e) => edit({ rooms: t.rooms.map((x, j) => (j === i ? { ...x, room: e.target.value } : x)) })} />
                {canManage && <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" title="Remover" onClick={() => edit({ rooms: t.rooms.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>}
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Prazos (data em branco sai como espaço para preencher à mão)</Label>
              {canManage && <Button type="button" size="sm" variant="outline" disabled={t.deadlines.length >= 6} onClick={() => edit({ deadlines: [...t.deadlines, { label: "Prazo de entrega ", date: null }] })}><Plus className="mr-1 h-3.5 w-3.5" /> Prazo</Button>}
            </div>
            {t.deadlines.map((dl, i) => (
              <div key={i} className="flex gap-2">
                <Input disabled={!canManage} placeholder="Ex.: Prazo de entrega cozinha" value={dl.label} onChange={(e) => edit({ deadlines: t.deadlines.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                <Input disabled={!canManage} type="date" className="w-40 shrink-0" value={dl.date ?? ""} onChange={(e) => edit({ deadlines: t.deadlines.map((x, j) => (j === i ? { ...x, date: e.target.value || null } : x)) })} />
                {canManage && <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" title="Remover" onClick={() => edit({ deadlines: t.deadlines.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            {canManage && <Button size="sm" variant="outline" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />} Salvar</Button>}
            <Button size="sm" variant="outline" disabled={openPdf.isPending} onClick={() => openPdf.mutate()}>{openPdf.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileDown className="mr-1 h-4 w-4" />} Ver PDF</Button>
            {canManage && (
              <Button size="sm" disabled={publish.isPending} onClick={() => publish.mutate()}>
                {publish.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />} {d.document ? "Enviar nova versão ao cliente" : "Enviar ao portal do cliente"}
              </Button>
            )}
          </div>
          {d.document && <p className="text-right text-xs text-muted-foreground">Enviar de novo cria uma nova versão e as assinaturas recomeçam.</p>}
        </CardContent>
      )}
    </Card>
  );
}
