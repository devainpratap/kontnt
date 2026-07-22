import assert from "node:assert/strict";
import { test } from "node:test";

import { assertPublicUrl, isPublicUrl } from "./extraction/article-extractor";

// IP literals are validated without a DNS lookup, so these cases are hermetic
// (no network required).

test("public IP URLs are allowed", async () => {
  assert.equal(await isPublicUrl("https://8.8.8.8/"), true);
  assert.equal(await isPublicUrl("http://1.1.1.1/path"), true);
  await assert.doesNotReject(assertPublicUrl("https://8.8.8.8/"));
});

test("loopback and localhost are blocked", async () => {
  assert.equal(await isPublicUrl("http://localhost/"), false);
  assert.equal(await isPublicUrl("http://localhost:3001/api"), false);
  assert.equal(await isPublicUrl("http://127.0.0.1/"), false);
  assert.equal(await isPublicUrl("http://[::1]/"), false);
});

test("cloud metadata and link-local addresses are blocked", async () => {
  assert.equal(await isPublicUrl("http://169.254.169.254/latest/meta-data/"), false);
  assert.equal(await isPublicUrl("http://169.254.1.1/"), false);
});

test("private RFC1918 ranges are blocked", async () => {
  assert.equal(await isPublicUrl("http://10.0.0.1/"), false);
  assert.equal(await isPublicUrl("http://10.255.255.255/"), false);
  assert.equal(await isPublicUrl("http://172.16.0.1/"), false);
  assert.equal(await isPublicUrl("http://172.31.255.1/"), false);
  assert.equal(await isPublicUrl("http://192.168.1.1/"), false);
});

test("unspecified address is blocked", async () => {
  assert.equal(await isPublicUrl("http://0.0.0.0/"), false);
});

test("non-http(s) schemes are blocked", async () => {
  assert.equal(await isPublicUrl("file:///etc/passwd"), false);
  assert.equal(await isPublicUrl("ftp://example.com/"), false);
  assert.equal(await isPublicUrl("gopher://127.0.0.1/"), false);
});

test(".local and *.localhost hostnames are blocked", async () => {
  assert.equal(await isPublicUrl("http://printer.local/"), false);
  assert.equal(await isPublicUrl("http://api.localhost/"), false);
});

test("assertPublicUrl rejects with a clear message", async () => {
  await assert.rejects(assertPublicUrl("http://127.0.0.1/"), /Blocked non-public URL/);
});
