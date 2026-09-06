import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

const FALLBACK_ENV = [
  "Suíte Master", "Cozinha", "Sala", "Suíte Hóspede", "Suíte Filhos", "Banheiro",
  "Varanda", "Ambiente Corporativo", "Ambiente Comercial", "Área de Serviço", "Lavabo", "Outro",
];
const FALLBACK_CHANNELS = ["Instagram", "Indicação", "Google", "Site", "Arquiteto", "Parceiros", "Outro"];

type Form = {
  name: string; email: string; phone: string; address: string;
  investment: string; hasProject: "" | "Sim" | "Não";
  environments: string[]; userCount: string; discoveryChannel: string; notes: string;
};
const blank: Form = { name: "", email: "", phone: "", address: "", investment: "", hasProject: "", environments: [], userCount: "", discoveryChannel: "", notes: "" };

export function BriefingPage() {
  const [meta, setMeta] = useState<{ environments: string[]; discoveryChannels: string[] }>({ environments: FALLBACK_ENV, discoveryChannels: FALLBACK_CHANNELS });
  const [form, setForm] = useState<Form>(blank);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch("/api/briefing/meta")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.data && setMeta(j.data))
      .catch(() => undefined);
  }, []);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggleEnv = (e: string) =>
    setForm((f) => ({ ...f, environments: f.environments.includes(e) ? f.environments.filter((x) => x !== e) : [...f.environments, e] }));

  const valid = form.name.trim().length >= 2 && form.phone.trim().length >= 8 && form.address.trim().length >= 3 && form.investment.trim() && form.hasProject && form.environments.length > 0 && form.discoveryChannel;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      const res = await fetch("/api/briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim() || null,
          phone: form.phone.trim(),
          address: form.address.trim(),
          investment: form.investment.trim(),
          hasProject: form.hasProject === "Sim",
          environments: form.environments,
          userCount: form.userCount ? Number(form.userCount) : null,
          discoveryChannel: form.discoveryChannel,
          notes: form.notes.trim() || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? "Erro ao enviar");
      setDone(true);
    } catch (err) {
      toast.error((err as Error).message || "Não foi possível enviar. Tente novamente.");
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 p-6 text-center">
        <CheckCircle2 className="h-14 w-14 text-primary" />
        <h1 className="text-xl font-semibold">Briefing recebido!</h1>
        <p className="text-sm text-muted-foreground">
          Obrigado, {form.name.split(" ")[0]}. Nossa equipe vai analisar as informações e entrar em contato pelo WhatsApp em breve.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-10">
      <form onSubmit={submit} className="mx-auto w-full max-w-xl space-y-5 px-5">
        <header className="space-y-1 text-center">
          <p className="text-lg font-semibold tracking-[0.2em]">M&Oslash;BIEER</p>
          <h1 className="text-xl font-bold">Briefing do seu projeto</h1>
          <p className="text-sm text-muted-foreground">Leva 2 minutos. Assim já chegamos preparados no primeiro contato.</p>
        </header>

        <Card>
          <F label="Nome completo" req><Input value={form.name} onChange={(e) => set("name", e.target.value)} /></F>
          <div className="grid gap-4 sm:grid-cols-2">
            <F label="E-mail"><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></F>
            <F label="Telefone / WhatsApp" req><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="(85) 9....." /></F>
          </div>
          <F label="Endereço" req><Input value={form.address} onChange={(e) => set("address", e.target.value)} /></F>
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
              {meta.environments.map((e) => (
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
              {meta.discoveryChannels.map((c) => (
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

        <Button type="submit" className="w-full" disabled={!valid || sending}>
          {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Enviar briefing
        </Button>
      </form>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4 rounded-xl border border-border bg-card p-5">{children}</div>;
}
function F({ label, req, children }: { label: string; req?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}{req && <span className="text-destructive"> *</span>}</Label>
      {children}
    </div>
  );
}
