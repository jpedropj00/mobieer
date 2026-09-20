import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, CalendarClock, CheckCircle2, ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorMessage } from "@/lib/errors";
import { compressImage, fmtBytes } from "@/lib/image";
import { portalApi, portalGet, portalObjectUrl, portalPost } from "@/services/portal-api";

export type AssistanceSchedule = {
  stage: "SEM_DATAS" | "AGUARDANDO_CLIENTE" | "AGENDADA" | "CONFIRMADA" | "REMARCAR";
  scheduledAt: string | null;
  scheduledLabel: string | null;
  clientConfirmedAt: string | null;
  options: { id: string; startsAt: string; period: string | null; label: string; chosen: boolean }[];
};

export type PortalAssistance = {
  id: string;
  number: string;
  title: string;
  status: string;
  createdAt: string;
  problemType: string | null;
  roomLabel: string | null;
  description: string;
  attachments: { id: string; fileName: string; mimeType: string; createdAt: string; downloadUrl: string }[];
  schedule: AssistanceSchedule;
};

type Options = { problemTypes: string[]; minPhotos: number; maxPhotos: number; minDescription: number };

const STATUS: Record<string, string> = {
  OPEN: "Recebido",
  TRIAGE: "Em análise",
  WAITING_CLIENT: "Escolha a data",
  SCHEDULED: "Visita marcada",
  IN_PROGRESS: "Em atendimento",
  RESOLVED: "Resolvido",
  CANCELLED: "Cancelado",
};

const fmtDate = (v: string) => new Date(v).toLocaleDateString("pt-BR");

function Thumb({ path }: { path: string }) {
  const { data } = useQuery({ queryKey: ["portal-img", path], queryFn: () => portalObjectUrl(path), staleTime: 5 * 60_000 });
  if (!data) return <div className="h-14 w-14 shrink-0 animate-pulse rounded-md bg-muted" />;
  return (
    <a href={data} target="_blank" rel="noreferrer" className="shrink-0">
      <img src={data} alt="Foto do pedido" className="h-14 w-14 rounded-md border border-border object-cover" />
    </a>
  );
}

/**
 * Assistência no portal: só o cliente pede, com tipo do problema, ambiente,
 * descrição detalhada e fotos. Depois escolhe a data entre as que a equipe
 * propôs e confirma a visita.
 */
