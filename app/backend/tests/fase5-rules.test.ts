import assert from "node:assert/strict";
import test from "node:test";
import { ProductionSector as PrismaSector, ProductionStage as PrismaStage } from "@prisma/client";
import { calendarHolidays, easterSunday, ymd } from "../src/modules/hr/holidays.service";
import {
  DEFAULT_CONTRACT_BODY,
  MERGE_FIELDS,
  contractPdf,
  moneyToWords,
  numberToWords,
  renderTemplate,
} from "../src/modules/templates/contract.service";
import { decodeXmlBuffer, parseMoney, parsePromobXml } from "../src/modules/promob/promob.service";
import { PRODUCTION_SECTORS, SECTOR_LABEL, nextSector } from "../src/modules/production/shopfloor.service";
import { PRODUCTION_STAGES, STAGE_LABEL, isDispatchReady, nextStage } from "../src/modules/production/production.service";
import { localDay, localPeriod, shiftMinutes, summarizeShifts } from "../src/modules/contractors/contractors.service";
import { MAX_DRAWING_BYTES, decodeDrawingDataUrl, techProjectDueDate } from "../src/modules/measurements/measurements.service";
import { InvalidQueryError, PayloadTooLargeError, UnsupportedFileTypeError, ValidationError } from "../src/utils/ApiError";

// ============================ Feriados ============================

test("Páscoa bate com o calendário oficial", () => {
  assert.equal(ymd(easterSunday(2024)), "2024-03-31");
  assert.equal(ymd(easterSunday(2025)), "2025-04-20");
  assert.equal(ymd(easterSunday(2026)), "2026-04-05");
  assert.equal(ymd(easterSunday(2027)), "2027-03-28");
  assert.equal(ymd(easterSunday(2030)), "2030-04-21");
});

test("feriados móveis de 2026 derivados da Páscoa", () => {
  const byName = Object.fromEntries(calendarHolidays(2026).map((h) => [h.name, h]));
  assert.equal(byName["Carnaval"].date, "2026-02-17");
  assert.equal(byName["Sexta-feira Santa (Paixão de Cristo)"].date, "2026-04-03");
  assert.equal(byName["Corpus Christi"].date, "2026-06-04");
  assert.equal(byName["Carnaval"].optional, true);
  assert.equal(byName["Sexta-feira Santa (Paixão de Cristo)"].optional, false);
});

test("inclui os feriados nacionais, do Ceará e de Fortaleza", () => {
  const list = calendarHolidays(2026);
  const at = (d: string) => list.filter((h) => h.date === d).map((h) => h.scope);
  assert.ok(at("2026-11-20").includes("NACIONAL"), "Consciência Negra é nacional desde 2024");
  assert.ok(at("2026-03-25").includes("ESTADUAL"), "Data Magna do Ceará");
  assert.ok(at("2026-08-15").includes("MUNICIPAL"), "padroeira de Fortaleza");
});

