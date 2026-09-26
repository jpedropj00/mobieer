import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CalendarCheck, ClipboardCheck, ShieldAlert, Truck } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPut } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageSkeleton } from "@/components/ui/states";

type ProjectRef = { id: string; code: string; name: string };
type Overview = {
  awaitingInspection: { project: ProjectRef; deliveredAt: string | null }[];
  draftInspections: { id: string; inspectedAt: string; project: ProjectRef }[];
  maintenancesDue: { id: string; label: string; dueAt: string; overdue: boolean; project: ProjectRef }[];
  warrantiesExpiring: { warrantyId: string; project: ProjectRef; component: string; endsAt: string; daysLeft: number }[];
};

const ProjectLink = ({ p }: { p: ProjectRef }) => (
  <Link to={`/clientes-projetos/${p.id}`} className="font-medium hover:underline">
    {p.code} — {p.name}
  </Link>
);

function Section({ title, empty, children, count }: { title: string; empty: string; count: number; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="py-3"><CardTitle className="text-base">{title} ({count})</CardTitle></CardHeader>
      <CardContent>{count === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : <ul className="divide-y">{children}</ul>}</CardContent>
    </Card>
  );
}

/** §35–§37 — o que o pós-venda precisa olhar hoje. */
export function AftersalesPage() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ["aftersales", "overview"], queryFn: () => apiGet<{ data: Overview }>("/aftersales/overview") });
  if (q.isLoading) return <PageSkeleton />;
  const d = q.data?.data;
  if (!d) return <p className="py-10 text-center text-sm text-destructive">{errorMessage(q.error, "Falha ao carregar o pós-venda")}</p>;

  return (
    <div className="space-y-6">
      <PageHeader title="Pós-venda" description="Vistorias, garantias e manutenção preventiva. A vistoria e a garantia de cada obra ficam na aba Pós-venda do projeto." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Entregues sem vistoria" value={d.awaitingInspection.length} icon={Truck} />
        <KpiCard title="Vistorias em aberto" value={d.draftInspections.length} icon={ClipboardCheck} />
        <KpiCard title="Revisões em 30 dias" value={d.maintenancesDue.length} icon={CalendarCheck} />
        <KpiCard title="Garantias terminando" value={d.warrantiesExpiring.length} icon={ShieldAlert} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Entregues aguardando vistoria" count={d.awaitingInspection.length} empty="Todo projeto entregue já foi vistoriado.">
          {d.awaitingInspection.map((x) => (
            <li key={x.project.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <ProjectLink p={x.project} />
              <span className="text-xs text-muted-foreground">entregue {formatDate(x.deliveredAt)}</span>
            </li>
          ))}
        </Section>
        <Section title="Vistorias em preenchimento" count={d.draftInspections.length} empty="Nenhuma vistoria em aberto.">
          {d.draftInspections.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <ProjectLink p={x.project} />
              <span className="text-xs text-muted-foreground">iniciada {formatDate(x.inspectedAt)}</span>
            </li>
          ))}
        </Section>
        <Section title="Revisões preventivas nos próximos 30 dias" count={d.maintenancesDue.length} empty="Nenhuma revisão próxima.">
          {d.maintenancesDue.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span><ProjectLink p={x.project} /><span className="block text-xs text-muted-foreground">{x.label}</span></span>
              {x.overdue ? <Badge variant="danger">atrasada · {formatDate(x.dueAt)}</Badge> : <span className="text-xs">{formatDate(x.dueAt)}</span>}
            </li>
          ))}
        </Section>
        <Section title="Garantias terminando em 30 dias" count={d.warrantiesExpiring.length} empty="Nenhuma garantia perto do fim.">
          {d.warrantiesExpiring.map((x) => (
            <li key={`${x.warrantyId}-${x.component}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span><ProjectLink p={x.project} /><span className="block text-xs text-muted-foreground">{x.component}</span></span>
              <Badge variant="warning">{x.daysLeft} dia(s) · {formatDate(x.endsAt)}</Badge>
            </li>
          ))}
        </Section>
      </div>
      {can("warranty.manage") && <MaintenanceMonthsCard />}
    </div>
  );
}

function MaintenanceMonthsCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["aftersales", "months"], queryFn: () => apiGet<{ data: { months: number[] } }>("/aftersales/maintenance-months") });
  const [text, setText] = useState("");
  useEffect(() => {
    if (q.data) setText(q.data.data.months.join(", "));
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => {
      const months = text.split(/[,;\s]+/).filter(Boolean).map(Number);
      if (months.some((m) => !Number.isInteger(m) || m < 1 || m > 120)) throw new Error("Use meses inteiros entre 1 e 120, separados por vírgula");
      return apiPut<{ message: string }>("/aftersales/maintenance-months", { months });
    },
    onSuccess: (r) => { toast.success(r.message); qc.invalidateQueries({ queryKey: ["aftersales", "months"] }); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao salvar")),
  });
  return (
    <Card>
      <CardHeader className="py-3"><CardTitle className="text-base">Calendário de revisões preventivas</CardTitle></CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3 text-sm">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Meses depois da vistoria final (vale para garantias novas). Deixe vazio para não agendar.</p>
          <Input className="w-56" value={text} onChange={(e) => setText(e.target.value)} placeholder="6, 12" />
        </div>
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>Salvar</Button>
      </CardContent>
    </Card>
  );
}
