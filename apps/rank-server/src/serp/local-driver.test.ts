import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { encodeCanonicalLocation } from "./local-driver";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

describe("encodeCanonicalLocation (Google uule)", () => {
  it("uses the fixed prefix and base64-encodes the canonical name", () => {
    const uule = encodeCanonicalLocation("India");
    assert.ok(uule.startsWith("w+CAIQICI"), "has the canonical-name prefix");
    assert.ok(uule.endsWith(Buffer.from("India").toString("base64")), "ends with the base64 name");
  });

  it("encodes the length character against the 64-char alphabet by name length", () => {
    // "India" is 5 chars -> alphabet[5] = "F". The old bug produced lowercase "f".
    assert.equal(
      encodeCanonicalLocation("India"),
      `w+CAIQICI${ALPHABET[5]}${Buffer.from("India").toString("base64")}`
    );
    // 25 chars -> "Z"; the old bug (26-letter alphabet, % 26) produced "z".
    const noida = "Noida,Uttar Pradesh,India";
    assert.equal(noida.length, 25);
    assert.equal(ALPHABET[25], "Z");
    assert.equal(
      encodeCanonicalLocation(noida),
      `w+CAIQICI${ALPHABET[25]}${Buffer.from(noida).toString("base64")}`
    );
  });

  it("round-trips: the base64 payload decodes back to the name", () => {
    const name = "Gurugram,Haryana,India";
    const uule = encodeCanonicalLocation(name);
    const b64 = uule.slice("w+CAIQICI".length + 1); // drop prefix + length char
    assert.equal(Buffer.from(b64, "base64").toString("utf8"), name);
  });
});
