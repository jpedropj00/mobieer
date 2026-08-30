import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { CalendarCheck2, CalendarClock, CheckCircle2, CircleAlert } from "lucide-react";
import { apiGet } from "@/services/api";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageSkeleton } from "@/components/ui/states";

type Task = { id:string; title:string; priority:string; dueAt?:string|null; completedAt?:string|null; column:{name:string;board:{id:string;name:string}} };
type Groups = { overdue:Task[]; today:Task[]; upcoming:Task[]; completed:Task[] };
const priority:{[key:string]:string}={LOW:"Baixa",NORMAL:"Normal",HIGH:"Alta",URGENT:"Urgente"};
export function MyTasksPage(){const navigate=useNavigate();const q=useQuery({queryKey:["my-kanban-tasks"],queryFn:()=>apiGet<{data:Groups}>("/organization/my-tasks")});if(q.isLoading)return <PageSkeleton/>;const data=q.data?.data;const groups=[{key:"overdue" as const,title:"Atrasadas",icon:CircleAlert,items:data?.overdue??[]},{key:"today" as const,title:"Para hoje",icon:CalendarCheck2,items:data?.today??[]},{key:"upcoming" as const,title:"Próximas",icon:CalendarClock,items:data?.upcoming??[]},{key:"completed" as const,title:"Concluídas recentemente",icon:CheckCircle2,items:data?.completed??[]}];return <div className="space-y-6"><PageHeader title="Minhas tarefas" description="Tarefas atribuídas a você em todos os quadros."/><div className="grid gap-4 xl:grid-cols-2">{groups.map(g=><Card key={g.key}><CardHeader><CardTitle className="flex items-center gap-2"><g.icon className="h-5 w-5"/>{g.title}<Badge variant="secondary">{g.items.length}</Badge></CardTitle></CardHeader><CardContent>{g.items.length===0?<EmptyState title={`Nenhuma tarefa em ${g.title.toLowerCase()}`}/>:<div className="space-y-2">{g.items.map(t=><button key={t.id} onClick={()=>navigate(`/organizacao/${t.column.board.id}`)} className="flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition hover:bg-muted/40"><div><strong className="text-sm">{t.title}</strong><p className="text-xs text-muted-foreground">{t.column.board.name} · {t.column.name}</p></div><div className="text-right"><Badge variant="outline">{priority[t.priority]}</Badge>{t.dueAt&&<p className="mt-1 text-[11px] text-muted-foreground">{new Date(t.dueAt).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"})}</p>}</div></button>)}</div>}</CardContent></Card>)}</div></div>}
