import { describe, expect, it } from "vitest";

import { toFormValues, toIntakePayload, type IntakeFormValues } from "./intake";

const baseForm: IntakeFormValues = {
  title: "  Semantic SEO guide  ",
  targetKeyword: " semantic seo ",
  intendedAudience: " content teams ",
  searchIntent: " informational ",
  topRankingUrls: "https://a.com\nhttps://b.com",
  competitorNotes: " some notes ",
  mainEntities: "entity one\nentity two\n\n",
  secondaryEntities: "sub one",
  brandContext: " Adclear ",
  attributes: "fast\nreliable",
  anchorKeywords: "seo\ntopical maps",
  tone: " expert ",
  targetWordCount: 2200,
  internalLinks: "https://a.com/x",
  preferredCtas: "Book a demo\nStart free"
};

describe("toIntakePayload (issue #12 advanced fields)", () => {
  it("persists every advanced field, trimming strings and splitting arrays by line", () => {
    const payload = toIntakePayload(baseForm);

    expect(payload.title).toBe("Semantic SEO guide");
    expect(payload.intendedAudience).toBe("content teams");
    expect(payload.searchIntent).toBe("informational");
    expect(payload.competitorNotes).toBe("some notes");
    expect(payload.brandContext).toBe("Adclear");
    expect(payload.tone).toBe("expert");

    expect(payload.mainEntities).toEqual(["entity one", "entity two"]);
    expect(payload.secondaryEntities).toEqual(["sub one"]);
    expect(payload.attributes).toEqual(["fast", "reliable"]);
    expect(payload.anchorKeywords).toEqual(["seo", "topical maps"]);
    expect(payload.internalLinks).toEqual(["https://a.com/x"]);
    expect(payload.preferredCtas).toEqual(["Book a demo", "Start free"]);
    expect(payload.topRankingUrls).toEqual(["https://a.com", "https://b.com"]);
  });

  it("coerces targetWordCount to a number and falls back to 1800 when empty", () => {
    expect(toIntakePayload(baseForm).targetWordCount).toBe(2200);
    expect(toIntakePayload({ ...baseForm, targetWordCount: Number.NaN }).targetWordCount).toBe(1800);
  });

  it("round-trips advanced fields through toFormValues", () => {
    const payload = toIntakePayload(baseForm);
    const form = toFormValues(payload);
    expect(form.intendedAudience).toBe("content teams");
    expect(form.mainEntities).toBe("entity one\nentity two");
    expect(form.targetWordCount).toBe(2200);
  });
});