test("lista de feriados é ordenada, sem data inválida e sem duplicata", () => {
  for (const year of [2024, 2025, 2026, 2027, 2028]) {
    const list = calendarHolidays(year);
    const keys = list.map((h) => `${h.date}|${h.name}`);
    assert.equal(new Set(keys).size, keys.length, `duplicata em ${year}`);
    assert.deepEqual([...list].sort((a, b) => a.date.localeCompare(b.date)), list);
    for (const h of list) {
      assert.match(h.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(h.date.startsWith(String(year)), `${h.name} fora do ano ${year}`);
    }
  }
});

// ============================ Contrato ============================

test("número por extenso", () => {
  assert.equal(numberToWords(0), "zero");
  assert.equal(numberToWords(100), "cem");
  assert.equal(numberToWords(101), "cento e um");
  assert.equal(numberToWords(1000), "mil");
  assert.equal(numberToWords(2015), "dois mil e quinze");
  assert.equal(numberToWords(17), "dezessete");
});

test("valor em reais por extenso com concordância", () => {
  assert.equal(moneyToWords(1), "um real");
  assert.equal(moneyToWords(0.01), "um centavo");
  assert.equal(moneyToWords(0.5), "cinquenta centavos");
  assert.equal(moneyToWords(45000), "quarenta e cinco mil reais");
  assert.equal(moneyToWords(1000000), "um milhão de reais");
  assert.equal(moneyToWords(2000000), "dois milhões de reais");
  assert.equal(moneyToWords(1500000), "um milhão e quinhentos mil reais");
  assert.equal(moneyToWords(1234.56), "mil, duzentos e trinta e quatro reais e cinquenta e seis centavos");
  assert.equal(moneyToWords(0), "zero real");
});

test("extenso não sofre com arredondamento de ponto flutuante", () => {
  // 0.1 + 0.2 = 0.30000000000000004
  assert.equal(moneyToWords(0.1 + 0.2), "trinta centavos");
  assert.equal(moneyToWords(19.99), "dezenove reais e noventa e nove centavos");
});

test("renderTemplate substitui, marca vazios e desconhecidos", () => {
  const r = renderTemplate("Olá {{ cliente.nome }}, doc {{cliente.documento}} {{campo.inexistente}}", {
    "cliente.nome": "Maria",
    "cliente.documento": "",
  });
  assert.equal(r.text, "Olá Maria, doc  ____");
  assert.deepEqual(r.missing.sort(), ["campo.inexistente", "cliente.documento"]);
});

test("renderTemplate não interpreta valores como marcadores (sem injeção)", () => {
  const r = renderTemplate("{{cliente.nome}}", { "cliente.nome": "{{empresa.cnpj}} $& $1" });
  assert.equal(r.text, "{{empresa.cnpj}} $& $1");
});

test("o contrato padrão só usa marcadores que existem", () => {
  const known = new Set(MERGE_FIELDS.map((f) => f.key));
  const used = [...DEFAULT_CONTRACT_BODY.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]);
  assert.ok(used.length > 10);
  const unknown = used.filter((k) => !known.has(k));
  assert.deepEqual(unknown, [], `marcadores sem definição: ${unknown.join(", ")}`);
});

test("marcadores disponíveis não têm chave repetida", () => {
  const keys = MERGE_FIELDS.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("PDF do contrato é gerado com acentos", async () => {
  const pdf = await contractPdf({ title: "Contrato", body: "CLÁUSULA PRIMEIRA\nAção, coração, São José." });
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 800);
});

// ============================ Promob ============================

test("parseMoney entende formato BR e americano", () => {
  assert.equal(parseMoney("1.234,56"), 1234.56);
  assert.equal(parseMoney("1234.56"), 1234.56);
  assert.equal(parseMoney("1,234.56"), 1234.56);
  assert.equal(parseMoney("R$ 45.000,00"), 45000);
  assert.equal(parseMoney("850,5"), 850.5);
  assert.equal(parseMoney("0"), 0);
  assert.equal(parseMoney(""), null);
  assert.equal(parseMoney("abc"), null);
  assert.equal(parseMoney(null), null);
});

test("Promob: total vem dos ambientes sem somar os itens de novo", () => {
  const p = parsePromobXml(`
    <AMBIENTE DESCRICAO="Cozinha" PRECOTOTAL="25.400,50"/>
    <AMBIENTE DESCRICAO="Quarto" PRECOTOTAL="19.599,50"/>
    <ITEM DESCRICAO="Módulo" REPETICOES="4" PRECOUNITARIO="850,00" AMBIENTE="Cozinha"/>
  `);
  assert.equal(p.totals.valor, 45000);
  assert.equal(p.itens[0].valorTotal, 3400);
});

test("Promob: sem valor nos ambientes soma os itens; sem valor nenhum fica null", () => {
  const soItens = parsePromobXml(`<ITEM DESCRICAO="A" REPETICOES="2" PRECOUNITARIO="10,00"/><ITEM DESCRICAO="B" PRECOTOTAL="5"/>`);
  assert.equal(soItens.totals.valor, 25);
  const semValor = parsePromobXml(`<AMBIENTE DESCRICAO="Sala"/><ITEM DESCRICAO="Porta" REPETICOES="1"/>`);
  assert.equal(semValor.totals.valor, null);
  assert.equal(semValor.totals.itens, 1);
});

test("Promob: XML vazio ou sem tags não quebra", () => {
  const p = parsePromobXml("");
  assert.deepEqual(p.totals, { ambientes: 0, itens: 0, valor: null });
});

test("Promob: decodifica latin-1 declarado e BOM UTF-8", () => {
  const latin = Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><AMBIENTE DESCRICAO="Dormitório"/>', "latin1");
  assert.match(decodeXmlBuffer(latin), /Dormitório/);
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("<X>ç</X>", "utf8")]);
  assert.equal(decodeXmlBuffer(bom), "<X>ç</X>");
});

