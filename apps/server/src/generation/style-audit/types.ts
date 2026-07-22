export type ArticleStyleIssue = {
  code:
    | "forbidden-sentence-start"
    | "repeated-section-opener"
    | "repeated-topic-opener"
    | "repeated-sentence-pattern"
    | "h3-sentence-count"
    | "repeated-bullet-opener"
    | "bullet-format"
    | "banned-phrase"
    | "bridge-sentence"
    | "long-sentence"
    | "table-editorial-column"
    | "pre-h2-content"
    | "pitch-structure"
    | "pitch-pricing-flexibility"
    | "repeated-caveat"
    | "h2-opening-pattern"
    | "section-opening-closing-mirror"
    | "h2-heading-echo-density"
    | "h3-sibling-opener-repetition"
    | "h3-echo-density"
    | "repeated-section-shape"
    | "repeated-section-count-pattern"
    | "repeated-abstract-phrase"
    | "missing-h1-title"
    | "semantic-glue-overuse"
    | "filler-language-overuse";
  section: string;
  message: string;
  evidence: string[];
};

export type ArticleStyleAudit = {
  issues: ArticleStyleIssue[];
  sentenceCount: number;
  h3Count: number;
};

export type Section = {
  level: number;
  heading: string;
  body: string;
};

export type H2Section = {
  heading: string;
  body: string;
};

export type H3Block = {
  heading: string;
  parentHeading: string;
  sentenceCount: number;
  sentences: string[];
};
