import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { countryDefaultLocation, detectPlaceInPhrase, resolveKeywordLocation } from "./location";

describe("detectPlaceInPhrase", () => {
  it("finds a city named in the phrase, with or without a preposition", () => {
    assert.equal(detectPlaceInPhrase("digital marketing agency noida"), "Noida,Uttar Pradesh,India");
    assert.equal(detectPlaceInPhrase("digital marketing agency in noida"), "Noida,Uttar Pradesh,India");
    assert.equal(detectPlaceInPhrase("ppc agency gurgaon"), "Gurugram,Haryana,India");
  });

  it("prefers the more specific multi-word place", () => {
    assert.equal(detectPlaceInPhrase("seo services greater noida"), "Greater Noida,Uttar Pradesh,India");
    assert.equal(detectPlaceInPhrase("marketing new delhi"), "New Delhi,Delhi,India");
    assert.equal(detectPlaceInPhrase("marketing navi mumbai"), "Navi Mumbai,Maharashtra,India");
  });

  it("is case-insensitive", () => {
    assert.equal(detectPlaceInPhrase("Best Digital Marketing In NOIDA"), "Noida,Uttar Pradesh,India");
  });

  it("returns null when the phrase names no place", () => {
    assert.equal(detectPlaceInPhrase("educational marketing agency"), null);
    assert.equal(detectPlaceInPhrase("higher education seo"), null);
  });

  it("matches on word boundaries only (no substring false positives)", () => {
    assert.equal(detectPlaceInPhrase("puneet marketing services"), null); // not "pune"
    assert.equal(detectPlaceInPhrase("noidaville agency"), null); // not "noida"
  });
});

describe("countryDefaultLocation", () => {
  it("maps a country to its country-level location", () => {
    assert.equal(countryDefaultLocation("in"), "India");
    assert.equal(countryDefaultLocation("US"), "United States");
  });

  it("returns null for an unmapped country rather than guessing", () => {
    assert.equal(countryDefaultLocation("zz"), null);
  });
});

describe("resolveKeywordLocation", () => {
  it("uses the local city for a place keyword", () => {
    assert.equal(resolveKeywordLocation("digital marketing agency noida", "in"), "Noida,Uttar Pradesh,India");
  });

  it("uses the whole country for a non-place keyword", () => {
    assert.equal(resolveKeywordLocation("educational marketing agency", "in"), "India");
  });

  it("always respects an explicit user-set location", () => {
    // Even though the phrase names Noida, a hand-set location wins.
    assert.equal(
      resolveKeywordLocation("digital marketing agency noida", "in", "Mumbai,Maharashtra,India"),
      "Mumbai,Maharashtra,India"
    );
  });

  it("ignores a blank explicit value and falls through to detection", () => {
    assert.equal(resolveKeywordLocation("digital marketing agency noida", "in", "  "), "Noida,Uttar Pradesh,India");
    assert.equal(resolveKeywordLocation("educational marketing agency", "in", ""), "India");
  });

  it("returns null when nothing applies (unmapped country, no place, no override)", () => {
    assert.equal(resolveKeywordLocation("generic phrase", "zz"), null);
  });

  it("uses the client market for a non-place keyword instead of the country", () => {
    // The key fix: a national keyword tracks from the client's real market, not
    // a misleading country-level vantage.
    assert.equal(
      resolveKeywordLocation("educational marketing agency", "in", null, "Noida,Uttar Pradesh,India"),
      "Noida,Uttar Pradesh,India"
    );
  });

  it("still prefers a place named in the phrase over the client market", () => {
    assert.equal(
      resolveKeywordLocation("seo services mumbai", "in", null, "Noida,Uttar Pradesh,India"),
      "Mumbai,Maharashtra,India"
    );
  });

  it("still lets an explicit override beat the client market", () => {
    assert.equal(
      resolveKeywordLocation("educational marketing agency", "in", "Delhi,India", "Noida,Uttar Pradesh,India"),
      "Delhi,India"
    );
  });

  it("falls back to the country when there is no client market", () => {
    assert.equal(resolveKeywordLocation("educational marketing agency", "in", null, null), "India");
  });
});
