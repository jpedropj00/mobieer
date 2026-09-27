/**
 * Notas da contabilidade: leitura de NF-e, NFS-e (ABRASF e nacional) e do
 * evento de cancelamento, só para registro.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { invoiceDirection, parseInvoiceXml } from "../src/modules/fiscal/fiscal.xml";

const KEY = "23260912345678000199550010000012341000012345";
const nfe = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe><infNFe Id="NFe${KEY}" versao="4.00">
    <ide><cUF>23</cUF><serie>1</serie><nNF>1234</nNF><dhEmi>2026-09-10T14:32:00-03:00</dhEmi></ide>
    <emit><CNPJ>12345678000199</CNPJ><xNome>MOBIEER MOVEIS LTDA</xNome></emit>
    <dest><CPF>12345678909</CPF><xNome>Juliana Costa &amp; Filhos</xNome></dest>
    <det nItem="1"><prod><xProd>Cozinha planejada</xProd></prod></det>
    <det nItem="2"><prod><xProd>Guarda-roupa casal</xProd></prod></det>
    <total><ICMSTot><vProd>45000.00</vProd><vNF>45000.00</vNF></ICMSTot></total>
  </infNFe></NFe>
  <protNFe><infProt><chNFe>${KEY}</chNFe><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>
</nfeProc>`;

test("NF-e autorizada: número, série, chave, data, valor, emitente e destinatário", () => {
  const r = parseInvoiceXml(nfe);
  assert.equal(r.type, "INVOICE");
  if (r.type !== "INVOICE") return;
  const i = r.invoice;
  assert.equal(i.kind, "NFE");
  assert.equal(i.number, "1234");
  assert.equal(i.series, "1");
  assert.equal(i.accessKey, KEY);
  assert.equal(i.issuedAt, "2026-09-10T17:32:00.000Z");
  assert.equal(i.amount, 45000);
  assert.deepEqual(i.issuer, { name: "MOBIEER MOVEIS LTDA", document: "12345678000199" });
  assert.deepEqual(i.recipient, { name: "Juliana Costa & Filhos", document: "12345678909" });
  assert.equal(i.description, "Cozinha planejada; Guarda-roupa casal");
  assert.deepEqual(r.warnings, []);
});

test("NF-e com prefixo de namespace e sem protocolo avisa que pode não estar autorizada", () => {
  const semProt = nfe.replace(/<protNFe>[\s\S]*<\/protNFe>/, "").replace(/<(\/?)(\w)/g, "<$1ns2:$2").replace("<?ns2:xml", "<?xml");
  const r = parseInvoiceXml(semProt);
  assert.equal(r.type, "INVOICE");
  if (r.type !== "INVOICE") return;
  assert.equal(r.invoice.accessKey, KEY); // veio do Id do infNFe
  assert.equal(r.invoice.number, "1234");
  assert.match(r.warnings[0], /sem protocolo/);
});

test("evento de cancelamento da NF-e", () => {
  const ev = `<procEventoNFe><evento><infEvento><chNFe>${KEY}</chNFe><dhEvento>2026-09-12T09:00:00-03:00</dhEvento><tpEvento>110111</tpEvento>
    <detEvento><descEvento>Cancelamento</descEvento><xJust>Erro no valor da nota</xJust></detEvento></infEvento></evento></procEventoNFe>`;
  const r = parseInvoiceXml(ev);
  assert.deepEqual(r, { type: "CANCELLATION", accessKey: KEY, at: "2026-09-12T12:00:00.000Z", reason: "Erro no valor da nota" });
});

test("NFS-e ABRASF: prestador, tomador, valor líquido e discriminação", () => {
  const x = `<CompNfse><Nfse><InfNfse><Numero>987</Numero><CodigoVerificacao>AB12CD</CodigoVerificacao><DataEmissao>2026-09-15T10:00:00</DataEmissao>
    <IdentificacaoRps><Numero>55</Numero><Serie>A</Serie></IdentificacaoRps>
    <Servico><Valores><ValorServicos>3000,00</ValorServicos><ValorLiquidoNfse>2850,00</ValorLiquidoNfse></Valores><Discriminacao>Montagem de móveis</Discriminacao></Servico>
    <PrestadorServico><IdentificacaoPrestador><Cnpj>12.345.678/0001-99</Cnpj></IdentificacaoPrestador><RazaoSocial>MOBIEER MOVEIS LTDA</RazaoSocial></PrestadorServico>
    <TomadorServico><IdentificacaoTomador><CpfCnpj><Cpf>123.456.789-09</Cpf></CpfCnpj></IdentificacaoTomador><RazaoSocial>Juliana Costa</RazaoSocial></TomadorServico>
  </InfNfse></Nfse></CompNfse>`;
  const r = parseInvoiceXml(x);
  assert.equal(r.type, "INVOICE");
  if (r.type !== "INVOICE") return;
  assert.equal(r.invoice.kind, "NFSE");
  assert.equal(r.invoice.number, "987");
  assert.equal(r.invoice.series, "A");
  assert.equal(r.invoice.accessKey, "AB12CD");
  assert.equal(r.invoice.amount, 2850);
  assert.deepEqual(r.invoice.issuer, { name: "MOBIEER MOVEIS LTDA", document: "12345678000199" });
  assert.deepEqual(r.invoice.recipient, { name: "Juliana Costa", document: "12345678909" });
  assert.equal(r.invoice.description, "Montagem de móveis");
});

test("NFS-e padrão nacional", () => {
  const chave = "2304400212345678000199000000000001226091234567890";
  const x = `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS${chave}0"><nNFSe>12</nNFSe><dhProc>2026-09-20T08:00:00-03:00</dhProc>
    <emit><CNPJ>12345678000199</CNPJ><xNome>MOBIEER MOVEIS LTDA</xNome></emit><valores><vLiq>1500.00</vLiq></valores>
    <DPS><infDPS><serie>900</serie><dhEmi>2026-09-20T07:59:00-03:00</dhEmi><toma><CNPJ>99888777000166</CNPJ><xNome>Construtora X</xNome></toma>
    <serv><cServ><xDescServ>Projeto de interiores</xDescServ></cServ></serv><valores><vServPrest><vServ>1500.00</vServ></vServPrest></valores></infDPS></DPS></infNFSe></NFSe>`;
  const r = parseInvoiceXml(x);
  assert.equal(r.type, "INVOICE");
  if (r.type !== "INVOICE") return;
  assert.equal(r.invoice.number, "12");
  assert.equal(r.invoice.series, "900");
  assert.equal(r.invoice.accessKey, `${chave}0`);
  assert.equal(r.invoice.amount, 1500);
  assert.equal(r.invoice.recipient.name, "Construtora X");
  assert.equal(r.invoice.description, "Projeto de interiores");
});

test("arquivo que não é nota; direção pelo CNPJ da empresa", () => {
  assert.equal(parseInvoiceXml("<planilha><linha/></planilha>").type, "UNKNOWN");
  const r = parseInvoiceXml(nfe);
  if (r.type !== "INVOICE") throw new Error("esperava nota");
  assert.equal(invoiceDirection(r.invoice, "12.345.678/0001-99"), "SAIDA");
  assert.equal(invoiceDirection(r.invoice, "12345678909"), "ENTRADA");
  assert.equal(invoiceDirection(r.invoice, null), null);
  assert.equal(invoiceDirection(r.invoice, "00000000000000"), null);
});