export function PortalAssistanceTab({ projectId, assistances }: { projectId: string; assistances: PortalAssistance[] }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["portal", "project", projectId] });
  const opts = useQuery({ queryKey: ["portal", "assistance-options"], queryFn: () => portalGet<{ data: Options }>("/assistances/options") });
  const o = opts.data?.data;

  const [form, setForm] = useState({ problemType: "", roomLabel: "", description: "" });
  const [photos, setPhotos] = useState<{ file: File; preview: string }[]>([]);
  const [preparing, setPreparing] = useState(false);

  // libera as prévias da memória
  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.preview)), [photos]);

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length || !o) return;
    const room = o.maxPhotos - photos.length;
    if (room <= 0) {
      toast.error(`Até ${o.maxPhotos} fotos no pedido. Depois dá para anexar mais.`);
      return;
    }
    setPreparing(true);
    try {
      const picked = Array.from(files).slice(0, room);
      const compressed = await Promise.all(picked.map((f) => compressImage(f)));
      setPhotos((cur) => [...cur, ...compressed.map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
      if (files.length > room) toast.message(`Foram adicionadas só ${room} foto(s) — limite de ${o.maxPhotos}.`);
    } finally {
      setPreparing(false);
    }
  };

  const removePhoto = (i: number) =>
    setPhotos((cur) => {
      URL.revokeObjectURL(cur[i].preview);
      return cur.filter((_, idx) => idx !== i);
    });

  const open = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("projectId", projectId);
      fd.append("problemType", form.problemType);
      fd.append("roomLabel", form.roomLabel.trim());
      fd.append("description", form.description.trim());
      photos.forEach((p) => fd.append("photos", p.file, p.file.name));
      return portalApi<{ message?: string }>("/assistances", { method: "POST", body: fd });
    },
    onSuccess: (r) => {
      toast.success(r.message ?? "Pedido enviado");
      setForm({ problemType: "", roomLabel: "", description: "" });
      setPhotos([]);
      refresh();
    },
    onError: (err) => toast.error(errorMessage(err, "Não foi possível enviar o pedido")),
  });

  const addPhoto = useMutation({
    mutationFn: async ({ ticketId, file }: { ticketId: string; file: File }) => {
      const fd = new FormData();
      fd.append("photo", await compressImage(file));
      return portalApi(`/assistances/${ticketId}/attachments`, { method: "POST", body: fd });
    },
    onSuccess: () => {
      toast.success("Foto anexada");
      refresh();
    },
    onError: (err) => toast.error(errorMessage(err, "Falha ao anexar a foto")),
  });

  const minDesc = o?.minDescription ?? 20;
  const descLen = form.description.trim().length;
  const valid = Boolean(form.problemType) && form.roomLabel.trim().length >= 2 && descLen >= minDesc && photos.length >= (o?.minPhotos ?? 1);
  const totalSize = photos.reduce((a, p) => a + p.file.size, 0);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pedir assistência</CardTitle>
          <p className="text-sm text-muted-foreground">
            Conte o que aconteceu e mande fotos. Com isso a equipe já vai preparada e te envia as datas para a visita.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Tipo do problema *</Label>
              <Select value={form.problemType} onValueChange={(v) => setForm({ ...form, problemType: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {(o?.problemTypes ?? []).map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="as-room">Ambiente *</Label>
              <Input id="as-room" value={form.roomLabel} onChange={(e) => setForm({ ...form, roomLabel: e.target.value })} placeholder="Ex.: Cozinha, banheiro da suíte" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="as-desc">Descreva com detalhes *</Label>
            <Textarea
              id="as-desc"
              rows={4}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="O que aconteceu, desde quando e onde exatamente (qual porta, gaveta, lado do armário...)"
            />
            <p className={`text-xs ${descLen > 0 && descLen < minDesc ? "text-warning" : "text-muted-foreground"}`}>
              {descLen < minDesc ? `Mais ${minDesc - descLen} caractere(s) no mínimo` : "Ótimo, bem explicado"}
            </p>
          </div>

          <div className="space-y-2">
            <Label>Fotos do problema * (até {o?.maxPhotos ?? 6})</Label>
            <div className="flex flex-wrap gap-2">
              {photos.map((p, i) => (
                <div key={p.preview} className="relative">
                  <img src={p.preview} alt={`Foto ${i + 1}`} className="h-20 w-20 rounded-md border border-border object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    className="absolute -right-2 -top-2 rounded-full bg-foreground p-0.5 text-background"
                    aria-label="Remover foto"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {photos.length < (o?.maxPhotos ?? 6) && (
                <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-xs text-muted-foreground hover:bg-muted/50">
                  {preparing ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
                  Foto
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      void addPhotos(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
            {photos.length > 0 && <p className="text-xs text-muted-foreground">{photos.length} foto(s) · {fmtBytes(totalSize)}</p>}
          </div>

          <Button className="w-full sm:w-auto" disabled={!valid || open.isPending || preparing} onClick={() => open.mutate()}>
            {open.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Enviar pedido de assistência
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Seus pedidos</h3>
        {assistances.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Nenhum pedido neste projeto.</p>
        ) : (
          assistances.map((a) => (
            <div key={a.id} className="space-y-3 rounded-lg border border-border bg-card px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {a.number} — {a.title}
                  </p>
                  <p className="text-xs text-muted-foreground">Pedido em {fmtDate(a.createdAt)}</p>
                </div>
                <Badge variant={a.schedule.stage === "AGUARDANDO_CLIENTE" ? "warning" : "secondary"}>{STATUS[a.status] ?? a.status}</Badge>
              </div>

              <ScheduleBox assistance={a} onChange={refresh} />

              <div className="flex flex-wrap items-center gap-2">
                {a.attachments.map((att) => (
                  <Thumb key={att.id} path={att.downloadUrl.replace("/api/portal", "")} />
                ))}
                {a.status !== "RESOLVED" && a.status !== "CANCELLED" && (
                  <label className="flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground hover:bg-muted/50">
                    + foto
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) addPhoto.mutate({ ticketId: a.id, file: f });
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ScheduleBox({ assistance, onChange }: { assistance: PortalAssistance; onChange: () => void }) {
  const s = assistance.schedule;
  const [picked, setPicked] = useState<string | null>(null);

  const choose = useMutation({
    mutationFn: (optionId: string) => portalPost<{ message?: string }>(`/assistances/${assistance.id}/choose`, { optionId }),
    onSuccess: (r) => {
      toast.success(r.message ?? "Data escolhida");
      onChange();
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível marcar a data")),
  });
  const confirm = useMutation({
    mutationFn: () => portalPost(`/assistances/${assistance.id}/confirm`),
    onSuccess: () => {
      toast.success("Visita confirmada");
      onChange();
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível confirmar")),
  });
  const reschedule = useMutation({
    mutationFn: () => portalPost(`/assistances/${assistance.id}/reschedule`, {}),
    onSuccess: () => {
      toast.success("Pedido de nova data enviado à equipe");
      onChange();
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível pedir nova data")),
  });

  if (assistance.status === "RESOLVED" || assistance.status === "CANCELLED") return null;

  if (s.stage === "SEM_DATAS" || s.stage === "REMARCAR") {
    return (
      <p className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        <CalendarClock className="h-4 w-4" />
        {s.stage === "REMARCAR" ? "Pedido de nova data recebido. A equipe vai enviar outras opções." : "A equipe vai enviar as datas disponíveis para a visita."}
      </p>
    );
  }

  if (s.stage === "AGUARDANDO_CLIENTE") {
    return (
      <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
        <p className="text-sm font-medium">Escolha a melhor data para a visita</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {s.options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setPicked(opt.id)}
              className={`rounded-md border px-3 py-2 text-left text-sm transition ${picked === opt.id ? "border-primary bg-primary/10 font-medium" : "border-border bg-card hover:bg-muted/50"}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!picked || choose.isPending} onClick={() => picked && choose.mutate(picked)}>
            {choose.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Marcar esta data
          </Button>
          <Button size="sm" variant="ghost" disabled={reschedule.isPending} onClick={() => reschedule.mutate()}>
            Nenhuma serve
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2">
      <p className="flex items-center gap-2 text-sm">
        {s.stage === "CONFIRMADA" ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <CalendarCheck className="h-4 w-4 text-primary" />}
        Visita {s.stage === "CONFIRMADA" ? "confirmada" : "marcada"}: <strong>{s.scheduledLabel}</strong>
      </p>
      <div className="flex gap-2">
        {s.stage === "AGENDADA" && (
          <Button size="sm" disabled={confirm.isPending} onClick={() => confirm.mutate()}>
            Confirmar
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={reschedule.isPending} onClick={() => reschedule.mutate()}>
          Remarcar
        </Button>
      </div>
    </div>
  );
}
