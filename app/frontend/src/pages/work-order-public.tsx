import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, MapPin, Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SignaturePad } from "@/components/signature-pad";
import { errorFromResponse, errorMessage, readJson, safeFetch } from "@/lib/errors";

type Task = { id: string; name: string; status: "PENDING" | "IN_PROGRESS" | "PAUSED" | "DONE"; startedAt: string | null; finishedAt: string | null; workedMinutes: number };
type WorkOrder = {
  number: string;
  status: "OPEN" | "DONE";
  scheduledFor: string | null;
  instructions: string | null;
  project: { code: string; name: string };
  client: { name: string; phone: string | null; address: string | null };
  contractor: { name: string };
  tasks: Task[];
  progress: { total: number; done: number };
  receivedByName: string | null;
  completedAt: string | null;
};

async function call<T>(path: string, body?: unknown): Promise<{ data: T; message?: string }> {
  const res = await safeFetch(`/api/public/os/${path}`, {
    method: body !== undefined ? "POST" : "GET",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = await readJson(res);
  if (!res.ok) throw await errorFromResponse(res, payload);
  return payload as { data: T; message?: string };
}

const STATUS_LABEL: Record<Task["status"], string> = { PENDING: "A fazer", IN_PROGRESS: "Em montagem", PAUSED: "Pausado", DONE: "Concluído" };
const hours = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;

/** Página do QR da requisição de montagem: sem login, feita para o celular na obra. */
export function WorkOrderPublicPage() {
  const { token = "" } = useParams();
  const qc = useQueryClient();
  const key = ["public-os", token];
  const q = useQuery({ queryKey: key, queryFn: () => call<WorkOrder>(encodeURIComponent(token)), retry: false });
  const act = useMutation({
    mutationFn: ({ taskId, action }: { taskId: string; action: "start" | "pause" | "finish" }) =>
      call<WorkOrder>(`${encodeURIComponent(token)}/tasks/${taskId}/${action}`, {}),
    onSuccess: (r) => {
      qc.setQueryData(key, r);
      toast.success(r.message ?? "Feito");
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível")),
  });

  if (q.isLoading) {
    return <Shell><p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p></Shell>;
  }
  const o = q.data?.data;
  if (!o) {
    return (
      <Shell>
        <p className="text-lg font-semibold">Link inválido ou expirado</p>
        <p className="text-sm text-muted-foreground">Esta requisição foi cancelada, trocada por uma folha nova ou já encerrou. Fale com a loja.</p>
      </Shell>
    );
  }
  const allDone = o.progress.total > 0 && o.progress.done === o.progress.total;

  return (
    <Shell>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Requisição de montagem</p>
        <h1 className="text-xl font-bold">{o.number}</h1>
        <p className="text-sm">{o.project.code} — {o.project.name}</p>
        <p className="text-sm text-muted-foreground">Montador: {o.contractor.name}</p>
      </div>

      <div className="rounded-lg border bg-card p-3 text-sm">
        <p className="font-medium">{o.client.name}</p>
        {o.client.address && (
          <a className="mt-1 flex items-start gap-1 text-primary" href={`https://maps.google.com/?q=${encodeURIComponent(o.client.address)}`} target="_blank" rel="noreferrer">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" /> {o.client.address}
          </a>
        )}
        {o.client.phone && <a className="mt-1 block text-primary" href={`tel:${o.client.phone.replace(/\D/g, "")}`}>{o.client.phone}</a>}
        {o.instructions && <p className="mt-2 whitespace-pre-line text-muted-foreground">{o.instructions}</p>}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Cômodos — {o.progress.done} de {o.progress.total} concluídos</p>
        {o.tasks.map((t) => (
          <div key={t.id} className="rounded-lg border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-medium">{t.name}</p>
                <p className="text-xs text-muted-foreground">
                  {STATUS_LABEL[t.status]}
                  {t.workedMinutes > 0 ? ` · ${hours(t.workedMinutes)} trabalhadas` : ""}
                </p>
              </div>
              {t.status === "DONE" && <CheckCircle2 className="h-6 w-6 text-success" />}
            </div>
            {o.status === "OPEN" && t.status !== "DONE" && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {t.status === "IN_PROGRESS" ? (
                  <>
                    <Button variant="outline" size="lg" disabled={act.isPending} onClick={() => act.mutate({ taskId: t.id, action: "pause" })}><Pause className="mr-1 h-4 w-4" /> Pausar</Button>
                    <Button size="lg" disabled={act.isPending} onClick={() => act.mutate({ taskId: t.id, action: "finish" })}><CheckCircle2 className="mr-1 h-4 w-4" /> Concluir</Button>
                  </>
                ) : (
                  <Button size="lg" className="col-span-2" disabled={act.isPending} onClick={() => act.mutate({ taskId: t.id, action: "start" })}>
                    <Play className="mr-1 h-4 w-4" /> {t.status === "PAUSED" ? "Retomar" : "Iniciar"}
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {o.status === "DONE" ? (
        <div className="rounded-lg border border-success/40 bg-success/10 p-4 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-success" />
          <p className="mt-1 font-semibold">Montagem concluída</p>
          <p className="text-sm text-muted-foreground">Recebido por {o.receivedByName}. Pode guardar o celular — a loja já foi avisada.</p>
        </div>
      ) : allDone ? (
        <CompleteForm token={token} onDone={(r) => qc.setQueryData(key, r)} />
      ) : (
        <p className="text-center text-xs text-muted-foreground">Ao concluir todos os cômodos, aparece aqui a conferência do cliente.</p>
      )}
    </Shell>
  );
}

function CompleteForm({ token, onDone }: { token: string; onDone: (r: { data: WorkOrder; message?: string }) => void }) {
  const [name, setName] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => call<WorkOrder>(`${encodeURIComponent(token)}/complete`, { receivedByName: name, signature }),
    onSuccess: (r) => {
      toast.success(r.message ?? "Concluída");
      onDone(r);
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível concluir")),
  });
  return (
    <div className="space-y-3 rounded-lg border bg-card p-3">
      <p className="font-medium">Conferência do cliente</p>
      <p className="text-sm text-muted-foreground">Peça ao cliente (ou responsável) para conferir a montagem, escrever o nome e assinar.</p>
      <Input placeholder="Nome de quem recebeu" value={name} onChange={(e) => setName(e.target.value)} />
      <SignaturePad onChange={setSignature} height={160} />
      <Button size="lg" className="w-full" disabled={name.trim().length < 2 || !signature || save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? "Enviando…" : "Finalizar montagem"}
      </Button>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.title = "Requisição de montagem";
  }, []);
  return (
    <div className="min-h-screen bg-muted/30 px-4 py-6">
      <div className="mx-auto max-w-md space-y-4">{children}</div>
    </div>
  );
}
