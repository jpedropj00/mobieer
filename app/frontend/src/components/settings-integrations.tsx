import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Loader2, Plug, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiDelete, apiGet, apiPost } from "@/services/api";
import { errorMessage } from "@/lib/errors";

type Token = { id: string; name: string; prefix: string; scopes: string[]; lastUsedAt: string | null; revokedAt: string | null; createdAt: string };
type Data = { scopes: { key: string; label: string }[]; tokens: Token[] };

const fmt = (v: string | null) => (v ? new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

/** Tokens para o sincronizador do Promob enviar os arquivos exportados. */
export function IntegrationsSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["integrations", "tokens"], queryFn: () => apiGet<{ data: Data }>("/integrations/tokens") });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Computador do Promob");
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);

  const create = useMutation({
    mutationFn: () => apiPost<{ data: { token: string; name: string } }>("/integrations/tokens", { name, scopes: ["promob.import"] }),
    onSuccess: (r) => {
      setCreated(r.data);
      qc.invalidateQueries({ queryKey: ["integrations", "tokens"] });
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível criar o token")),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiDelete(`/integrations/tokens/${id}`),
    onSuccess: () => {
      toast.success("Token revogado");
      qc.invalidateQueries({ queryKey: ["integrations", "tokens"] });
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível revogar")),
  });

  const tokens = q.data?.data.tokens ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Plug className="h-4 w-4" /> Sincronizador do Promob
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            O Promob não tem API: os projetos saem por arquivo. O sincronizador roda no computador do Promob, observa a pasta onde a exportação é salva e envia
            cada arquivo novo para o projeto certo — identificado pelo código no começo do nome do arquivo (ex.: <span className="font-mono">364-1 Cozinha.xml</span>).
          </p>
          <p className="text-muted-foreground">
            Os arquivos e instruções estão na pasta <span className="font-mono">tools/promob-sync</span> do sistema. Gere um token abaixo e cole no arquivo de
            configuração do sincronizador.
          </p>
          <Button
            size="sm"
            onClick={() => {
              setCreated(null);
              setOpen(true);
            }}
          >
            <KeyRound className="mr-2 h-4 w-4" /> Novo token
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Tokens</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {q.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : tokens.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Nenhum token criado.</p>
          ) : (
            tokens.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2 text-sm last:border-0">
                <div>
                  <p className="font-medium">
                    {t.name} <span className="font-mono text-xs text-muted-foreground">{t.prefix}…</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    criado {fmt(t.createdAt)} · último uso {fmt(t.lastUsedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {t.revokedAt ? (
                    <Badge variant="muted">revogado</Badge>
                  ) : (
                    <>
                      <Badge variant="success">ativo</Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => {
                          if (confirm("Revogar este token? O sincronizador desse computador vai parar de enviar.")) revoke.mutate(t.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(v) => !v && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{created ? "Token criado" : "Novo token de integração"}</DialogTitle>
          </DialogHeader>
          {created ? (
            <div className="space-y-3 text-sm">
              <p>Copie agora — por segurança, ele não é mostrado de novo.</p>
              <div className="flex items-center gap-2 rounded-md bg-muted/60 p-3">
                <code className="min-w-0 flex-1 break-all font-mono text-xs">{created.token}</code>
                <Button size="icon" variant="ghost" onClick={() => navigator.clipboard.writeText(created.token).then(() => toast.success("Copiado"))}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Cole no campo <span className="font-mono">token</span> do arquivo <span className="font-mono">promob-sync.config.json</span>.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Nome (para identificar o computador)</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          )}
          <DialogFooter>
            {created ? (
              <Button onClick={() => setOpen(false)}>Fechar</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <Button disabled={name.trim().length < 2 || create.isPending} onClick={() => create.mutate()}>
                  {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Criar token
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
