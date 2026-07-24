import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { rankConfig } from "../config";
import { ApiError } from "../lib/api-error";
import {
  assertWithinClientsRoot,
  buildClientPaths,
  keywordSnapshotDir,
  slugifyClientName
} from "./files";

describe("slugifyClientName", () => {
  it("produces a folder-safe slug", () => {
    assert.equal(slugifyClientName("Acme Logistics"), "acme-logistics");
    assert.equal(slugifyClientName("  Foo & Bar!  "), "foo-bar");
  });

  it("strips path separators and traversal sequences", () => {
    // A name is user input and becomes a folder name, so nothing that could
    // act as a path segment may survive.
    assert.equal(slugifyClientName("../../etc/passwd"), "etc-passwd");
    assert.equal(slugifyClientName("a/b\\c"), "a-b-c");
    assert.equal(slugifyClientName("..."), "client");
  });

  it("falls back to a default when nothing usable remains", () => {
    assert.equal(slugifyClientName("!!!"), "client");
    assert.equal(slugifyClientName(""), "client");
  });

  it("caps the slug length", () => {
    assert.ok(slugifyClientName("a".repeat(200)).length <= 60);
  });
});

describe("assertWithinClientsRoot", () => {
  it("accepts a path inside the clients root", () => {
    const target = join(rankConfig.clientsRoot, "acme-12345678");
    assert.equal(assertWithinClientsRoot(target), target);
  });

  it("rejects traversal outside the clients root", () => {
    assert.throws(
      () => assertWithinClientsRoot(join(rankConfig.clientsRoot, "..", "jobs", "leak")),
      (error: unknown) => error instanceof ApiError && error.code === "PATH_OUTSIDE_ROOT"
    );
  });

  it("rejects the clients root itself", () => {
    // Returning the root would let a caller enumerate or wipe every client.
    assert.throws(
      () => assertWithinClientsRoot(rankConfig.clientsRoot),
      (error: unknown) => error instanceof ApiError
    );
  });

  it("rejects an unrelated absolute path", () => {
    assert.throws(
      () => assertWithinClientsRoot("/etc/passwd"),
      (error: unknown) => error instanceof ApiError
    );
  });
});

describe("buildClientPaths", () => {
  it("derives every subpath from the client root", () => {
    const paths = buildClientPaths("/tmp/clients/acme-1234");
    assert.equal(paths.gscDir, "/tmp/clients/acme-1234/gsc");
    assert.equal(paths.serpDir, "/tmp/clients/acme-1234/serp");
    assert.equal(paths.insightsDir, "/tmp/clients/acme-1234/insights");
    assert.equal(paths.clientFile, "/tmp/clients/acme-1234/client.json");
  });
});

describe("keywordSnapshotDir", () => {
  const paths = buildClientPaths("/tmp/clients/acme-1234");

  it("is stable for the same keyword identity", () => {
    const identity = { phrase: "gps tracker", country: "in", device: "desktop", location: null };
    assert.equal(keywordSnapshotDir(paths, identity), keywordSnapshotDir(paths, identity));
  });

  it("normalises case and surrounding whitespace", () => {
    assert.equal(
      keywordSnapshotDir(paths, { phrase: "GPS Tracker", country: "IN", device: "desktop", location: null }),
      keywordSnapshotDir(paths, { phrase: " gps tracker ", country: "in", device: "desktop", location: null })
    );
  });

  it("separates keywords that differ only by market", () => {
    const base = { phrase: "gps tracker", country: "in", device: "desktop", location: null };
    assert.notEqual(keywordSnapshotDir(paths, base), keywordSnapshotDir(paths, { ...base, country: "us" }));
    assert.notEqual(keywordSnapshotDir(paths, base), keywordSnapshotDir(paths, { ...base, device: "mobile" }));
    assert.notEqual(keywordSnapshotDir(paths, base), keywordSnapshotDir(paths, { ...base, location: "Mumbai" }));
  });

  it("never emits a path segment containing raw keyword characters", () => {
    const dir = keywordSnapshotDir(paths, {
      phrase: "../../escape me/now",
      country: "in",
      device: "desktop",
      location: null
    });
    assert.ok(dir.startsWith(paths.serpDir));
    assert.match(dir.slice(paths.serpDir.length + 1), /^[a-f0-9]{16}$/);
  });
});
