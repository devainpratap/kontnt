import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { describe, it } from "node:test";

// A fixed test key so the suite never depends on the developer's real .env.
process.env.GOOGLE_TOKEN_KEY = "a".repeat(64);

const { createStateToken, decryptToken, encryptToken, hasTokenKey, safeEqual } = await import("./token-crypto");

const SAMPLE = "1//0gTestRefreshToken_ABCdef-1234567890";

describe("encryptToken / decryptToken", () => {
  it("round-trips a token", () => {
    assert.equal(decryptToken(encryptToken(SAMPLE)), SAMPLE);
  });

  it("never stores the plaintext in the payload", () => {
    const payload = encryptToken(SAMPLE);
    assert.equal(payload.includes(SAMPLE), false);
    assert.equal(payload.includes("RefreshToken"), false);
  });

  it("produces a different ciphertext each time", () => {
    // A fresh random IV per encryption; identical output would leak that two
    // rows hold the same token.
    assert.notEqual(encryptToken(SAMPLE), encryptToken(SAMPLE));
  });

  it("round-trips unicode and long values", () => {
    const unicode = "токен-测试-🔑";
    assert.equal(decryptToken(encryptToken(unicode)), unicode);
    const long = "x".repeat(5000);
    assert.equal(decryptToken(encryptToken(long)), long);
  });

  it("carries a version prefix", () => {
    assert.match(encryptToken(SAMPLE), /^v1\./);
  });

  it("refuses to encrypt an empty token", () => {
    assert.throws(() => encryptToken(""), /empty token/i);
  });
});

describe("decryptToken rejection paths", () => {
  it("rejects a tampered ciphertext rather than returning garbage", () => {
    const parts = encryptToken(SAMPLE).split(".");
    const tampered = Buffer.from(parts[3], "base64url");
    tampered[0] ^= 0xff;
    parts[3] = tampered.toString("base64url");

    assert.throws(() => decryptToken(parts.join(".")), /reconnect google/i);
  });

  it("rejects a tampered auth tag", () => {
    const parts = encryptToken(SAMPLE).split(".");
    const tag = Buffer.from(parts[2], "base64url");
    tag[0] ^= 0xff;
    parts[2] = tag.toString("base64url");

    assert.throws(() => decryptToken(parts.join(".")), /reconnect google/i);
  });

  it("rejects a malformed payload", () => {
    assert.throws(() => decryptToken("not-a-token"), /malformed/i);
    assert.throws(() => decryptToken("v1.only.three"), /malformed/i);
    assert.throws(() => decryptToken(""), /malformed/i);
  });

  it("rejects an unknown version prefix", () => {
    const parts = encryptToken(SAMPLE).split(".");
    parts[0] = "v2";
    assert.throws(() => decryptToken(parts.join(".")), /malformed/i);
  });

  it("rejects a wrong-length IV", () => {
    const parts = encryptToken(SAMPLE).split(".");
    parts[1] = Buffer.alloc(8).toString("base64url");
    assert.throws(() => decryptToken(parts.join(".")), /malformed/i);
  });
});

describe("key validation", () => {
  it("reports a usable key", () => {
    assert.equal(hasTokenKey(), true);
  });

  it("fails loudly on a payload encrypted under a different key", () => {
    // This is the operator rotating GOOGLE_TOKEN_KEY after having connected:
    // the stored ciphertext is well-formed but no longer decryptable. It must
    // raise "reconnect", not silently read as "never connected".
    const foreignKey = Buffer.alloc(32, 0xbb);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", foreignKey, iv);
    const ciphertext = Buffer.concat([cipher.update(SAMPLE, "utf8"), cipher.final()]);

    const payload = [
      "v1",
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url")
    ].join(".");

    assert.throws(() => decryptToken(payload), /GOOGLE_TOKEN_KEY changed|could not decrypt/i);
  });
});

describe("safeEqual", () => {
  it("matches identical values", () => {
    assert.equal(safeEqual("abc123", "abc123"), true);
  });

  it("rejects different values and differing lengths", () => {
    assert.equal(safeEqual("abc123", "abc124"), false);
    assert.equal(safeEqual("abc", "abc123"), false);
    assert.equal(safeEqual("", "x"), false);
  });
});

describe("createStateToken", () => {
  it("produces a unique, URL-safe token each call", () => {
    const a = createStateToken();
    const b = createStateToken();
    assert.notEqual(a, b);
    assert.match(a, /^[A-Za-z0-9_-]+$/);
    assert.ok(a.length >= 32);
  });
});
