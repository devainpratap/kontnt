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
- Each section should answer its heading directly before expanding into examples or nuance.
- Use transitions that help the article feel continuous rather than stitched together, but avoid repeated transition formulas.
- When a claim may depend on the product, market, or pricing context, state the uncertainty instead of inventing specifics.
- Do not write a traditional introduction. Start with one direct line, then 3 to 5 key takeaways.
- The first key takeaway must fully answer the title query.
- Use question-based H2s wherever the approved outline allows it.
- Choose the best structure for each H2 rather than repeating the same pattern.
- For explanatory H2s, use the three-paragraph logic when natural: direct answer, mechanism, implication or transition.
- For benefits, features, signs, steps, and mistakes, use one short lead sentence followed by structured bullets.
- For multi-component sections, use H3s. Each H3 must have exactly 2 short paragraphs below it: paragraph 1 defines or clarifies the entity, component, or idea; paragraph 2 explains its data output, function, operational impact, or decision value.
- Use tables only when they make comparison or breakdown easier to understand.
- Add micro-transitions at the end of major H2s, but vary the wording and keep them useful.
- Include a buying guide with 5 to 6 criteria when the outline calls for decision support.
- Include a KPI section when the topic has operational, financial, performance, or evaluation intent. Define each KPI and explain why it matters.
- Connect major entities through cause and effect rather than naming them separately.
- Avoid generic claims. Replace broad statements with specific mechanisms.
- Avoid em dashes and obvious AI phrases.
- Before returning the draft, audit sentence openings and rewrite every sentence that begins with "the", "a", "that", or "those".
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
