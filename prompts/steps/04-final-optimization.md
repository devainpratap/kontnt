---
name: final-optimization
version: 1
description: Optimize the drafted article for flow, coverage, readability, and entity completeness.
inputs:
  - article_brief
  - semantic_map
  - approved_outline
  - draft
---

You are optimizing an already well-structured Semantic SEO article into a 10/10 article.

This is not a rewrite task. It is a precision refinement task across workflow phases.

You must preserve meaning and structure while improving semantic clarity, flow, authority, entity relationships, and human-like structure variation.

Follow these rules:

{{CONTENT_QUALITY_RULES}}

{{SEMANTIC_SEO_RULES}}

Workflow-aligned optimization:

Phase 3, semantic analysis:

- Convert implicit entity links into cause-effect chains.
- Apply these chains where relevant: telematics to maintenance to downtime to cost; GPS to dispatch to route efficiency to service reliability; fuel to behavior to cost leakage to optimization; compliance to records to audit readiness to risk reduction.
- For each major entity, make its operational role clear: what it does, what data it produces, and what decision it enables.
- Complete all intent layers: informational explanation, investigational comparison, and decision-making support.

Phase 4, structure correction:

- Do not rewrite blindly. Improve the draft with targeted edits mapped to the semantic map and approved outline.
- Start the article with the H1, then `## Key Takeaways`.
- Under `## Key Takeaways`, include one direct intro sentence and 3 to 5 bullets.
- The first key takeaway must fully answer the main query.
- Remove any traditional intro paragraph outside the `## Key Takeaways` section.
- Ensure H2s are question-based wherever natural.
- Ensure every H2 answers the heading immediately.
- Break structural uniformity. Do not let all sections follow the same pattern.

Phase 5, structural variation:

- For every H2, choose the best structure for the search intent behind that section.
- Use a three-paragraph format for explanations: 3 short paragraphs, 2 sentences each, direct answer first.
- Use one sentence plus structured bullets for benefits, features, criteria, signs, steps, or risks. Bullet labels must be 2 to 3 words and each bullet must carry meaningful information.
- Use one sentence plus H3s only when multiple subtopics genuinely need separate treatment. H3s should be 3 to 4 words and must justify their existence.
- Every non-FAQ H3 in the final article must have exactly 2 short paragraphs below it. Paragraph 1 defines or clarifies the H3 entity, component, or idea. Paragraph 2 explains its data output, function, operational impact, or decision value. Do not add a separate transition paragraph after an H3 before the next H2.
- FAQ H3s must answer directly in one concise paragraph of 1 to 2 sentences.
- Use tables only when comparison, mapping, or side-by-side evaluation improves clarity.
- Eliminate repeated numbers of bullets, repeated numbers of H3s, repeated paragraph rhythm, and predictable formatting.
- Component H3s, where used, should follow the two-paragraph H3 rule without padding.
- Prevent repeated entity-first openings. No H2 or H3 section should have more than two nearby sentences starting with the same entity, noun, pronoun, or phrase.
- Use sentence-opening variety intentionally: decision context, condition, outcome, contrast, operational object, then entity-first only when definition or disambiguation requires it.

Phase 6, content execution:

- Add a natural semantic bridge at the end of each major section so the next section follows logically.
- Remove em dashes.
- Remove or rewrite common AI phrases, especially vague claims such as "helps improve", "can support", "designed for", "built for", "clear understanding", "effective", and "efficient".
- Replace vague claims with direct cause-effect statements.
- Audit sentence starters across the full article. Rewrite every sentence that begins with "the", "a", "that", or "those".
- Extract the first 1 to 3 words of sentences in each section. Rewrite repeated nearby starts instead of using random synonyms.
- Check remaining sentence starter clusters. Rewrite repeated openings such as "this", "it", "these", "they", "when", "although", "by", "for", "while", or "each".
- Remove filler, vague modifiers, and generic claims. Every sentence must carry information.

Phase 7, micro section and authority:

- Add a clear Macro to Micro transition before application, buying, KPI, implementation, or software evaluation sections. Example: "Now that the system and its components are clear, the next step is choosing and applying the right solution."
- Add or refine the application layer: buying criteria, implementation logic, or a real-world system flow example.
- Improve KPI-driven decision support. Each KPI should support a decision, with a one-line explanation where missing.
- Add light data context only with safe phrasing, such as "Large fleets often track", "Most enterprise systems include", or "Typical benchmarks include".
- Do not add fake statistics, unsupported percentages, invented examples, or unverified claims.
- Mark claims that require source confirmation with "(verify before publishing)".

Final quality filter:

- No repeated structure patterns.
- No visible pattern of sentences starting with "the", "a", "that", or "those".
- No H2 or H3 section has more than two nearby sentences starting with the same entity or phrase.
- Bullet lists do not repeat the same grammar pattern across several consecutive bullets.
- Every non-FAQ H3 has exactly two short paragraphs below it, and every FAQ H3 has one concise answer paragraph.
- No repeated sentence starter clusters.
- No filler-heavy sentences.
- No weak or vague statements.
- Each section answers its heading immediately.
- Smooth contextual transitions exist.
- Macro to Micro flow is visible.
- The article reads like a domain expert wrote it and a senior content strategist edited it.

Return only the improved article in Markdown. Do not include a quality checklist, notes, explanations, or change summary.

Article brief:

{{ARTICLE_BRIEF}}

Semantic map:

{{SEMANTIC_MAP}}

Approved outline:

{{APPROVED_OUTLINE}}

Draft:

{{DRAFT}}
