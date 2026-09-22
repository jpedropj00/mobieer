import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock, Loader2, MapPin, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiGet, apiPost } from "@/services/api";
import { errorMessage } from "@/lib/errors";

type Invitation = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  location: string | null;
  responsible: { id: string; name: string };
  client: { id: string; name: string } | null;
  project: { id: string; code: string; name: string } | null;
  response: "PENDENTE" | "ACEITO" | "RECUSADO" | "REMARCAR";
};

const fmt = (d: string) =>
  new Date(d).toLocaleString("pt-BR", { timeZone: "America/Fortaleza", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Convites da agenda aguardando resposta: aceitar, recusar ou pedir outro horário. */
export function AgendaInvitations() {
  const qc = useQueryClient();
  const [modo, setModo] = useState<{ ev: Invitation; tipo: "RECUSADO" | "REMARCAR" } | null>(null);
  const [nota, setNota] = useState("");
  const [novo, setNovo] = useState("");

  const q = useQuery({
    queryKey: ["agenda", "invitations"],
    queryFn: () => apiGet<{ data: Invitation[] }>("/agenda/invitations", { pending: "true" }),
  });

  const responder = useMutation({
    mutationFn: (p: { id: string; response: string; note?: string; proposedStart?: string }) => apiPost<{ message?: string }>(`/agenda/${p.id}/respond`, p),
    onSuccess: (r) => {
      toast.success(r.message ?? "Resposta enviada");
      setModo(null);
      setNota("");
      setNovo("");
      qc.invalidateQueries({ queryKey: ["agenda"] });
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível responder")),
  });

  const convites = q.data?.data ?? [];
  if (!convites.length) return null;

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Convites aguardando sua resposta ({convites.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {convites.map((ev) => (
          <div key={ev.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
            <div className="min-w-0">
              <p className="font-medium">{ev.title}</p>
              <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {fmt(ev.startAt)}</span>
                {ev.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {ev.location}</span>}
                <span>por {ev.responsible.name}</span>
                {ev.project && <span>{ev.project.code}</span>}
              </p>
            </div>
            <div className="flex gap-1">
              <Button size="sm" onClick={() => responder.mutate({ id: ev.id, response: "ACEITO" })} disabled={responder.isPending}>
                <Check className="h-4 w-4" /> Aceitar
              </Button>
              <Button size="sm" variant="outline" onClick={() => setModo({ ev, tipo: "REMARCAR" })}>Outro horário</Button>
              <Button size="sm" variant="ghost" onClick={() => setModo({ ev, tipo: "RECUSADO" })} aria-label="Recusar">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>

      {modo && (
        <Dialog open onOpenChange={() => setModo(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{modo.tipo === "RECUSADO" ? "Recusar compromisso" : "Pedir outro horário"}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">{modo.ev.title} · {fmt(modo.ev.startAt)}</p>
            {modo.tipo === "REMARCAR" && (
              <div className="space-y-1.5">
                <Label htmlFor="inv-novo" className="text-xs">Horário sugerido *</Label>
                <Input id="inv-novo" type="datetime-local" value={novo} onChange={(e) => setNovo(e.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="inv-nota" className="text-xs">{modo.tipo === "RECUSADO" ? "Motivo *" : "Observação"}</Label>
              <Textarea id="inv-nota" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setModo(null)}>Voltar</Button>
              <Button
                disabled={responder.isPending || (modo.tipo === "RECUSADO" ? !nota.trim() : !novo)}
                onClick={() =>
                  responder.mutate({
                    id: modo.ev.id,
                    response: modo.tipo,
                    note: nota || undefined,
                    // datetime-local vem sem fuso: é o horário de quem digitou
                    proposedStart: novo ? new Date(novo).toISOString() : undefined,
                  })
                }
              >
                {responder.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Enviar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
