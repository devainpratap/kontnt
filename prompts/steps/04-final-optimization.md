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

{{MATRACK_QUALITY_RULES}}

Workflow-aligned optimization:

Phase 3, semantic analysis:

- Classify the article type before optimizing. For comparison articles, validate that both entities are independently explained before comparison, legal/compliance clarification, decision guidance, or buying guidance.
- Convert implicit entity links into cause-effect chains.
- Apply these chains where relevant: telematics to maintenance to downtime to cost; GPS to dispatch to route efficiency to service reliability; fuel to behavior to cost leakage to optimization; compliance to records to audit readiness to risk reduction.
- For each major entity, make its operational role clear: what it does, what data it produces, and what decision it enables.
- Complete all intent layers: informational explanation, investigational comparison, and decision-making support.

Phase 4, structure correction:

- Do not rewrite blindly. Improve the draft with targeted edits mapped to the semantic map and approved outline.
- Treat this as a combined Stage 4 AEO pass and Stage 5 QA pass. Preserve factual content and headings unless the approved outline or article structure is invalid.
- If YAML frontmatter exists, preserve frontmatter values exactly.
- Apply AEO transformations without adding new facts: first-sentence tightening and variation, bridge removal, pronoun-to-noun replacement at section openings, statistic isolation, hedge removal, list parallelism, table parallelism, FAQ direct answers, H3 anchor sentences, concrete Final Thoughts, definition anchor reinforcement, and closing sentence variation.
- For comparison articles, enforce this order unless the approved outline has a user-approved reason to differ: define Entity A; define Entity B; explain responsibilities or core features; compare differences; handle legal/compliance after role clarity; provide decision guidance after comparison; place FAQs near the end; end with decision logic.
- Never open a comparison article with a dense comparison table unless the topic has very high user familiarity and the user clearly expects a quick-answer format.
- Remove any content between YAML frontmatter and the first H2. This includes Key Takeaways, TL;DR, summary blocks, executive summaries, callout boxes, quick answers, bullet summaries, or introduction paragraphs.
- For Matrack definition-led articles, the first H2 is the article entry point and its definition block must answer the main query directly.
- If no YAML frontmatter exists, remove any H1, Key Takeaways, TL;DR, summary block, or prose before the first topical H2 when the article follows the Matrack definition-led structure.
- Ensure H2s are question-based wherever natural.
- Ensure every H2 answers the heading immediately.
- Ensure H2 opening sentences are self-contained and structurally varied across the article. If 3 or more H2s share the same opening pattern, rewrite all but one.
- Break structural uniformity. Do not let all sections follow the same pattern.
- If 3 or more consecutive H2 sections use the same format, rebalance section presentation before final output. Convert repeated H3-list sections into bullets, numbered steps, compact prose, or tables where that better matches reader intent.

Phase 5, structural variation:

- For every H2, choose the best structure for the search intent behind that section.
- Assign one dominant purpose to every H2: definition, responsibilities, process, comparison, legal/compliance clarification, decision guidance, red flags, metrics/KPIs, FAQs, or conclusion.
- Split sections that mix definition, responsibilities, legal concerns, feature comparison, and user decision guidance prematurely.
- Use a three-paragraph format for explanations: 3 short paragraphs, 2 sentences each, direct answer first.
- Use one sentence plus structured bullets for benefits, features, criteria, signs, steps, or risks. Bullet labels must be 2 to 3 words and each bullet must carry meaningful information.
- Use one sentence plus H3s only when multiple subtopics genuinely need separate treatment. H3s should be 3 to 4 words and must justify their existence.
- Every non-FAQ H3 in the final article must be a tight chunk of 2 to 3 sentences. Sentence 1 names the H3 topic and function. Sentence 2 explains operational value. Sentence 3 is optional for a use case, integration, or specific detail.
- For any H2 section with 3 or more H3s, no more than half of the H3 openings may begin with the exact H3 heading phrase. Rewrite excess heading echoes with function-first, user/action-first, operational-condition-first, outcome-first, or object/data-first openings.
- FAQ H3s must answer directly in 2 to 3 self-contained sentences.
- Bullet lists must use `- **Term:** Explanation` with parallel grammar unless the approved outline has a specific reason not to.
- Comparison tables must use `Comparison Point` as the leftmost column and must not include `Drafting Caution`, `Verification Notes`, `Editorial Flag`, `Notes for Writer`, or `Caveat`.
- Use tables only when comparison, mapping, or side-by-side evaluation improves clarity.
- Eliminate repeated numbers of bullets, repeated numbers of H3s, repeated paragraph rhythm, and predictable formatting.
- Component H3s, where used, should follow the two-paragraph H3 rule without padding.
- Prevent repeated entity-first openings. No H2 or H3 section should have more than two nearby sentences starting with the same entity, noun, pronoun, or phrase.
- Prevent repeated H2 keyword starts, role-name starts, comparison-term starts, and repeated subject-plus-verb patterns such as "X is", "X helps", "X should", or "X can".
- Use sentence-opening variety intentionally: decision context, condition, outcome, contrast, operational object, then entity-first only when definition or disambiguation requires it.

Phase 6, content execution:

