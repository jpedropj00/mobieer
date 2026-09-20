import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarCheck, CalendarX, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { errorFromResponse, errorMessage, readJson, safeFetch } from "@/lib/errors";

type Visit = {
  number: string;
  clientFirstName: string;
  companyName: string;
  scheduledLabel: string | null;
  confirmed: boolean;
  rescheduleRequested?: boolean;
};

async function call<T>(token: string, body?: unknown): Promise<{ data: T; message?: string }> {
  const res = await safeFetch(`/api/public/assistance/confirm/${encodeURIComponent(token)}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await readJson(res);
  if (!res.ok) throw await errorFromResponse(res, payload);
  return payload as { data: T; message?: string };
}

/** Link do lembrete de véspera (WhatsApp): confirma ou pede outra data, sem login. */
export function ConfirmVisitPage() {
  const { token = "" } = useParams();
  const [reason, setReason] = useState("");
  const [asking, setAsking] = useState(false);
  const q = useQuery({ queryKey: ["confirm-visit", token], queryFn: () => call<Visit>(token), retry: false });
  const act = useMutation({ mutationFn: (action: "confirm" | "reschedule") => call<Visit>(token, { action, reason: reason || null }) });

  const result = act.data?.data;
  const visit = result ?? q.data?.data;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6 text-center">
        <p className="font-semibold tracking-[0.2em]">M&Oslash;BIEER</p>

        {q.isLoading && <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />}

        {q.isError && (
          <>
            <CalendarX className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{errorMessage(q.error, "Link inválido ou expirado.")}</p>
            <p className="text-xs text-muted-foreground">Se precisar, fale com a gestão pelo WhatsApp.</p>
          </>
        )}

        {visit && result?.rescheduleRequested && (
          <>
            <CalendarCheck className="mx-auto h-10 w-10 text-primary" />
            <h1 className="text-lg font-semibold">Pedido de nova data enviado</h1>
            <p className="text-sm text-muted-foreground">A equipe da {visit.companyName} vai te mandar outras opções de data.</p>
          </>
        )}

        {visit && !result?.rescheduleRequested && visit.confirmed && (
          <>
            <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
            <h1 className="text-lg font-semibold">Visita confirmada</h1>
            <p className="text-sm text-muted-foreground">
              Obrigado, {visit.clientFirstName}! Assistência {visit.number} em <strong>{visit.scheduledLabel}</strong>.
            </p>
          </>
        )}

        {visit && !result && !visit.confirmed && (
          <>
            <h1 className="text-lg font-semibold">Confirmar visita de assistência</h1>
            <p className="text-sm text-muted-foreground">
              {visit.clientFirstName}, a visita {visit.number} está marcada para <strong>{visit.scheduledLabel}</strong>.
            </p>
            {!asking ? (
              <div className="space-y-2">
                <Button className="w-full" disabled={act.isPending} onClick={() => act.mutate("confirm")}>
                  {act.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Confirmar
                </Button>
                <Button variant="outline" className="w-full" onClick={() => setAsking(true)}>
                  Preciso de outra data
                </Button>
              </div>
            ) : (
              <div className="space-y-2 text-left">
                <Textarea rows={3} placeholder="Se quiser, diga o motivo ou os melhores dias" value={reason} onChange={(e) => setReason(e.target.value)} />
                <Button className="w-full" disabled={act.isPending} onClick={() => act.mutate("reschedule")}>
                  {act.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Pedir nova data
                </Button>
                <Button variant="ghost" className="w-full" onClick={() => setAsking(false)}>
                  Voltar
                </Button>
              </div>
            )}
            {act.isError && <p className="text-sm text-destructive">{errorMessage(act.error, "Não foi possível registrar.")}</p>}
          </>
        )}
      </div>
    </div>
  );
}
