-- Mais de um cargo por usuário: o perfil principal continua em User.roleId;
-- os adicionais ficam aqui. As permissões da pessoa são a soma de todos.
CREATE TABLE IF NOT EXISTS "UserExtraRole" (
  "userId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserExtraRole_pkey" PRIMARY KEY ("userId", "roleId"),
  CONSTRAINT "UserExtraRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserExtraRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "UserExtraRole_roleId_idx" ON "UserExtraRole"("roleId");
