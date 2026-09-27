/**
 * Entrega e assinatura dos documentos do montador (§7): a máquina de estados
 * dos seis status, a validação da assinatura desenhada e o separador de SQL
 * usado para aplicar migrations.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSINATURA_MAX_BYTES,
  STATUS_LABEL,
  assinaturaCabe,
  estaConcluido,
  foiEnviado,
  isAssinaturaValida,
  nextStatus,
} from "../src/modules/contractors/documents.service";
import { splitStatements } from "../scripts/apply-migration";

const COM_ASSINATURA = true;
const SEM_ASSINATURA = false;

/** Atalho: devolve o status novo, ou lança com o motivo, para o teste ficar curto. */
function aplicar(atual: Parameters<typeof nextStatus>[0], evento: Parameters<typeof nextStatus>[1], exige: boolean) {
  const r = nextStatus(atual, evento, exige);
  assert.equal(r.ok, true, r.ok ? "" : `recusou: ${r.motivo}`);
  return (r as { ok: true; status: string }).status;
}

function recusa(atual: Parameters<typeof nextStatus>[0], evento: Parameters<typeof nextStatus>[1], exige: boolean) {
  const r = nextStatus(atual, evento, exige);
  assert.equal(r.ok, false, "deveria ter recusado");
  return (r as { ok: false; motivo: string }).motivo;
}

// ---------------------------------------------------------------------------
// O caminho feliz dos seis status
// ---------------------------------------------------------------------------

test("documento que pede assinatura percorre os seis status", () => {
  let s = "AGUARDANDO_ENVIO" as const;
  const enviado = aplicar(s, "ENVIAR", COM_ASSINATURA);
  assert.equal(enviado, "ENVIADO");
  const visto = aplicar("ENVIADO", "VISUALIZAR", COM_ASSINATURA);
  assert.equal(visto, "AGUARDANDO_ASSINATURA", "quem pede assinatura já fica esperando ela");
  assert.equal(aplicar("AGUARDANDO_ASSINATURA", "ASSINAR", COM_ASSINATURA), "ASSINADO");
});

test("documento sem assinatura termina em visualizado", () => {
  assert.equal(aplicar("ENVIADO", "VISUALIZAR", SEM_ASSINATURA), "VISUALIZADO");
  assert.equal(estaConcluido("VISUALIZADO", SEM_ASSINATURA), true);
  assert.equal(estaConcluido("VISUALIZADO", COM_ASSINATURA), false, "com assinatura ainda falta assinar");
});

test("recusa registra e permite reenvio depois de corrigir", () => {
  assert.equal(aplicar("AGUARDANDO_ASSINATURA", "RECUSAR", COM_ASSINATURA), "RECUSADO");
  assert.equal(aplicar("RECUSADO", "REENVIAR", COM_ASSINATURA), "ENVIADO");
});

// ---------------------------------------------------------------------------
// O que a máquina precisa impedir
// ---------------------------------------------------------------------------

test("nada acontece antes de a empresa enviar", () => {
  assert.match(recusa("AGUARDANDO_ENVIO", "VISUALIZAR", COM_ASSINATURA), /ainda não foi enviado/i);
  assert.match(recusa("AGUARDANDO_ENVIO", "ASSINAR", COM_ASSINATURA), /ainda não foi enviado/i);
  assert.match(recusa("AGUARDANDO_ENVIO", "RECUSAR", COM_ASSINATURA), /ainda não foi enviado/i);
});

test("não dá para assinar um documento que não pede assinatura", () => {
  assert.match(recusa("VISUALIZADO", "ASSINAR", SEM_ASSINATURA), /não pede assinatura/i);
  assert.match(recusa("VISUALIZADO", "RECUSAR", SEM_ASSINATURA), /não pede assinatura/i);
});

test("assinado é final: não reassina, não recusa, não reenvia", () => {
  assert.match(recusa("ASSINADO", "ASSINAR", COM_ASSINATURA), /já está assinado/i);
  assert.match(recusa("ASSINADO", "RECUSAR", COM_ASSINATURA), /já está assinado/i);
  assert.match(recusa("ASSINADO", "REENVIAR", COM_ASSINATURA), /recusado/i);
});

test("enviar duas vezes não é aceito", () => {
  assert.match(recusa("ENVIADO", "ENVIAR", COM_ASSINATURA), /já foi enviado/i);
});