- Remove bridge sentences that reference previous or upcoming sections. Do not add end-of-section transition sentences.
- Remove em dashes.
- Remove or rewrite common AI phrases, especially vague claims such as "helps improve", "can support", "designed for", "built for", "clear understanding", "effective", and "efficient".
- Replace vague claims with direct cause-effect statements.
- Audit sentence starters across the full article. Rewrite every sentence that begins with "the", "a", "that", or "those".
- Extract the first 1 to 3 words of sentences in each section. Also check same entity match, same role match, same H2 keyword match, same comparison-term match, and same syntactic pattern. Rewrite repeated nearby starts instead of using random synonyms.
- Extract the first 5 to 7 words of every H2 opening sentence. Rewrite repeated cross-section patterns such as "Owner operators should", "Fleet managers can", or "[Topic] is" when they appear in 3 or more H2s.
- Check whether too many H2 openings restate the H2 heading topic as the opening subject. Keep direct answers, but rewrite later sections so the article does not read like a chain of heading definitions.
- Extract the predicate frame of every H2 opening sentence. Rewrite the article if 3 or more H2 openings use the same generic frame with different subjects, such as "[concept] improves when", "[concept] works by", "[concept] matters because", "[concept] depends on", "[concept] starts with", or "[concept] comes from".
- For H2 sections with multiple H3s, compare sibling H3 opening sentences. If 3 or more start with the same condition word or frame such as "After", "When", "Before", or "During", rewrite some with object-first, function-first, or stakeholder-action-first openings.
- Check remaining sentence starter clusters. Rewrite repeated openings such as "this", "it", "these", "they", "when", "although", "by", "for", "while", or "each".
- Remove filler, vague modifiers, and generic claims. Every sentence must carry information.
- Remove editorial leak phrases, CTAs, exclamation marks, rhetorical questions in body prose, first-person body prose, and banned marketing language.
- Rewrite or remove refusal-to-commit hedges. If a specific number or answer exists in the article, commit to it with named variation factors. If the article lacks support, remove the hedge rather than inventing a number.
- Detect repeated caveats such as "based on the manufacturer's definition", "exact wording can differ", "depending on context", and repeated "varies by" constructions. Keep the first useful caveat, remove later repetitions, and preserve any new variation factors without repeating the caveat preamble.
- Run a global phrase density pass across the full article. If a phrase or abstract noun cluster appears 4 or more times, rewrite or remove later instances unless repetition is necessary for accuracy.
- Watch especially for repeated use of: "one operating view", "route history", "service records", "tracking records", "data", "signals", "records", "becomes easier", "becomes stronger", "use those signals", "use those records", "managers can", and "teams use".
- Replace repeated abstract phrasing with concrete operational detail, such as the action taken, role responsible, record consulted, exception handled, or decision made.
- Keep most sentences between 15 and 22 words, and split sentences over 30 words.
- Ensure every statistic sentence includes source organization, year or time period, and specific number.

Phase 7, micro section and authority:

- Add clear Macro to Micro continuity inside the application, buying, KPI, implementation, or software evaluation section without using a standalone bridge sentence.
- Add or refine the application layer: buying criteria, implementation logic, or a real-world system flow example.
- Improve KPI-driven decision support. Each KPI should support a decision, with a one-line explanation where missing.
- Add light data context only with safe phrasing, such as "Large fleets often track", "Most enterprise systems include", or "Typical benchmarks include".
- Do not add fake statistics, unsupported percentages, invented examples, or unverified claims.
- Do not mark claims with editorial notes such as "(verify before publishing)". Remove unsupported claims or keep them as verification notes outside the article body.
- Ensure the Matrack pitch, when present, remains exactly 3 prose paragraphs with no H3s, bullets, numbered lists, or tables.
- Ensure the Matrack pitch includes both pricing context and flexibility context before final output.
- Ensure the Matrack pitch connects selected capabilities to the article's specific operational problem, not only to a general feature list. Avoid repeating generic phrases already used in the article unless followed by specific workflow detail.
- For waste management topics, connect the pitch to route progress visibility, missed pickup review, service verification, safety event review, maintenance planning, and fuel or idle oversight when those issues appear in the article.
- Compare the first and last sentence of each non-FAQ, non-Final Thoughts H2 section. If the closing repeats 50% or more of the opening's key terms or concepts, rewrite the closing with a specific operational implication, stakeholder decision, concrete constraint, or implicit forward value.

Final quality filter:

- No repeated structure patterns.
- No visible pattern of sentences starting with "the", "a", "that", or "those".
- No H2 or H3 section has more than two nearby sentences starting with the same entity or phrase.
- No H2 or H3 section has more than two nearby sentences starting with the same H2 keyword, role, comparison term, or opening grammar pattern.
- Bullet lists do not repeat the same grammar pattern across several consecutive bullets.
- H2 opening sentences vary across the article and do not repeat the same subject plus modal verb pattern.
- H2 openings do not mostly begin by echoing the H2 heading topic.
- H2 opening sentences do not repeat the same generic predicate frame across 3 or more sections.
- Sibling H3 openings do not repeat the same condition starter 3 or more times inside one H2 section.
- Section closings do not mirror section openings.
- Every non-FAQ H3 has 2 to 3 sentences, and every FAQ H3 has a concise direct answer.
- No repeated sentence starter clusters.
- No repeated H3-list format across 3 or more consecutive H2 sections when another structure would fit.
- No repeated abstract phrase appears 4 or more times unless required for accuracy.
- No filler-heavy sentences.
- No weak or vague statements.
- Each section answers its heading immediately.
- No bridge sentences or editorial process notes remain.
- Macro to Micro flow is visible.
- No editorial leak phrases, banned adjectives, banned verbs, CTAs, exclamation marks, or process columns remain.
- H3 chunks are 2 to 3 sentences, FAQ answers are direct, bullets are parallel, and comparison tables are reader-facing.
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
