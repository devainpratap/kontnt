---
name: article-draft
version: 1
description: Draft the full article from the approved outline and semantic map.
inputs:
  - article_brief
  - semantic_map
  - approved_outline
---

You are generating the full article draft for a semantic SEO workflow.

Follow these rules:

{{CONTENT_QUALITY_RULES}}

{{SEMANTIC_SEO_RULES}}

Additional drafting rules:

- Respect the approved outline as the contract for the article structure.
- If the approved outline is for a comparison article, preserve the logical order: define both entities independently, explain responsibilities or core features, then compare, then address legal/compliance or decision guidance, then FAQs and final thoughts.
- Before drafting each H2, identify its single dominant purpose: definition, responsibilities, process, comparison, legal/compliance clarification, decision guidance, red flags, metrics/KPIs, FAQs, or conclusion.
- Do not blend multiple purposes inside one H2. For example, a responsibilities section should not also carry legal authority guidance and a comparison table.
- Each section should answer its heading directly before expanding into examples or nuance.
- Use transitions that help the article feel continuous rather than stitched together, but avoid repeated transition formulas.
- When a claim may depend on the product, market, or pricing context, state the uncertainty instead of inventing specifics.
- Do not write a traditional introduction. Start with one direct line, then 3 to 5 key takeaways.
- The first key takeaway must fully answer the title query.
- Use question-based H2s wherever the approved outline allows it.
- Choose the best structure for each H2 rather than repeating the same pattern.
- Do not let repeated entities dominate sentence openings. Within each H2 or H3, avoid starting more than two nearby sentences with the same entity, noun, pronoun, or phrase.
- Do not repeatedly start sentences with the H2 keyword, role name, comparison term, or the same grammar pattern such as "X is", "X helps", "X should", or "X can".
- Vary sentence openings by starting with decision context, condition, outcome, contrast, or the operational object when the topic entity would otherwise repeat.
- For explanatory H2s, use the three-paragraph logic when natural: direct answer, mechanism, implication or transition.
- For benefits, features, signs, steps, and mistakes, use one short lead sentence followed by structured bullets.
- For multi-component sections, use H3s. Each non-FAQ H3 must have exactly 2 short paragraphs below it: paragraph 1 defines or clarifies the entity, component, or idea; paragraph 2 explains its data output, function, operational impact, or decision value.
- For FAQ H3s, answer directly in one concise paragraph of 1 to 2 sentences.
- Use tables only when they make comparison or breakdown easier to understand.
- Add micro-transitions at the end of major H2s, but vary the wording and keep them useful.
- Include a buying guide with 5 to 6 criteria when the outline calls for decision support.
- Include a KPI section when the topic has operational, financial, performance, or evaluation intent. Define each KPI and explain why it matters.
- Connect major entities through cause and effect rather than naming them separately.
- Avoid generic claims. Replace broad statements with specific mechanisms.
- Avoid em dashes and obvious AI phrases.
- Before returning the draft, audit sentence openings and rewrite every sentence that begins with "the", "a", "that", or "those".
- Before returning the draft, scan every section for repeated first 1 to 3 words, repeated role/entity starts, repeated H2 keyword starts, and repeated subject-plus-verb openings. Rewrite nearby repeats instead of swapping in random synonyms.
- Do not add standalone transition paragraphs after an H3 before the next H2. Place the transition inside the second H3 paragraph or before the H3 list begins.

Return Markdown only.

Use this structure:

# [Final Article Title]

## Key Takeaways

[article body]

## FAQs

## Final Thoughts

Article brief:

{{ARTICLE_BRIEF}}

Semantic map:

{{SEMANTIC_MAP}}

Approved outline:

{{APPROVED_OUTLINE}}
