CREATE TYPE "AgendaEventStatus" AS ENUM ('SCHEDULED','CONFIRMED','IN_PROGRESS','COMPLETED','CANCELLED','RESCHEDULED');
CREATE TYPE "AgendaVisibility" AS ENUM ('PRIVATE','TEAM','ORGANIZATION','CLIENT');
ALTER TYPE "NotificationType" ADD VALUE 'AGENDA';

CREATE TABLE "AgendaEventType" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "color" TEXT NOT NULL DEFAULT 'amber', "icon" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "organizationId" TEXT NOT NULL, CONSTRAINT "AgendaEventType_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AgendaEventType_organizationId_name_key" ON "AgendaEventType"("organizationId","name");
CREATE INDEX "AgendaEventType_organizationId_active_idx" ON "AgendaEventType"("organizationId","active");
ALTER TABLE "AgendaEventType" ADD CONSTRAINT "AgendaEventType_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AgendaEvent" (
  "id" TEXT NOT NULL, "title" TEXT NOT NULL, "description" TEXT, "startAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3) NOT NULL, "allDay" BOOLEAN NOT NULL DEFAULT false, "team" TEXT, "clientName" TEXT,
  "projectReference" TEXT, "location" TEXT, "status" "AgendaEventStatus" NOT NULL DEFAULT 'SCHEDULED',
  "visibility" "AgendaVisibility" NOT NULL DEFAULT 'TEAM', "notes" TEXT, "conflictOverride" BOOLEAN NOT NULL DEFAULT false,
  "cancelledAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, "organizationId" TEXT NOT NULL, "typeId" TEXT NOT NULL,
  "responsibleId" TEXT NOT NULL, "createdById" TEXT NOT NULL, "requisitionId" TEXT, "taskId" TEXT, "assistanceId" TEXT,
  CONSTRAINT "AgendaEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AgendaEvent_organizationId_startAt_idx" ON "AgendaEvent"("organizationId","startAt");
CREATE INDEX "AgendaEvent_organizationId_status_startAt_idx" ON "AgendaEvent"("organizationId","status","startAt");
CREATE INDEX "AgendaEvent_responsibleId_startAt_endAt_idx" ON "AgendaEvent"("responsibleId","startAt","endAt");
CREATE INDEX "AgendaEvent_typeId_idx" ON "AgendaEvent"("typeId");
CREATE INDEX "AgendaEvent_createdById_idx" ON "AgendaEvent"("createdById");
CREATE INDEX "AgendaEvent_requisitionId_idx" ON "AgendaEvent"("requisitionId");
CREATE INDEX "AgendaEvent_clientName_idx" ON "AgendaEvent"("clientName");
CREATE INDEX "AgendaEvent_projectReference_idx" ON "AgendaEvent"("projectReference");
ALTER TABLE "AgendaEvent" ADD CONSTRAINT "AgendaEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgendaEvent" ADD CONSTRAINT "AgendaEvent_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "AgendaEventType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgendaEvent" ADD CONSTRAINT "AgendaEvent_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgendaEvent" ADD CONSTRAINT "AgendaEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgendaEvent" ADD CONSTRAINT "AgendaEvent_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "Requisition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AgendaParticipant" ("eventId" TEXT NOT NULL,"userId" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "AgendaParticipant_pkey" PRIMARY KEY ("eventId","userId"));
CREATE INDEX "AgendaParticipant_userId_idx" ON "AgendaParticipant"("userId");
ALTER TABLE "AgendaParticipant" ADD CONSTRAINT "AgendaParticipant_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "AgendaEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgendaParticipant" ADD CONSTRAINT "AgendaParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AgendaReminder" ("id" TEXT NOT NULL,"minutesBefore" INTEGER NOT NULL,"remindAt" TIMESTAMP(3) NOT NULL,"sentAt" TIMESTAMP(3),"eventId" TEXT NOT NULL,"userId" TEXT NOT NULL,CONSTRAINT "AgendaReminder_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "AgendaReminder_eventId_userId_minutesBefore_key" ON "AgendaReminder"("eventId","userId","minutesBefore");
CREATE INDEX "AgendaReminder_userId_remindAt_sentAt_idx" ON "AgendaReminder"("userId","remindAt","sentAt");
ALTER TABLE "AgendaReminder" ADD CONSTRAINT "AgendaReminder_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "AgendaEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgendaReminder" ADD CONSTRAINT "AgendaReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AgendaAttachment" ("id" TEXT NOT NULL,"name" TEXT NOT NULL,"url" TEXT NOT NULL,"mimeType" TEXT,"size" INTEGER,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"eventId" TEXT NOT NULL,CONSTRAINT "AgendaAttachment_pkey" PRIMARY KEY ("id"));
CREATE INDEX "AgendaAttachment_eventId_idx" ON "AgendaAttachment"("eventId");
ALTER TABLE "AgendaAttachment" ADD CONSTRAINT "AgendaAttachment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "AgendaEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AgendaEventHistory" ("id" TEXT NOT NULL,"action" TEXT NOT NULL,"fromValue" JSONB,"toValue" JSONB,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"eventId" TEXT NOT NULL,"userId" TEXT,CONSTRAINT "AgendaEventHistory_pkey" PRIMARY KEY ("id"));
CREATE INDEX "AgendaEventHistory_eventId_createdAt_idx" ON "AgendaEventHistory"("eventId","createdAt");
CREATE INDEX "AgendaEventHistory_userId_idx" ON "AgendaEventHistory"("userId");
ALTER TABLE "AgendaEventHistory" ADD CONSTRAINT "AgendaEventHistory_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "AgendaEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgendaEventHistory" ADD CONSTRAINT "AgendaEventHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Activity_agendaEventId_idx" ON "Activity"("agendaEventId");
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_agendaEventId_fkey" FOREIGN KEY ("agendaEventId") REFERENCES "AgendaEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AgendaEventType" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgendaEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgendaParticipant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgendaReminder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgendaAttachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgendaEventHistory" ENABLE ROW LEVEL SECURITY;

INSERT INTO "AgendaEventType" ("id","name","color","icon","organizationId") VALUES
 ('agenda_type_installation','Instalação','blue','Wrench','default-org'),('agenda_type_visit','Visita','violet','MapPin','default-org'),
 ('agenda_type_assistance','Assistência','red','LifeBuoy','default-org'),('agenda_type_delivery','Entrega','green','Truck','default-org'),
 ('agenda_type_meeting','Reunião','amber','Users','default-org'),('agenda_type_cutting','Corte','orange','Scissors','default-org'),
 ('agenda_type_internal','Compromisso interno','slate','Building2','default-org'),('agenda_type_deadline','Prazo de projeto','purple','Flag','default-org'),
 ('agenda_type_task','Tarefa importante','cyan','CheckSquare','default-org'),('agenda_type_other','Outro','gray','Calendar','default-org')
ON CONFLICT ("organizationId","name") DO NOTHING;

INSERT INTO "Permission" ("id","code","label","module","createdAt") VALUES
 ('perm_agenda_read','agenda.read','Ver agenda','Agenda',CURRENT_TIMESTAMP),('perm_agenda_read_all','agenda.read.all','Ver agenda da equipe','Agenda',CURRENT_TIMESTAMP),
 ('perm_agenda_create','agenda.create','Criar compromissos','Agenda',CURRENT_TIMESTAMP),('perm_agenda_edit','agenda.edit','Editar próprios compromissos','Agenda',CURRENT_TIMESTAMP),
 ('perm_agenda_edit_all','agenda.edit.all','Editar agenda da equipe','Agenda',CURRENT_TIMESTAMP),('perm_agenda_cancel','agenda.cancel','Cancelar compromissos','Agenda',CURRENT_TIMESTAMP),
 ('perm_agenda_override','agenda.conflict.override','Ignorar conflitos de agenda','Agenda',CURRENT_TIMESTAMP),('perm_agenda_manage_types','agenda.types.manage','Gerenciar tipos de compromisso','Agenda',CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "RolePermission" ("roleId","permissionId") SELECT r."id",p."id" FROM "Role" r CROSS JOIN "Permission" p
WHERE (r."name" IN ('ADMIN','MANAGER') AND p."code" LIKE 'agenda.%')
 OR (r."name" IN ('WAREHOUSE','PRODUCTION','REQUESTER') AND p."code" IN ('agenda.read','agenda.create','agenda.edit','agenda.cancel'))
 OR (r."name"='VIEWER' AND p."code"='agenda.read') ON CONFLICT DO NOTHING;
