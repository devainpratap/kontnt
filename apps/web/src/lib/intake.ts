import type { ArticleIntake } from "@semantic-seo/shared";

export type IntakeFormValues = {
  title: string;
  targetKeyword: string;
  intendedAudience: string;
  searchIntent: string;
  topRankingUrls: string;
  competitorNotes: string;
  mainEntities: string;
  secondaryEntities: string;
  brandContext: string;
  attributes: string;
  anchorKeywords: string;
  tone: string;
  targetWordCount: number;
  internalLinks: string;
  preferredCtas: string;
};

function joinLines(values: string[]) {
  return values.join("\n");
}

function splitLines(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function splitUrlInput(value: string) {
  return value
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function toFormValues(intake: ArticleIntake | null): IntakeFormValues {
  return {
    title: intake?.title ?? "",
    targetKeyword: intake?.targetKeyword ?? "",
    intendedAudience: intake?.intendedAudience ?? "",
    searchIntent: intake?.searchIntent ?? "",
    topRankingUrls: joinLines(intake?.topRankingUrls ?? []),
    competitorNotes: intake?.competitorNotes ?? "",
    mainEntities: joinLines(intake?.mainEntities ?? []),
    secondaryEntities: joinLines(intake?.secondaryEntities ?? []),
    brandContext: intake?.brandContext ?? "",
    attributes: joinLines(intake?.attributes ?? []),
    anchorKeywords: joinLines(intake?.anchorKeywords ?? []),
    tone: intake?.tone ?? "clear, expert, practical",
    targetWordCount: intake?.targetWordCount ?? 1800,
    internalLinks: joinLines(intake?.internalLinks ?? []),
    preferredCtas: joinLines(intake?.preferredCtas ?? [])
  };
}

export function toIntakePayload(values: IntakeFormValues): ArticleIntake {
  return {
    title: values.title.trim(),
    targetKeyword: values.targetKeyword.trim(),
    intendedAudience: values.intendedAudience.trim(),
    searchIntent: values.searchIntent.trim(),
    topRankingUrls: splitUrlInput(values.topRankingUrls),
    competitorNotes: values.competitorNotes.trim(),
    mainEntities: splitLines(values.mainEntities),
    secondaryEntities: splitLines(values.secondaryEntities),
    brandContext: values.brandContext.trim(),
    attributes: splitLines(values.attributes),
    anchorKeywords: splitLines(values.anchorKeywords),
    tone: values.tone.trim(),
    targetWordCount: Number(values.targetWordCount) || 1800,
    internalLinks: splitLines(values.internalLinks),
    preferredCtas: splitLines(values.preferredCtas)
  };
}
