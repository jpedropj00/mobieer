import assert from "node:assert/strict";
import test from "node:test";
import { InventoryStatus, RequisitionStatus } from "@prisma/client";
import { ForbiddenError } from "../src/utils/ApiError";
import { assertInventoryTransition } from "../src/modules/inventory/inventory.service";
import { assertRequisitionTransition } from "../src/modules/requisitions/requisitions.service";

test("não permite liberar requisição usando apenas permissão de cancelamento", () => {
  assert.throws(
    () => assertRequisitionTransition(RequisitionStatus.IN_REVIEW, RequisitionStatus.RELEASED, ["requisitions.cancel"]),
    ForbiddenError
  );
});

test("permite liberação com a permissão específica", () => {
  assert.doesNotThrow(() =>
    assertRequisitionTransition(RequisitionStatus.IN_REVIEW, RequisitionStatus.RELEASED, ["requisitions.release"])
  );
});

test("solicitante pode enviar o próprio rascunho sem permissão operacional", () => {
  assert.doesNotThrow(() => assertRequisitionTransition(RequisitionStatus.DRAFT, RequisitionStatus.REQUESTED, []));
});

test("não permite pular da solicitação diretamente para o corte", () => {
  assert.throws(() => assertRequisitionTransition(RequisitionStatus.REQUESTED, RequisitionStatus.IN_CUTTING, ["requisitions.cut"]));
});

test("inventário concluído não pode ser reaberto", () => {
  assert.throws(() => assertInventoryTransition(InventoryStatus.CONCLUDED, InventoryStatus.OPEN));
});

test("inventário aberto pode avançar para em andamento", () => {
  assert.doesNotThrow(() => assertInventoryTransition(InventoryStatus.OPEN, InventoryStatus.IN_PROGRESS));
});
