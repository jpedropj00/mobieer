import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { apiGet, apiPost } from "@/services/api";
import { errorMessage } from "@/lib/errors";

type Status = { enabled: boolean; enabledAt: string | null; recoveryCodesLeft: number };

/** Verificação em duas etapas da própria conta (aplicativo autenticador). */
export function MfaSettings() {
  const qc = useQueryClient();
  const { user, refresh } = useAuth();
  const key = ["mfa-status"];
  const status = useQuery({ queryKey: key, queryFn: () => apiGet<{ data: Status }>("/auth/mfa/status") });
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [password, setPassword] = useState("");

  const fail = (e: unknown) => toast.error(errorMessage(e, "Não foi possível concluir"));
  const after = async () => { await qc.invalidateQueries({ queryKey: key }); await refresh(); };
  const start = useMutation({ mutationFn: () => apiPost<{ data: { secret: string; qr: string } }>("/auth/mfa/setup"), onSuccess: (r) => { setSetup(r.data); setCode(""); setCodes(null); }, onError: fail });
  const enable = useMutation({
    mutationFn: () => apiPost<{ data: { recoveryCodes: string[] }; message?: string }>("/auth/mfa/enable", { code }),
    onSuccess: async (r) => { setCodes(r.data.recoveryCodes); setSetup(null); setCode(""); toast.success(r.message ?? "Verificação em duas etapas ativada"); await after(); },
    onError: fail,
  });
  const disable = useMutation({
    mutationFn: () => apiPost<{ message?: string }>("/auth/mfa/disable", { password, code }),
    onSuccess: async (r) => { setDisabling(false); setPassword(""); setCode(""); setCodes(null); toast.success(r.message ?? "Verificação em duas etapas desativada"); await after(); },
    onError: fail,
  });

  const s = status.data?.data;
  const onlyDigits = (v: string) => v.replace(/[^0-9A-Za-z-]/g, "").slice(0, 12);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 py-4">
        <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4" /> Verificação em duas etapas</CardTitle>
        {s && <Badge variant={s.enabled ? "default" : "secondary"}>{s.enabled ? "Ativa" : "Desativada"}</Badge>}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Além da senha, o sistema pede um código de 6 dígitos gerado no seu celular por um aplicativo autenticador (Google Authenticator, Microsoft Authenticator ou Authy). Mesmo que alguém descubra a sua senha, não entra sem o celular.
        </p>
        {user?.mfaRecommended && !s?.enabled && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">O seu perfil ({user.roleLabel}) tem acesso amplo ao sistema. Recomendamos ativar.</p>}

        {status.isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}

        {/* códigos de recuperação: aparecem uma única vez, logo depois de ativar */}
        {codes && (
          <div className="space-y-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3">
            <p className="font-medium text-emerald-900">Guarde estes códigos de recuperação. Eles não aparecem de novo.</p>
            <p className="text-xs text-emerald-900/80">Cada um vale uma vez e entra no lugar do código do celular, se você ficar sem o aparelho.</p>
            <div className="grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-5">{codes.map((c) => <span key={c} className="rounded bg-white px-2 py-1 text-center">{c}</span>)}</div>
            <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(codes.join("\n")).then(() => toast.success("Códigos copiados")).catch(() => toast.error("Não consegui copiar; anote os códigos"))}><Copy className="h-4 w-4" /> Copiar</Button>
          </div>
        )}

        {s && !s.enabled && !setup && (
          <Button disabled={start.isPending} onClick={() => start.mutate()}>{start.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Ativar verificação em duas etapas</Button>
        )}

        {setup && (
          <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
            <img src={setup.qr} alt="QR Code para o aplicativo autenticador" className="h-48 w-48 rounded-lg border bg-white p-2" />
            <div className="space-y-3">
              <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                <li>Abra o aplicativo autenticador no celular e escolha adicionar conta.</li>
                <li>Aponte a câmera para o QR Code. Se não der, digite a chave: <span className="break-all font-mono text-xs text-foreground">{setup.secret}</span></li>
                <li>Digite abaixo o código de 6 dígitos que o aplicativo mostrar.</li>
              </ol>
              <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (code.length >= 6) enable.mutate(); }}>
                <div className="space-y-1"><Label className="text-xs">Código do aplicativo</Label><Input className="w-40 font-mono tracking-widest" inputMode="numeric" autoComplete="one-time-code" placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} /></div>
                <Button type="submit" disabled={code.length < 6 || enable.isPending}>{enable.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Confirmar e ativar</Button>
                <Button type="button" variant="ghost" onClick={() => setSetup(null)}>Cancelar</Button>
              </form>
            </div>
          </div>
        )}

        {s?.enabled && (
          <div className="space-y-3">
            <p className="text-muted-foreground">Ativa desde {s.enabledAt ? new Date(s.enabledAt).toLocaleDateString("pt-BR") : "—"}. Códigos de recuperação restantes: <span className="font-medium text-foreground">{s.recoveryCodesLeft}</span>.</p>
            {!disabling ? (
              <Button variant="outline" onClick={() => { setDisabling(true); setCode(""); }}><ShieldOff className="h-4 w-4" /> Desativar</Button>
            ) : (
              <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (password && code.length >= 6) disable.mutate(); }}>
                <div className="space-y-1"><Label className="text-xs">Sua senha</Label><Input type="password" autoComplete="current-password" className="w-48" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
                <div className="space-y-1"><Label className="text-xs">Código do aplicativo (ou de recuperação)</Label><Input className="w-44 font-mono" autoComplete="one-time-code" value={code} onChange={(e) => setCode(onlyDigits(e.target.value))} /></div>
                <Button type="submit" variant="destructive" disabled={!password || code.length < 6 || disable.isPending}>{disable.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Desativar</Button>
                <Button type="button" variant="ghost" onClick={() => setDisabling(false)}>Cancelar</Button>
              </form>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
