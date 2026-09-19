/**
 * Fluxo de 12 status da solicitação de peças, visibilidade por montador e
 * validação das medidas.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { PartRequestStatus as S } from "@prisma/client";
import {
  ALLOWED_TRANSITIONS,
  FINAL_STATUSES,
  PART_STATUSES,
  STATUS_LABEL,
  TRANSITION_PERMISSION,
  type Actor,
  assertCanEdit,
  assertCanSee,
  assertOcrConfirmed,
  assertSubmittable,
  assertTransition,
  canSee,
  formatNumber,
  isFinal,
  timestampsFor,
  validateItem,
} from "../src/modules/parts/parts.service";

const ator = (perms: string[], id = "u1", contractorId: string | null = null): Actor & { contractorId: string | null } => ({
  id,
  permissions: perms,
  contractorId,
});

const TUDO = [
  "parts.read", "parts.read.all", "parts.create", "parts.analyze",
  "parts.produce", "parts.deliver", "parts.cancel",
];
const admin = ator(TUDO);

// ---------------------------------------------------------------------------
// O mapa de status
// ---------------------------------------------------------------------------

test("os 12 status da especificação existem e têm rótulo", () => {
  assert.equal(PART_STATUSES.length, 12);
  assert.equal(new Set(PART_STATUSES).size, 12, "sem repetidos");
  for (const s of PART_STATUSES) assert.ok(STATUS_LABEL[s]?.length > 2, `${s} sem rótulo`);
});

test("todo status tem transições declaradas e permissão declarada", () => {
  for (const s of PART_STATUSES) {
    assert.ok(Array.isArray(ALLOWED_TRANSITIONS[s]), `${s} sem transições`);
    assert.ok(TRANSITION_PERMISSION[s]?.length, `${s} sem permissão`);
  }
});

test("concluída, recusada e cancelada são os fins de linha", () => {
  assert.deepEqual([...FINAL_STATUSES].sort(), [S.CANCELADA, S.CONCLUIDA, S.RECUSADA].sort());
  for (const s of FINAL_STATUSES) {
    assert.equal(isFinal(s), true);
    assert.deepEqual(ALLOWED_TRANSITIONS[s], [], `${s} não pode ter saída`);
  }
});

test("todo status não final chega em CONCLUIDA ou em uma saída lateral", () => {
  // sem caminho sem saída: de qualquer ponto dá para cancelar ou concluir
  for (const s of PART_STATUSES.filter((x) => !isFinal(x))) {
    assert.ok(ALLOWED_TRANSITIONS[s].length > 0, `${s} ficou sem saída`);
  }
});

test("o caminho feliz completo é possível", () => {
  const caminho = [S.RASCUNHO, S.ENVIADA, S.EM_ANALISE, S.APROVADA, S.EM_PRODUCAO, S.PRONTA, S.EM_TRANSPORTE, S.ENTREGUE, S.INSTALADA, S.CONCLUIDA];
  for (let i = 0; i < caminho.length - 1; i++) {
    assert.doesNotThrow(() => assertTransition(caminho[i], caminho[i + 1], admin), `${caminho[i]} -> ${caminho[i + 1]}`);
  }
});

// ---------------------------------------------------------------------------
// Transições
// ---------------------------------------------------------------------------

test("não dá para pular etapas", () => {
  assert.throws(() => assertTransition(S.RASCUNHO, S.APROVADA, admin), /não dá para ir/);
  assert.throws(() => assertTransition(S.ENVIADA, S.ENTREGUE, admin), /não dá para ir/);
  assert.throws(() => assertTransition(S.APROVADA, S.CONCLUIDA, admin), /não dá para ir/);
});

test("a mensagem de erro diz para onde dá para ir", () => {
  assert.throws(() => assertTransition(S.RASCUNHO, S.PRONTA, admin), (e: Error) => {
    assert.match(e.message, /Enviada/);
    assert.match(e.message, /Cancelada/);
    return true;
  });
});

test("status final não se mexe mais", () => {
  for (const s of FINAL_STATUSES) {
    assert.throws(() => assertTransition(s, S.ENVIADA, admin), /não muda mais de status/);
  }
});

test("mover para o mesmo status é recusado", () => {
  assert.throws(() => assertTransition(S.ENVIADA, S.ENVIADA, admin), /já está em/);
});

test("recusa exige motivo", () => {
  assert.throws(() => assertTransition(S.EM_ANALISE, S.RECUSADA, admin), /motivo da recusa/);
  assert.throws(() => assertTransition(S.EM_ANALISE, S.RECUSADA, admin, { refusalReason: "   " }), /motivo da recusa/);
  assert.doesNotThrow(() => assertTransition(S.EM_ANALISE, S.RECUSADA, admin, { refusalReason: "Peça fora de linha" }));
});

test("dá para aprovar direto da solicitação enviada, sem passar por análise", () => {
  assert.doesNotThrow(() => assertTransition(S.ENVIADA, S.APROVADA, admin));
});

test("entrega sem transporte é possível (a loja entrega na hora)", () => {
  assert.doesNotThrow(() => assertTransition(S.PRONTA, S.ENTREGUE, admin));
});

test("entregue pode concluir sem passar por instalada", () => {
  assert.doesNotThrow(() => assertTransition(S.ENTREGUE, S.CONCLUIDA, admin));
});

// ---------------------------------------------------------------------------
// Permissões do fluxo
// ---------------------------------------------------------------------------

const montador = ator(["parts.read", "parts.create"], "m1", "c1");

test("o montador envia a própria solicitação", () => {
  assert.doesNotThrow(() => assertTransition(S.RASCUNHO, S.ENVIADA, montador));
});

test("o montador não aprova, não produz e não cancela", () => {
  assert.throws(() => assertTransition(S.ENVIADA, S.APROVADA, montador), /permissão/);
  assert.throws(() => assertTransition(S.APROVADA, S.EM_PRODUCAO, montador), /permissão/);
  assert.throws(() => assertTransition(S.RASCUNHO, S.CANCELADA, montador), /permissão/);
});

test("o montador confirma que instalou a peça que recebeu", () => {
  assert.doesNotThrow(() => assertTransition(S.ENTREGUE, S.INSTALADA, montador));
});

test("produção move produção, mas não aprova", () => {
  const producao = ator(["parts.read", "parts.read.all", "parts.produce", "parts.deliver"]);
  assert.doesNotThrow(() => assertTransition(S.APROVADA, S.EM_PRODUCAO, producao));
  assert.doesNotThrow(() => assertTransition(S.EM_PRODUCAO, S.PRONTA, producao));
  assert.doesNotThrow(() => assertTransition(S.PRONTA, S.EM_TRANSPORTE, producao));
  assert.throws(() => assertTransition(S.ENVIADA, S.APROVADA, producao), /permissão/);
});

test("o gestor aprova e recusa, mas não move a produção", () => {
  const gestor = ator(["parts.read", "parts.read.all", "parts.analyze", "parts.cancel"]);
  assert.doesNotThrow(() => assertTransition(S.ENVIADA, S.EM_ANALISE, gestor));
  assert.doesNotThrow(() => assertTransition(S.EM_ANALISE, S.APROVADA, gestor));
  assert.doesNotThrow(() => assertTransition(S.APROVADA, S.CANCELADA, gestor));
  assert.throws(() => assertTransition(S.APROVADA, S.EM_PRODUCAO, gestor), /permissão/);
});

// ---------------------------------------------------------------------------
// Carimbos de data
// ---------------------------------------------------------------------------

test("cada status marca a data certa", () => {
  const agora = new Date("2026-09-19T12:00:00Z");
  assert.deepEqual(timestampsFor(S.ENVIADA, agora), { submittedAt: agora });
  assert.deepEqual(timestampsFor(S.APROVADA, agora), { approvedAt: agora });
  assert.deepEqual(timestampsFor(S.RECUSADA, agora), { refusedAt: agora });
  assert.deepEqual(timestampsFor(S.ENTREGUE, agora), { deliveredAt: agora });
  assert.deepEqual(timestampsFor(S.CONCLUIDA, agora), { completedAt: agora });
  assert.deepEqual(timestampsFor(S.CANCELADA, agora), { cancelledAt: agora });
  assert.deepEqual(timestampsFor(S.EM_PRODUCAO, agora), {}, "etapa de produção não tem carimbo próprio");
});

// ---------------------------------------------------------------------------
// Visibilidade
// ---------------------------------------------------------------------------

const solicitacao = { createdById: "m1", contractorId: "c1", status: S.RASCUNHO };

test("quem tem parts.read.all vê tudo", () => {
  assert.equal(canSee(solicitacao, ator(["parts.read.all"], "outro")), true);
});

test("o montador vê o que ele criou", () => {
  assert.equal(canSee(solicitacao, ator(["parts.read"], "m1")), true);
});

test("o montador vê o que está no cadastro dele, mesmo criado pela equipe", () => {
  const daEquipe = { createdById: "gestor", contractorId: "c1" };
  assert.equal(canSee(daEquipe, ator(["parts.read"], "m1", "c1")), true);
});

test("um montador não vê a solicitação de outro", () => {
  const outro = ator(["parts.read"], "m2", "c2");
  assert.equal(canSee(solicitacao, outro), false);
  assert.throws(() => assertCanSee(solicitacao, outro), /outro montador/);
});

test("montador desativado (contractorId nulo) perde o acesso ao que não criou", () => {
  const daEquipe = { createdById: "gestor", contractorId: "c1" };
  assert.equal(canSee(daEquipe, ator(["parts.read"], "m1", null)), false);
});

// ---------------------------------------------------------------------------
// Edição
// ---------------------------------------------------------------------------

test("rascunho é editável por quem criou", () => {
  assert.doesNotThrow(() => assertCanEdit(solicitacao, ator(["parts.read"], "m1")));
});

test("depois de enviada, só a equipe que analisa altera", () => {
  const enviada = { ...solicitacao, status: S.ENVIADA };
  assert.throws(() => assertCanEdit(enviada, ator(["parts.read"], "m1")), /só é alterada pela equipe/);
  assert.doesNotThrow(() => assertCanEdit(enviada, ator(["parts.read.all", "parts.analyze"], "gestor")));
});

test("solicitação encerrada não é alterada nem pela gestão", () => {
  for (const s of FINAL_STATUSES) {
    assert.throws(() => assertCanEdit({ ...solicitacao, status: s }, admin), /não pode ser alterada/);
  }
});

// ---------------------------------------------------------------------------
// Peças e medidas
// ---------------------------------------------------------------------------

test("solicitação sem peça não é enviada", () => {
  assert.throws(() => assertSubmittable(0), /ao menos uma peça/);
  assert.doesNotThrow(() => assertSubmittable(1));
});

test("a peça precisa de nome e quantidade válida", () => {
  assert.throws(() => validateItem({ name: "", quantity: 1 }), /nome da peça/);
  assert.throws(() => validateItem({ name: "   ", quantity: 1 }), /nome da peça/);
  assert.throws(() => validateItem({ name: "Porta", quantity: 0 }), /quantidade precisa ser 1 ou mais/);
  assert.throws(() => validateItem({ name: "Porta", quantity: -3 }), /quantidade/);
  assert.throws(() => validateItem({ name: "Porta", quantity: 1.5 }), /quantidade/);
  assert.doesNotThrow(() => validateItem({ name: "Porta", quantity: 2 }));
});

test("medida em centímetro por engano é barrada", () => {
  // 2,10m digitado como 21000 (mm errado) não passa
  assert.throws(() => validateItem({ name: "Lateral", quantity: 1, height: 21000 }), /milímetros/);
  assert.doesNotThrow(() => validateItem({ name: "Lateral", quantity: 1, height: 2100 }), "2,10m em mm passa");
});

test("medida zero ou negativa é barrada", () => {
  assert.throws(() => validateItem({ name: "x", quantity: 1, width: 0 }), /largura/);
  assert.throws(() => validateItem({ name: "x", quantity: 1, depth: -10 }), /profundidade/);
  assert.throws(() => validateItem({ name: "x", quantity: 1, thickness: 0 }), /espessura/);
});

test("medida ausente é permitida — nem toda peça tem as quatro", () => {
  assert.doesNotThrow(() => validateItem({ name: "Puxador", quantity: 4 }));
  assert.doesNotThrow(() => validateItem({ name: "Prateleira", quantity: 1, width: 800, thickness: 18 }));
});

test("o erro aponta qual peça da lista está errada", () => {
  assert.throws(() => validateItem({ name: "Fundo", quantity: 0 }, 2), /Peça 3 \(Fundo\)/);
});

// ---------------------------------------------------------------------------
// Leitura de etiqueta (OCR)
// ---------------------------------------------------------------------------

test("leitura não confirmada não vira peça", () => {
  assert.throws(() => assertOcrConfirmed({ ocrConfirmedAt: null, ocrJson: { name: "Porta" } }), /Confirme a leitura/);
});

test("foto sem leitura não tem o que confirmar", () => {
  assert.throws(() => assertOcrConfirmed({ ocrConfirmedAt: null, ocrJson: null }), /não tem leitura/);
});

test("leitura confirmada passa", () => {
  assert.doesNotThrow(() => assertOcrConfirmed({ ocrConfirmedAt: new Date(), ocrJson: { name: "Porta" } }));
});

// ---------------------------------------------------------------------------
// Numeração
// ---------------------------------------------------------------------------

test("o número segue o padrão SOL-00001", () => {
  assert.equal(formatNumber(1), "SOL-00001");
  assert.equal(formatNumber(42), "SOL-00042");
  assert.equal(formatNumber(99999), "SOL-99999");
  assert.equal(formatNumber(100000), "SOL-100000", "passa de 5 dígitos sem truncar");
});
