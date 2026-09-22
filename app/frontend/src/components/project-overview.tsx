import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, ExternalLink, Loader2, Pencil, Plus, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { useAuth } from "@/hooks/use-auth";

type Room = { id: string; name: string; roomType: string | null; notes: string | null; position: number };
type ProjectInfo = {
  id: string;
  architectName: string | null;
  architectPhone: string | null;
  architectEmail: string | null;
  link3dUrl: string | null;
};

const ROOM_TYPES: [string, string][] = [
  ["COZINHA", "Cozinha"], ["BANHEIRO", "Banheiro"], ["LAVABO", "Lavabo"], ["DORMITORIO", "Dormitório"],
  ["CLOSET", "Closet"], ["SALA", "Sala"], ["HOME_OFFICE", "Home office"], ["LAVANDERIA", "Lavanderia"],
  ["AREA_GOURMET", "Área gourmet"], ["VARANDA", "Varanda"], ["CORREDOR", "Corredor"], ["OUTRO", "Outro"],
];
const roomLabel = (t: string | null) => ROOM_TYPES.find(([v]) => v === t)?.[1] ?? null;

/** Visão geral do projeto: ambientes, arquiteto e o link do 3D. */
export function ProjectOverview({ project }: { project: ProjectInfo }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ProjectRooms projectId={project.id} />
      <ProjectPeople project={project} />
    </div>
  );
}

function ProjectRooms({ projectId }: { projectId: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const podeEditar = can("timeline.edit");
  const [novo, setNovo] = useState({ name: "", roomType: "" });

  const q = useQuery({ queryKey: ["rooms", projectId], queryFn: () => apiGet<{ data: Room[] }>(`/projects/${projectId}/rooms`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["rooms", projectId] });

  const criar = useMutation({
    mutationFn: () => apiPost(`/projects/${projectId}/rooms`, { name: novo.name, roomType: novo.roomType || null }),
    onSuccess: () => { setNovo({ name: "", roomType: "" }); refresh(); },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível adicionar")),
  });
  const remover = useMutation({
    mutationFn: (id: string) => apiDelete(`/projects/${projectId}/rooms/${id}`),
    onSuccess: () => { toast.success("Ambiente removido"); refresh(); },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível remover")),
  });

  const rooms = q.data?.data ?? [];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Box className="h-4 w-4" /> Ambientes ({rooms.length})
        </CardTitle>
        <p className="text-xs text-muted-foreground">Medição, vistoria e a importação do Promob apontam para estes ambientes.</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {rooms.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum ambiente cadastrado.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {rooms.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{r.name}</span>
                  {roomLabel(r.roomType) && <span className="ml-2 text-xs text-muted-foreground">{roomLabel(r.roomType)}</span>}
                </span>
                {podeEditar && (
                  <Button size="sm" variant="ghost" onClick={() => remover.mutate(r.id)} aria-label={`Remover ${r.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {podeEditar && (
          <form
            className="flex flex-wrap items-end gap-2 pt-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (novo.name.trim()) criar.mutate();
            }}
          >
            <div className="min-w-[150px] flex-1">
              <Label className="text-xs">Novo ambiente</Label>
              <Input value={novo.name} onChange={(e) => setNovo({ ...novo, name: e.target.value })} placeholder="Cozinha, suíte master…" />
            </div>
            <div className="w-[150px]">
              <Label className="text-xs">Tipo</Label>
              <Select value={novo.roomType || "__nenhum"} onValueChange={(x) => setNovo({ ...novo, roomType: x === "__nenhum" ? "" : x })}>
                <SelectTrigger><SelectValue placeholder="Tipo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__nenhum">Não informado</SelectItem>
                  {ROOM_TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" size="sm" disabled={criar.isPending || !novo.name.trim()}>
              {criar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Adicionar
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function ProjectPeople({ project }: { project: ProjectInfo }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [v, setV] = useState({
    architectName: project.architectName ?? "",
    architectPhone: project.architectPhone ?? "",
    architectEmail: project.architectEmail ?? "",
    link3dUrl: project.link3dUrl ?? "",
  });

  const salvar = useMutation({
    mutationFn: () => apiPatch(`/business/projects/${project.id}`, v),
    onSuccess: () => {
      toast.success("Projeto atualizado");
      setEditando(false);
      qc.invalidateQueries({ queryKey: ["project", project.id] });
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível salvar")),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <UserRound className="h-4 w-4" /> Arquiteto e 3D
          </span>
          {can("organization.manage") && !editando && (
            <Button size="sm" variant="ghost" onClick={() => setEditando(true)}>
              <Pencil className="h-4 w-4" /> Editar
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {editando ? (
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              salvar.mutate();
            }}
          >
            <Campo label="Arquiteto">
              <Input value={v.architectName} onChange={(e) => setV({ ...v, architectName: e.target.value })} />
            </Campo>
            <Campo label="Telefone do arquiteto">
              <Input value={v.architectPhone} onChange={(e) => setV({ ...v, architectPhone: e.target.value })} inputMode="tel" />
            </Campo>
            <Campo label="E-mail do arquiteto" className="sm:col-span-2">
              <Input type="email" value={v.architectEmail} onChange={(e) => setV({ ...v, architectEmail: e.target.value })} />
            </Campo>
            <Campo label="Link do 3D (Promob)" className="sm:col-span-2">
              <Input type="url" value={v.link3dUrl} onChange={(e) => setV({ ...v, link3dUrl: e.target.value })} placeholder="https://…" />
            </Campo>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" size="sm" disabled={salvar.isPending}>
                {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setEditando(false)}>Cancelar</Button>
            </div>
          </form>
        ) : (
          <dl className="space-y-2 text-sm">
            <Item rotulo="Arquiteto" valor={project.architectName} />
            <Item rotulo="Telefone" valor={project.architectPhone} />
            <Item rotulo="E-mail" valor={project.architectEmail} />
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">3D do projeto</dt>
              <dd>
                {project.link3dUrl ? (
                  <a href={project.link3dUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                    Abrir 3D <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function Item({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="truncate text-right">{valor || "—"}</dd>
    </div>
  );
}

function Campo({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
