---
name: outline-generation
version: 1
description: Generate a full article outline from the approved brief and semantic map.
inputs:
  - article_brief
  - semantic_map
---

You are generating the outline step for a semantic SEO article workflow.

Follow these rules:

{{CONTENT_QUALITY_RULES}}

{{SEMANTIC_SEO_RULES}}

Additional outline rules:

- Keep the section order logical for a reader who starts with a question and ends with action or evaluation.
- Avoid duplicate H2 ideas phrased in slightly different ways.
- Make the Macro section foundational and the Micro section situational, comparative, or product-aware.
- Keep FAQ questions distinct from the main H2s.
- Convert H2s into question format wherever possible.
- Remove any traditional introduction section. Use only a one-line intro angle and key takeaways.
- The first key takeaway must fully answer the main query.
- Assign a structure type to each H2: three-paragraph explanation, bullets, H3 subsections, or table.
- Do not assign the same structure type to too many consecutive H2s.
- Add H3 layering where needed for core components and benefits. H3s must represent single entities or components.
- For every non-FAQ H3 planned in the outline, note that the final article should use exactly 2 short paragraphs below it: paragraph 1 defines or clarifies the H3 entity, paragraph 2 explains the data, function, impact, or decision it enables.
- For FAQ H3s, plan one concise answer paragraph of 1 to 2 sentences.
- Add a sentence-start warning to the section structure plan: final prose should not begin sentences with "the", "a", "that", or "those".
- Build a dynamic outline for this article. Do not mirror the exact H2 sequence, H3 density, bullet-heavy sections, or table placement from recent articles unless the search intent requires it.
- Vary the rhythm across sections. Avoid repeating the same intro sentence pattern, paragraph count, bullet count, H3 count, or "X means..." definition pattern across the article.
- Include a buying guide or decision framework with 5 to 6 criteria.
- Include KPI-driven decision support when the topic involves evaluation, operations, or business impact.
- Include evidence or verification notes for any stats, benchmarks, ranges, or trend claims.

Return Markdown only using this structure:

# Article Outline

## Working Title

## Suggested Meta Description

## Key Takeaways

## One-Line Introduction

## Macro Section

## Micro Section

## KPI Decision Support

## Buying Guide / Decision Framework

## Product or Brand Integration

## FAQs

## Final Thoughts

## Section Structure Plan

## Verification Notes

Article brief:

{{ARTICLE_BRIEF}}

Semantic map:

{{SEMANTIC_MAP}}

Recent structure patterns:

{{RECENT_STRUCTURE_PATTERNS}}
