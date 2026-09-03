import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, FileText, LifeBuoy, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { portalGet } from "@/services/portal-api";

type PortalProject = {
  id: string;
  code: string;
  name: string;
  status: string;
  startAt: string | null;
  dueAt: string | null;
  completedAt: string | null;
  manager: { name: string } | null;
  _count: { documents: number; assistances: number };
};

const STATUS_LABEL: Record<string, string> = {
  PLANNING: "Planejamento",
  ACTIVE: "Em andamento",
  ON_HOLD: "Pausado",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
};

export function PortalHomePage() {
  const { data, isLoading } = useQuery({
    queryKey: ["portal", "projects"],
    queryFn: () => portalGet<{ data: PortalProject[] }>("/projects"),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const projects = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Seus projetos</h1>
        <p className="text-sm text-muted-foreground">Acompanhe o cronograma, os documentos e a assistência de cada contrato.</p>
      </div>

      {projects.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhum projeto disponível no momento.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((p) => (
            <Link key={p.id} to={`/portal/projeto/${p.id}`}>
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-mono text-muted-foreground">Contrato {p.code}</p>
                      <h2 className="mt-0.5 font-medium leading-snug">{p.name}</h2>
                    </div>
                    <Badge variant="secondary">{STATUS_LABEL[p.status] ?? p.status}</Badge>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><FileText className="h-3.5 w-3.5" />{p._count.documents} documentos</span>
                    <span className="inline-flex items-center gap-1"><LifeBuoy className="h-3.5 w-3.5" />{p._count.assistances} chamados</span>
                  </div>
                  <span className="inline-flex items-center gap-1 text-sm text-primary">
                    Abrir <ArrowRight className="h-4 w-4" />
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