// ============================ Produção ============================

test("setores do código batem com o enum do banco (na mesma ordem)", () => {
  assert.deepEqual([...PRODUCTION_SECTORS].sort(), Object.values(PrismaSector).sort());
  for (const s of PRODUCTION_SECTORS) assert.ok(SECTOR_LABEL[s], `setor sem rótulo: ${s}`);
  assert.deepEqual([...PRODUCTION_STAGES].sort(), Object.values(PrismaStage).sort());
  for (const s of PRODUCTION_STAGES) assert.ok(STAGE_LABEL[s], `etapa sem rótulo: ${s}`);
});

test("fluxo da fábrica: acabamento e limpeza entre pré-montagem e embalagem", () => {
  assert.equal(nextSector("PRE_MONTAGEM"), "ACABAMENTO");
  assert.equal(nextSector("ACABAMENTO"), "LIMPEZA");
  assert.equal(nextSector("LIMPEZA"), "EMBALAGEM");
  assert.equal(nextSector("EXPEDICAO"), null);
  assert.equal(nextSector("SETOR_QUE_NAO_EXISTE"), null);
  assert.equal(nextStage("DELIVERED"), null);
});

test("checklist de saída só libera com tudo conferido e sem pendência", () => {
  const ok = { producaoCompleta: true, materialCompleto: true, ferragens: true, insumos: true, pendencia: false };
  assert.equal(isDispatchReady(ok), true);
  for (const k of ["producaoCompleta", "materialCompleto", "ferragens", "insumos"] as const) {
    assert.equal(isDispatchReady({ ...ok, [k]: false }), false, k);
  }
  assert.equal(isDispatchReady({ ...ok, pendencia: true }), false);
});

// ============================ Montadores ============================

const at = (localIso: string) => new Date(`${localIso}-03:00`);

test("período em horário de Fortaleza inclui o turno das 22h do último dia", () => {
  const { from, to } = localPeriod("2026-09-01", "2026-09-13");
  const turnoNoite = at("2026-09-13T22:00:00"); // 01:00 UTC do dia 14
  const vesperaNoite = at("2026-08-31T21:30:00"); // 00:30 UTC do dia 1º
  assert.ok(turnoNoite >= from && turnoNoite <= to, "turno das 22h ficou fora do período");
  assert.ok(!(vesperaNoite >= from && vesperaNoite <= to), "turno da véspera entrou no período");
});

test("período inválido ou invertido vira 400", () => {
  assert.throws(() => localPeriod("ontem", "2026-09-13"), InvalidQueryError);
  assert.throws(() => localPeriod("2026-09-13", "2026-09-01"), InvalidQueryError);
});

test("período padrão cobre os últimos 30 dias locais", () => {
  const now = new Date("2026-09-14T02:00:00Z"); // 23:00 do dia 13 em Fortaleza
  const { from, to } = localPeriod(undefined, undefined, 30, now);
  assert.equal(localDay(to), "2026-09-13");
  assert.equal(localDay(from), "2026-08-15");
});

