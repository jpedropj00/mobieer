-- Tipos de compromisso da agenda central (§12).
--
-- A organização não tinha nenhum tipo cadastrado, e o tipo é obrigatório no
-- compromisso: na prática ninguém conseguia agendar nada. Cria os 11 tipos da
-- especificação para toda organização. Idempotente: quem já tiver um tipo com
-- o mesmo nome fica com o dele (cor e ícone incluídos).

INSERT INTO "AgendaEventType" ("id", "organizationId", "name", "color", "icon", "active", "createdAt")
SELECT md5('agenda-type:' || o."id" || ':' || t.name), o."id", t.name, t.color, t.icon, true, CURRENT_TIMESTAMP
FROM "Organization" o
CROSS JOIN (VALUES
  ('Reunião',             'blue',   'users'),
  ('Visita',              'cyan',   'map-pin'),
  ('Medição',             'violet', 'ruler'),
  ('Apresentação',        'purple', 'presentation'),
  ('Pagamento',           'green',  'wallet'),
  ('Produção',            'orange', 'factory'),
  ('Entrega',             'amber',  'truck'),
  ('Montagem',            'red',    'hammer'),
  ('Vistoria',            'slate',  'clipboard-check'),
  ('Assistência',         'gray',   'wrench'),
  ('Compromisso interno', 'amber',  'calendar')
) AS t(name, color, icon)
ON CONFLICT ("organizationId", "name") DO NOTHING;
