import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPut } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type Schedule = { role: string; days: number[]; start: string; end: string };
type Policy = {
  minLength: number;
  requireUpper: boolean;
  requireLower: boolean;
  requireDigit: boolean;
  requireSymbol: boolean;
  expiryDays: number;
  maxAttempts: number;
  allowedIps: string[];
  ipExemptRoles: string[];
  schedules: Schedule[];
};
type Data = { policy: Policy; yourIp: string; roles: { name: string; label: string }[] };

const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** Política de senha e restrições de acesso (por IP e por horário de cada perfil). */
export function SecuritySettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["settings", "security"], queryFn: () => apiGet<{ data: Data }>("/settings/security") });
  const [p, setP] = useState<Policy | null>(null);
  const [ips, setIps] = useState("");
  useEffect(() => {
    if (q.data && !p) {
      setP(q.data.data.policy);
      setIps(q.data.data.policy.allowedIps.join("\n"));
    }
  }, [q.data, p]);
  const save = useMutation({
    mutationFn: () => apiPut<{ message: string }>("/settings/security", { ...p, allowedIps: ips.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean) }),
    onSuccess: (r) => { toast.success(r.message); qc.invalidateQueries({ queryKey: ["settings", "security"] }); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao salvar")),
  });
  if (!p || !q.data) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  const roles = q.data.data.roles.filter((r) => r.name !== "ADMIN");
  const set = <K extends keyof Policy>(k: K, v: Policy[K]) => setP({ ...p, [k]: v });
  const ipList = ips.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  const yourIpOut = ipList.length > 0 && !ipList.includes(q.data.data.yourIp);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /> Segurança de acesso</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 text-sm">
        <section className="space-y-3">
          <p className="font-medium">Senha</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5"><Label>Tamanho mínimo</Label><Input type="number" min={6} max={64} value={p.minLength} onChange={(e) => set("minLength", Number(e.target.value))} /></div>
            <div className="space-y-1.5"><Label>Trocar a cada (dias, 0 = nunca)</Label><Input type="number" min={0} max={365} value={p.expiryDays} onChange={(e) => set("expiryDays", Number(e.target.value))} /></div>
            <div className="space-y-1.5"><Label>Bloquear após erros (0 = não)</Label><Input type="number" min={0} max={20} value={p.maxAttempts} onChange={(e) => set("maxAttempts", Number(e.target.value))} /></div>
          </div>
          <div className="flex flex-wrap gap-5">
            {([["requireUpper", "Letra maiúscula"], ["requireLower", "Letra minúscula"], ["requireDigit", "Número"], ["requireSymbol", "Símbolo"]] as const).map(([k, l]) => (
              <label key={k} className="flex items-center gap-2"><Switch checked={p[k]} onCheckedChange={(v) => set(k, v)} /> {l}</label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Vale para senhas novas. Quem estiver com a senha vencida é levado a trocar no próximo acesso.</p>
        </section>

        <section className="space-y-2">
          <p className="font-medium">Acesso por IP</p>
          <p className="text-xs text-muted-foreground">Um IP ou faixa por linha (ex.: 189.1.2.3 ou 189.1.2.0/24). Vazio = qualquer rede. O administrador entra de qualquer lugar. Seu IP agora: <strong>{q.data.data.yourIp || "—"}</strong></p>
          <Textarea rows={3} value={ips} onChange={(e) => setIps(e.target.value)} placeholder="189.1.2.0/24" />
          {yourIpOut && <p className="text-xs text-warning">Seu IP atual não está na lista: outros perfis na mesma rede que você ficariam sem acesso.</p>}
          <div className="flex flex-wrap gap-3">
            <span className="text-xs text-muted-foreground">Perfis liberados de qualquer rede:</span>
            {roles.map((r) => (
              <label key={r.name} className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={p.ipExemptRoles.includes(r.name)} onChange={(e) => set("ipExemptRoles", e.target.checked ? [...p.ipExemptRoles, r.name] : p.ipExemptRoles.filter((x) => x !== r.name))} />
                {r.label}
              </label>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <p className="font-medium">Horário de acesso por perfil</p>
          <p className="text-xs text-muted-foreground">Perfil sem horário entra a qualquer hora. Fora do horário, a sessão é encerrada.</p>
          {p.schedules.map((w, i) => {
            const upd = (patch: Partial<Schedule>) => set("schedules", p.schedules.map((x, k) => (k === i ? { ...x, ...patch } : x)));
            return (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded border p-2">
                <Select value={w.role} onValueChange={(v) => upd({ role: v })}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>{roles.map((r) => <SelectItem key={r.name} value={r.name}>{r.label}</SelectItem>)}</SelectContent>
                </Select>
                <div className="flex gap-1">
                  {DAYS.map((d, n) => (
                    <button
                      key={d}
                      type="button"
                      className={`rounded px-2 py-1 text-xs ${w.days.includes(n) ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                      onClick={() => upd({ days: w.days.includes(n) ? w.days.filter((x) => x !== n) : [...w.days, n].sort() })}
                    >
                      {d}
                    </button>
                  ))}
                </div>
                <Input type="time" className="w-28" value={w.start} onChange={(e) => upd({ start: e.target.value })} />
                <span>às</span>
                <Input type="time" className="w-28" value={w.end} onChange={(e) => upd({ end: e.target.value })} />
                <Button variant="ghost" size="icon" aria-label="Remover" onClick={() => set("schedules", p.schedules.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            );
          })}
          <Button
            size="sm"
            variant="outline"
            disabled={!roles.length}
            onClick={() => set("schedules", [...p.schedules, { role: roles[0].name, days: [1, 2, 3, 4, 5], start: "07:00", end: "19:00" }])}
          >
            <Plus className="mr-1 h-4 w-4" /> Horário
          </Button>
        </section>

        <Button disabled={save.isPending} onClick={() => save.mutate()}>Salvar segurança</Button>
      </CardContent>
    </Card>
  );
}