test("fechamento: uma diária por dia, diária congelada, turno aberto não soma horas", () => {
  const r = summarizeShifts([
    { contractorId: "m1", contractorName: "Zé", checkInAt: at("2026-09-10T08:00:00"), checkOutAt: at("2026-09-10T12:00:00"), minutes: 240, dailyRate: 180 },
    { contractorId: "m1", contractorName: "Zé", checkInAt: at("2026-09-10T13:00:00"), checkOutAt: at("2026-09-10T17:30:00"), minutes: 270, dailyRate: 180 },
    { contractorId: "m1", contractorName: "Zé", checkInAt: at("2026-09-11T08:00:00"), checkOutAt: at("2026-09-11T17:00:00"), minutes: 540, dailyRate: 200 },
    { contractorId: "m1", contractorName: "Zé", checkInAt: at("2026-09-12T08:00:00"), checkOutAt: null, minutes: null, dailyRate: 200 },
    { contractorId: "m2", contractorName: "Ana", checkInAt: at("2026-09-12T08:00:00"), checkOutAt: at("2026-09-12T10:00:00"), minutes: 120, dailyRate: 150 },
  ]);
  const ze = r.items.find((i) => i.contractorId === "m1")!;
  assert.equal(ze.hours, 17.5);
  assert.equal(ze.days, 3);
  assert.equal(ze.total, 580);
  assert.equal(ze.openShifts, 1);
  assert.equal(r.items[0].contractorId, "m1", "ordenado pelo maior valor");
  assert.deepEqual(r.totals, { contractors: 2, hours: 19.5, days: 4, total: 730, openShifts: 1 });
});

test("fechamento: turno às 22h conta no dia local, não no dia UTC", () => {
  const r = summarizeShifts([
    { contractorId: "m1", contractorName: "Zé", checkInAt: at("2026-09-10T08:00:00"), checkOutAt: null, minutes: 60, dailyRate: 100 },
    { contractorId: "m1", contractorName: "Zé", checkInAt: at("2026-09-10T22:00:00"), checkOutAt: null, minutes: 60, dailyRate: 100 },
  ]);
  assert.equal(r.items[0].days, 1);
});

test("fechamento vazio e diária inválida", () => {
  assert.deepEqual(summarizeShifts([]).totals, { contractors: 0, hours: 0, days: 0, total: 0, openShifts: 0 });
  const r = summarizeShifts([
    { contractorId: "m", contractorName: "X", checkInAt: at("2026-09-10T08:00:00"), checkOutAt: null, minutes: null, dailyRate: Number.NaN },
  ]);
  assert.equal(r.totals.total, 0);
});

test("duração do turno", () => {
  assert.equal(shiftMinutes(at("2026-09-10T08:00:00"), at("2026-09-10T17:30:00")), 570);
  assert.throws(() => shiftMinutes(at("2026-09-10T08:00:00"), at("2026-09-10T08:00:00")), ValidationError);
});

// ============================ Medição ============================

const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("desenho: aceita PNG do canvas", () => {
  const r = decodeDrawingDataUrl(`data:image/png;base64,${PNG_1PX}`);
  assert.equal(r.mimeType, "image/png");
  assert.equal(r.buffer.subarray(1, 4).toString(), "PNG");
});

test("desenho: recusa HTML/SVG disfarçado com 415", () => {
  assert.throws(() => decodeDrawingDataUrl("data:text/html;base64,PHNjcmlwdD4="), UnsupportedFileTypeError);
  assert.throws(() => decodeDrawingDataUrl("data:image/svg+xml;base64,PHN2Zz4="), UnsupportedFileTypeError);
});

test("desenho: formato quebrado ou vazio vira 400", () => {
  assert.throws(() => decodeDrawingDataUrl("nao-e-data-url"), ValidationError);
  assert.throws(() => decodeDrawingDataUrl("data:image/png;base64,"), ValidationError);
});

test("desenho: grande demais vira 413 sem decodificar", () => {
  const huge = "A".repeat(Math.ceil((MAX_DRAWING_BYTES * 4) / 3) + 8);
  assert.throws(() => decodeDrawingDataUrl(`data:image/png;base64,${huge}`), PayloadTooLargeError);
});

test("prazo do projeto técnico: 12 dias corridos após a medição", () => {
  assert.equal(techProjectDueDate(new Date("2026-09-01T10:00:00Z")).toISOString(), "2026-09-13T10:00:00.000Z");
});
