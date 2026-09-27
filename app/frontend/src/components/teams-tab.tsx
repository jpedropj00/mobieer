import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost, apiPut } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Person = { id: string; name: string };
type Team = { id: string; name: string; active: boolean; leader: Person | null; members: (Person & { role: { label: string } })[] };
type Client = { id: string; name: string; sellerId: string | null; status: string };

/** Equipes comerciais, transferência de carteira e campos obrigatórios do cliente. */
export function TeamsTab() {
  const { can } = useAuth();
  const manage = can("commercial.manage");
  return (
    <div className="space-y-4">
      <TeamsCard manage={manage} />
      {manage && <TransferCard />}
      {manage && <RequiredFieldsCard />}
    </div>
  );
}

function TeamsCard({ manage }: { manage: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Team | "new" | null>(null);
  const q = useQuery({ queryKey: ["sales-teams"], queryFn: () => apiGet<{ data: Team[] }>("/commercial/teams") });
  const teams = q.data?.data ?? [];
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 py-3">
        <CardTitle className="text-base">Equipes</CardTitle>
        {manage && <Button size="sm" onClick={() => setEditing("new")}><Plus className="mr-1 h-4 w-4" /> Equipe</Button>}
      </CardHeader>
      <CardContent>
        {teams.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma equipe. Ex.: "Equipe A", "Prospecção".</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {teams.map((t) => (
              <div key={t.id} className={`rounded-lg border p-3 text-sm ${t.active ? "" : "opacity-60"}`}>
                <div className="flex items-center justify-between">
                  <p className="font-medium">{t.name}{!t.active && <Badge variant="muted" className="ml-2">inativa</Badge>}</p>
                  {manage && <Button size="icon" variant="ghost" aria-label="Editar" onClick={() => setEditing(t)}><Pencil className="h-4 w-4" /></Button>}
                </div>
                <p className="text-xs text-muted-foreground">Líder: {t.leader?.name ?? "—"} · {t.members.length} pessoa(s)</p>
                <p className="mt-1 text-xs">{t.members.map((m) => m.name).join(", ") || "Sem integrantes"}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      {editing && <TeamDialog team={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["sales-teams"] }); }} />}
    </Card>
  );
}

function TeamDialog({ team, onClose, onSaved }: { team: Team | null; onClose: () => void; onSaved: () => void }) {
  const people = useQuery({ queryKey: ["kanban-people"], queryFn: () => apiGet<{ data: Person[] }>("/organization/people") });
  const [name, setName] = useState(team?.name ?? "");
  const [leaderId, setLeaderId] = useState(team?.leader?.id ?? "");
  const [members, setMembers] = useState<string[]>(team?.members.map((m) => m.id) ?? []);
  const [active, setActive] = useState(team?.active ?? true);
  const save = useMutation({
    mutationFn: () => {
      const body = { name, leaderId: leaderId || null, memberIds: members, active };
      return team ? apiPut<{ message: string }>(`/commercial/teams/${team.id}`, body) : apiPost<{ message: string }>("/commercial/teams", body);
    },
    onSuccess: (r) => { toast.success(r.message); onSaved(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao salvar")),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>{team ? "Editar equipe" : "Nova equipe"}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="space-y-1.5"><Label>Nome</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label>Líder</Label>
            <Select value={leaderId || "NONE"} onValueChange={(v) => setLeaderId(v === "NONE" ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="NONE">Sem líder</SelectItem>{(people.data?.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Integrantes (uma equipe por pessoa)</Label>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded border p-2">
              {(people.data?.data ?? []).map((p) => (
                <label key={p.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={members.includes(p.id)} onChange={(e) => setMembers((m) => (e.target.checked ? [...m, p.id] : m.filter((x) => x !== p.id)))} />
                  {p.name}
                </label>
              ))}
            </div>
          </div>
          {team && <label className="flex items-center gap-2"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Ativa</label>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={save.isPending || name.trim().length < 2} onClick={() => save.mutate()}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferCard() {
  const qc = useQueryClient();
  const people = useQuery({ queryKey: ["kanban-people"], queryFn: () => apiGet<{ data: Person[] }>("/organization/people") });
  const clients = useQuery({ queryKey: ["business-clients"], queryFn: () => apiGet<{ data: Client[] }>("/business/clients") });
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [moveOpps, setMoveOpps] = useState(true);
  const [moveQuotes, setMoveQuotes] = useState(true);
  const [search, setSearch] = useState("");
  const list = useMemo(
    () => (clients.data?.data ?? []).filter((c) => (from === "__NONE__" ? !c.sellerId : c.sellerId === from)).filter((c) => c.name.toLowerCase().includes(search.toLowerCase())),
    [clients.data, from, search]
  );
  useEffect(() => setPicked([]), [from]);
  const transfer = useMutation({
    mutationFn: () => apiPost<{ message: string }>("/commercial/portfolio/transfer", { clientIds: picked, toSellerId: to, moveOpenOpportunities: moveOpps, moveOpenQuotes: moveQuotes }),
    onSuccess: (r) => { toast.success(r.message); setPicked([]); qc.invalidateQueries({ queryKey: ["business-clients"] }); qc.invalidateQueries({ queryKey: ["commercial"] }); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao transferir")),
  });
  const peopleList = people.data?.data ?? [];
  return (
    <Card>
      <CardHeader className="py-3"><CardTitle className="text-base">Transferir carteira</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>De (vendedor atual)</Label>
            <Select value={from || "NONE"} onValueChange={(v) => setFrom(v === "NONE" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Escolha" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">Escolha</SelectItem>
                <SelectItem value="__NONE__">Clientes sem vendedor</SelectItem>
                {peopleList.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Para</Label>
            <Select value={to || "NONE"} onValueChange={(v) => setTo(v === "NONE" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Escolha" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">Escolha</SelectItem>
                {peopleList.filter((p) => p.id !== from).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        {from && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Input className="max-w-xs" placeholder="Buscar cliente" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Button size="sm" variant="outline" onClick={() => setPicked(picked.length === list.length ? [] : list.map((c) => c.id))}>
                {picked.length === list.length && list.length ? "Desmarcar todos" : `Marcar todos (${list.length})`}
              </Button>
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded border p-2">
              {list.length === 0 && <p className="text-muted-foreground">Nenhum cliente nesta carteira.</p>}
              {list.map((c) => (
                <label key={c.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={picked.includes(c.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))} />
                  {c.name}{c.status !== "ACTIVE" && <Badge variant="muted">inativo</Badge>}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2"><input type="checkbox" checked={moveOpps} onChange={(e) => setMoveOpps(e.target.checked)} /> Levar as oportunidades em aberto</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={moveQuotes} onChange={(e) => setMoveQuotes(e.target.checked)} /> Levar os orçamentos não fechados</label>
            </div>
            <Button disabled={!to || !picked.length || transfer.isPending} onClick={() => confirm(`Transferir ${picked.length} cliente(s)?`) && transfer.mutate()}>
              <ArrowRightLeft className="mr-1 h-4 w-4" /> Transferir {picked.length || ""}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RequiredFieldsCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["client-fields"], queryFn: () => apiGet<{ data: { required: string[]; available: Record<string, string> } }>("/commercial/client-fields") });
  const [req, setReq] = useState<string[] | null>(null);
  useEffect(() => { if (q.data && req === null) setReq(q.data.data.required); }, [q.data, req]);
  const save = useMutation({
    mutationFn: () => apiPut<{ message: string }>("/commercial/client-fields", { required: req }),
    onSuccess: (r) => { toast.success(r.message); qc.invalidateQueries({ queryKey: ["client-fields"] }); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao salvar")),
  });
  if (!q.data || req === null) return null;
  return (
    <Card>
      <CardHeader className="py-3"><CardTitle className="text-base">Campos obrigatórios do cliente</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">Além do nome. Vale para cadastrar e editar clientes (a conversão de lead segue livre e o cadastro é completado depois).</p>
        <div className="flex flex-wrap gap-4">
          {Object.entries(q.data.data.available).map(([k, l]) => (
            <label key={k} className="flex items-center gap-2">
              <input type="checkbox" checked={req.includes(k)} onChange={(e) => setReq((r) => (e.target.checked ? [...(r ?? []), k] : (r ?? []).filter((x) => x !== k)))} />
              {l}
            </label>
          ))}
        </div>
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>Salvar</Button>
      </CardContent>
    </Card>
  );
}
