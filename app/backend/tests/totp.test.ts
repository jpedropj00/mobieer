/**
 * Verificação em duas etapas: TOTP conferido contra os vetores da RFC 6238,
 * tolerância de relógio, códigos de recuperação e o segredo cifrado.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { base32Decode, base32Encode, consumeRecoveryCode, generateRecoveryCodes, generateSecret, hashRecoveryCode, openSecret, otpauthUrl, sealSecret, totp, verifyTotp } from "../src/lib/totp.rules";

// segredo dos vetores da RFC: "12345678901234567890"
const RFC = base32Encode(Buffer.from("12345678901234567890"));

test("base32 vai e volta, com ou sem espaços e minúsculas", () => {
  assert.equal(RFC, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.equal(base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq").toString(), "12345678901234567890");
  assert.equal(base32Decode(generateSecret()).length, 20);
  assert.throws(() => base32Decode("1!"));
});

test("códigos batem com os vetores da RFC 6238 (SHA-1, 6 dígitos)", () => {
  assert.equal(totp(RFC, 59_000), "287082");
  assert.equal(totp(RFC, 1111111109_000), "081804");
  assert.equal(totp(RFC, 1234567890_000), "005924");
  assert.equal(totp(RFC, 2000000000_000), "279037");
});

test("aceita um passo antes e um depois, e recusa fora disso ou em formato errado", () => {
  const t = 1234567890_000;
  assert.equal(verifyTotp(RFC, "005924", t), true);
  assert.equal(verifyTotp(RFC, "005 924", t), true);
  assert.equal(verifyTotp(RFC, "005924", t + 30_000), true); // celular 30 s atrasado
  assert.equal(verifyTotp(RFC, "005924", t - 30_000), true);
  assert.equal(verifyTotp(RFC, "005924", t + 90_000), false);
  assert.equal(verifyTotp(RFC, "000000", t), false);
  assert.equal(verifyTotp(RFC, "5924", t), false);
  assert.equal(verifyTotp(RFC, "abcdef", t), false);
});

test("endereço do QR Code traz conta, emissor e parâmetros", () => {
  const u = otpauthUrl(RFC, "ana@mobieer.com.br");
  assert.match(u, /^otpauth:\/\/totp\/Mobieer%3Aana%40mobieer\.com\.br\?secret=GEZD/);
  assert.match(u, /issuer=Mobieer&algorithm=SHA1&digits=6&period=30$/);
});

test("códigos de recuperação: únicos, uso único e só o hash é guardado", () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  assert.match(codes[0], /^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
  const hashes = codes.map(hashRecoveryCode);
  assert.ok(!hashes.includes(codes[0]));
  const left = consumeRecoveryCode(hashes, codes[3].toLowerCase().replace("-", " "));
  assert.equal(left?.length, 9);
  assert.equal(consumeRecoveryCode(left!, codes[3]), null); // já usado
  assert.equal(consumeRecoveryCode(hashes, "AAAAA-AAAAA"), null);
  assert.equal(consumeRecoveryCode(hashes, "123456"), null); // código do autenticador não é de recuperação
});

test("segredo fica cifrado no banco e só abre com a mesma chave", () => {
  const sealed = sealSecret(RFC, "chave-do-servidor");
  assert.ok(!sealed.includes(RFC));
  assert.notEqual(sealed, sealSecret(RFC, "chave-do-servidor")); // IV novo a cada vez
  assert.equal(openSecret(sealed, "chave-do-servidor"), RFC);
  assert.throws(() => openSecret(sealed, "outra-chave"));
  assert.throws(() => openSecret("lixo", "chave-do-servidor"));
});