test("enviar um assinado diz que está assinado, não que já foi enviado", () => {
  // a mensagem vai para a tela: dizer o motivo certo poupa a pessoa de procurar
  assert.match(recusa("ASSINADO", "ENVIAR", COM_ASSINATURA), /já está assinado/i);
});

test("reabrir um documento não desfaz o que já aconteceu", () => {
  // o montador abre de novo o que já assinou: continua assinado
  assert.equal(aplicar("ASSINADO", "VISUALIZAR", COM_ASSINATURA), "ASSINADO");
  assert.equal(aplicar("AGUARDANDO_ASSINATURA", "VISUALIZAR", COM_ASSINATURA), "AGUARDANDO_ASSINATURA");
  assert.equal(aplicar("RECUSADO", "VISUALIZAR", COM_ASSINATURA), "RECUSADO");
});

test("o montador só enxerga o que já saiu da empresa", () => {
  assert.equal(foiEnviado("AGUARDANDO_ENVIO"), false);
  for (const s of ["ENVIADO", "VISUALIZADO", "AGUARDANDO_ASSINATURA", "ASSINADO", "RECUSADO"] as const) {
    assert.equal(foiEnviado(s), true, s);
  }
});

test("todo status tem rótulo em português", () => {
  const esperados = ["AGUARDANDO_ENVIO", "ENVIADO", "VISUALIZADO", "AGUARDANDO_ASSINATURA", "ASSINADO", "RECUSADO"];
  assert.deepEqual(Object.keys(STATUS_LABEL).sort(), [...esperados].sort());
  for (const v of Object.values(STATUS_LABEL)) assert.equal(v.length > 0, true);
});

// ---------------------------------------------------------------------------
// A assinatura desenhada
// ---------------------------------------------------------------------------

const pngFalso = "data:image/png;base64," + "A".repeat(200);

test("aceita o PNG que o SignaturePad produz", () => {
  assert.equal(isAssinaturaValida(pngFalso), true);
});

test("recusa qualquer coisa que não seja PNG", () => {
  // SVG renderizado como imagem executaria script: não entra
  assert.equal(isAssinaturaValida("data:image/svg+xml;base64," + "A".repeat(200)), false);
  assert.equal(isAssinaturaValida("<script>alert(1)</script>"), false);
  assert.equal(isAssinaturaValida("https://exemplo.com/assinatura.png"), false);
  assert.equal(isAssinaturaValida(""), false);
  assert.equal(isAssinaturaValida(null), false);
});

test("recusa PNG curto demais para ser um desenho", () => {
  assert.equal(isAssinaturaValida("data:image/png;base64,AAAA"), false);
});

test("recusa base64 malformado", () => {
  assert.equal(isAssinaturaValida("data:image/png;base64," + "!@#$".repeat(60)), false);
});

test("a assinatura tem teto de tamanho", () => {
  assert.equal(assinaturaCabe(pngFalso), true);
  const enorme = "data:image/png;base64," + "A".repeat(ASSINATURA_MAX_BYTES * 2);
  assert.equal(assinaturaCabe(enorme), false, "desenho não pode virar upload disfarçado");
});

// ---------------------------------------------------------------------------
// Separador de SQL das migrations
// ---------------------------------------------------------------------------

test("separa instruções simples", () => {
  assert.deepEqual(splitStatements("SELECT 1;\nSELECT 2;\n"), ["SELECT 1;", "SELECT 2;"]);
});

test("não corta no ; de dentro de um bloco $$", () => {
  const sql = `DO $$
BEGIN
  CREATE TYPE "X" AS ENUM ('A');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "Y" ADD COLUMN "z" TEXT;
`;
  const st = splitStatements(sql);
  assert.equal(st.length, 2, "o DO inteiro é uma instrução só");
  assert.match(st[0], /^DO \$\$/);
  assert.match(st[0], /END\s*\$\$;$/);
  assert.match(st[1], /^ALTER TABLE/);
});

test("comentário de linha não vira instrução", () => {
  const st = splitStatements("-- explicação\n-- outra\nSELECT 1;\n");
  assert.deepEqual(st, ["SELECT 1;"]);
});

test("instrução em várias linhas fica inteira", () => {
  const st = splitStatements('ALTER TABLE "A"\n  ADD COLUMN "b" TEXT,\n  ADD COLUMN "c" TEXT;\n');
  assert.equal(st.length, 1);
  assert.match(st[0], /"c" TEXT;$/);
});
