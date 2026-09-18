import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { PageSkeleton } from "@/components/ui/states";
import { errorMessage } from "@/lib/errors";
import { portalApi, portalGet } from "@/services/portal-api";
import { usePortalAuth } from "@/hooks/use-portal-auth";

type BriefingData = {
  status: string;
  editable: boolean;
  submittedAt: string | null;
  answers: {
    phone: string;
    address: string;
    investment: string;
    hasProject: boolean;
    environments: string[];
    userCount: number | null;
    discoveryChannel: string;
    notes: string;
  };
  options: { environments: string[]; discoveryChannels: string[] };
};

type Form = {
  phone: string;
  address: string;
  investment: string;
  hasProject: "" | "Sim" | "Não";
  environments: string[];
  userCount: string;
  discoveryChannel: string;
  notes: string;
};

/**
 * Briefing do cliente logado. Quem se cadastrou pelo site só enxerga esta tela
 * até a equipe completar o cadastro.
 */
export function PortalBriefingPage() {
  const { account, level, refresh } = usePortalAuth();
  const q = useQuery({ queryKey: ["portal", "briefing"], queryFn: () => portalGet<{ data: BriefingData }>("/briefing") });
  const [form, setForm] = useState<Form | null>(null);

  useEffect(() => {
    if (!q.data || form) return;
    const a = q.data.data.answers;
    setForm({
      phone: a.phone,
      address: a.address,
      investment: a.investment,
      hasProject: q.data.data.submittedAt ? (a.hasProject ? "Sim" : "Não") : "",
      environments: a.environments,
      userCount: a.userCount == null ? "" : String(a.userCount),
      discoveryChannel: a.discoveryChannel,
      notes: a.notes,
    });
  }, [q.data, form]);

  const save = useMutation({
    mutationFn: () =>
      portalApi<{ data: BriefingData; message: string }>("/briefing", {
        method: "PUT",
        body: {
          phone: form!.phone.trim(),
          address: form!.address.trim(),
          investment: form!.investment.trim(),
          hasProject: form!.hasProject === "Sim",
          environments: form!.environments,
          userCount: form!.userCount ? Number(form!.userCount) : null,
          discoveryChannel: form!.discoveryChannel,
          notes: form!.notes.trim(),
        },
      }),
    onSuccess: (r) => {
      toast.success(r.message ?? "Briefing salvo");
      void q.refetch();
      void refresh();
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível salvar")),
  });

  if (q.isLoading || !form) return <PageSkeleton />;
  if (q.isError) {
    return <p className="text-sm text-muted-foreground">{errorMessage(q.error, "Não foi possível carregar o briefing.")}</p>;
  }

  const data = q.data!.data;
  const readOnly = !data.editable;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const toggleEnv = (e: string) =>
    set("environments", form.environments.includes(e) ? form.environments.filter((x) => x !== e) : [...form.environments, e]);
  const valid =
    form.phone.replace(/\D/g, "").length >= 10 &&
    form.address.trim().length >= 3 &&
    form.investment.trim() &&
    form.hasProject &&
    form.environments.length > 0 &&
    form.discoveryChannel;

  return (
    <div className="mx-auto w-full max-w-xl space-y-5">
      <header className="space-y-1">
        <h1 className="text-xl font-bold">Briefing do seu projeto</h1>
        <p className="text-sm text-muted-foreground">
          Olá, {account?.name.split(" ")[0]}. Leva 2 minutos — assim já chegamos preparados no primeiro contato.
        </p>
      </header>

      {data.submittedAt && (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-sm">
          {level === "FULL" ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          ) : (
            <Clock className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          )}
          <div>
            <p className="font-medium">
              {level === "FULL" ? "Cadastro completo — seu portal está liberado" : "Briefing recebido"}
            </p>
            <p className="text-muted-foreground">
              {readOnly
                ? "Nossa equipe já está com suas respostas."
                : "Nossa equipe vai entrar em contato pelo WhatsApp. Enquanto isso, você pode ajustar as respostas aqui. Quando completarmos seu cadastro, o portal completo é liberado."}
            </p>
          </div>
        </div>
      )}

      <fieldset disabled={readOnly} className="space-y-5">
        <Card>
          <F label="Telefone / WhatsApp" req>
            <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="(85) 9....." inputMode="tel" />
          </F>
          <F label="Endereço da obra" req>
            <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
          </F>
        </Card>

        <Card>
          <F label="Qual é a estimativa de investimento reservada para este projeto?" req>
            <Input value={form.investment} onChange={(e) => set("investment", e.target.value)} placeholder="Ex.: R$ 45.000" />
          </F>
          <F label="Você já tem projeto (arquiteto/designer)?" req>
            <div className="flex gap-4">
              {(["Sim", "Não"] as const).map((o) => (
                <label key={o} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="hasProject" checked={form.hasProject === o} onChange={() => set("hasProject", o)} />
                  {o}
                </label>
              ))}
            </div>
          </F>
        </Card>

        <Card>
          <F label="Quais ambientes serão planejados?" req>
            <div className="grid grid-cols-2 gap-2">
              {data.options.environments.map((e) => (
                <label key={e} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={form.environments.includes(e)} onCheckedChange={() => toggleEnv(e)} />
                  {e}
                </label>
              ))}
            </div>
          </F>
          <F label="Quantas pessoas usarão os ambientes?">
            <Input type="number" min={0} value={form.userCount} onChange={(e) => set("userCount", e.target.value)} />
          </F>
        </Card>

        <Card>
          <F label="Como conheceu a Mobieer?" req>
            <div className="grid grid-cols-2 gap-2">
              {data.options.discoveryChannels.map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="channel" checked={form.discoveryChannel === c} onChange={() => set("discoveryChannel", c)} />
                  {c}
                </label>
              ))}
            </div>
          </F>
          <F label="Algo mais que queira nos contar? (opcional)">
            <Textarea rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </F>
        </Card>
      </fieldset>

      {!readOnly && (
        <Button className="w-full" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {data.submittedAt ? "Salvar alterações" : "Enviar briefing"}
        </Button>
      )}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4 rounded-xl border border-border bg-card p-5">{children}</div>;
}
function F({ label, req, children }: { label: string; req?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>
        {label}
        {req && <span className="text-destructive"> *</span>}
      </Label>
      {children}
    </div>
  );
}
