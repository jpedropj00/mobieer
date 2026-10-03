/**
 * "Minhas tarefas": separa as tarefas da pessoa por prazo. Toda tarefa em
 * aberto cai em algum grupo — a que não tem prazo vai para "Sem prazo", senão
 * some da tela. O dia é o do fuso da loja. Regras puras.
 */

const TZ = "America/Fortaleza";
const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });

export function groupMyTasks<T extends { dueAt: Date | null; completedAt: Date | null }>(tasks: T[], now = new Date()) {
  const today = dayOf(now);
  const open = tasks.filter((t) => !t.completedAt);
  const due = (t: T) => (t.dueAt ? dayOf(t.dueAt) : null);
  return {
    overdue: open.filter((t) => t.dueAt && t.dueAt < now && due(t) !== today),
    today: open.filter((t) => due(t) === today),
    upcoming: open.filter((t) => t.dueAt && t.dueAt > now && due(t) !== today),
    noDate: open.filter((t) => !t.dueAt),
    completed: tasks
      .filter((t) => t.completedAt)
      .sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime())
      .slice(0, 20),
  };
}

/**
 * De quem é a tarefa: responsável, participante, dono de uma subtarefa em
 * aberto, ou quem criou uma tarefa que ainda não tem responsável.
 */
export function myTasksWhere(userId: string) {
  return {
    OR: [
      { assigneeId: userId },
      { participants: { some: { userId } } },
      { subtasks: { some: { assigneeId: userId, completed: false } } },
      { assigneeId: null, createdById: userId },
    ],
  };
}
