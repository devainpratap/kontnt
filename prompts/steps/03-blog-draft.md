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

{{MATRACK_QUALITY_RULES}}

Additional drafting rules:

- Treat this as Stage 3 drafting. Execute the approved outline without adding new research, new statistics, new entities, or new article architecture.
- If the outline includes frontmatter fields, preserve them and draft beneath them. If no frontmatter is supplied, use clean Markdown without inventing hidden metadata.
- Do not write an introduction paragraph before the first H2 when the approved outline follows the Matrack definition-led structure.
- Do not add any content between YAML frontmatter and the first H2. This includes Key Takeaways, TL;DR, summary blocks, executive summaries, callout boxes, quick answers, bullet summaries, or introduction paragraphs.
- Respect the approved outline as the contract for the article structure.
- If the approved outline is for a comparison article, preserve the logical order: define both entities independently, explain responsibilities or core features, then compare, then address legal/compliance or decision guidance, then FAQs and final thoughts.
- Before drafting each H2, identify its single dominant purpose: definition, responsibilities, process, comparison, legal/compliance clarification, decision guidance, red flags, metrics/KPIs, FAQs, or conclusion.
- Do not blend multiple purposes inside one H2. For example, a responsibilities section should not also carry legal authority guidance and a comparison table.
- Each section should answer its heading directly before expanding into examples or nuance.
- Keep each section independently extractable. Do not add bridge sentences such as "Now that", "Once teams", "With X now visible", "Having established", "As discussed above", "Building on", "Before we get to", or "Now let's look at".
- When a claim may depend on the product, market, or pricing context, state the uncertainty instead of inventing specifics.
- Do not write a traditional introduction. For Matrack definition-led articles, the first H2 directly follows frontmatter or the document start and serves as the article entry point.
- Do not add Key Takeaways unless the approved outline explicitly requires them for a non-Matrack article.
- Use question-based H2s wherever the approved outline allows it.
- Choose the best structure for each H2 rather than repeating the same pattern.
- Rotate H2 opening sentence types across the article: topic-as-subject, operational-outcome-first, operating-context-first, concrete-specific-fact-first, and stakeholder-action-first.
- Do not let 3 or more H2s open with the same subject plus modal verb pattern, such as "Owner operators should", "Fleet managers can", or "Trucking companies need".
- No single H2 opener type should appear in more than 40% of the article's H2 openings. Stakeholder-action-first openings should appear no more than 1 to 2 times.
- Do not let repeated entities dominate sentence openings. Within each H2 or H3, avoid starting more than two nearby sentences with the same entity, noun, pronoun, or phrase.
- Keep the primary keyword lowercase in body prose unless it is a proper noun, acronym, regulation name, or official product name. Do not title-case a generic keyword just because it appears in the title.
- Do not repeatedly start sentences with the H2 keyword, role name, comparison term, or the same grammar pattern such as "X is", "X helps", "X should", or "X can".
- Vary sentence openings by starting with decision context, condition, outcome, contrast, or the operational object when the topic entity would otherwise repeat.
- For explanatory H2s, use the three-paragraph logic when natural: direct answer, mechanism, implication or transition.
- For benefits, features, signs, steps, and mistakes, use one short lead sentence followed by structured bullets.
- For multi-component sections, use H3s. Each non-FAQ H3 must have 2 to 3 sentences: sentence 1 names the H3 topic and function, sentence 2 explains the operational value, and sentence 3 may add a use case or integration detail.
- H3 heading echo density rule: in any H2 section with 3 or more H3s, no more than half of the H3 opening sentences may begin with the exact H3 heading phrase. Keep the entity clear, but vary some openings with function-first, user/action-first, operational-condition-first, outcome-first, or object/data-first phrasing.
- For FAQ H3s, answer directly in 2 to 3 self-contained sentences.
- Format bullets as `- **Term:** Explanation` with 1 to 2 sentences per bullet unless the approved outline explicitly uses a different format.
- Format comparison tables with `Comparison Point` as the leftmost column and never include editorial/process columns.
- Use tables only when they make comparison or breakdown easier to understand.
- Do not add end-of-section micro-transitions that point to the next section. The H2 heading is the only transition needed.
- Include a buying guide with 5 to 6 criteria when the outline calls for decision support.
- Include a KPI section when the topic has operational, financial, performance, or evaluation intent. Define each KPI and explain why it matters.
- Connect major entities through cause and effect rather than naming them separately.
- Avoid generic claims. Replace broad statements with specific mechanisms.
- Avoid editorial leak phrases, refusal-to-commit hedges, CTAs, first-person body prose, rhetorical questions in body prose, marketing puffery, and exclamation marks.
- If using a statistic, include the named source, year or time period, and specific number in the same sentence.
- If adding a Matrack pitch, use only canonical capabilities that are operationally relevant to the article topic and keep it factual, third-person, and CTA-free.
- The Matrack pitch must be exactly 3 prose paragraphs with no H3s, bullets, numbered lists, tables, or line breaks except between paragraphs.
- Paragraph 1 positions Matrack as the best relevant solution for the primary term and names 3 to 5 topic-relevant capabilities.
- Paragraph 2 must mention pricing and flexibility context, such as affordable monthly plans, flexible plans, no long-term contracts, easy-install hardware, or suitability from small fleets to large enterprises.
- Paragraph 3 must explain consolidation value: why combining the chosen capabilities in one platform is better than managing separate tools for related functions.
- Avoid em dashes and obvious AI phrases.
- Before returning the draft, audit sentence openings and rewrite every sentence that begins with "the", "a", "that", or "those".
- Before returning the draft, scan every section for repeated first 1 to 3 words, repeated role/entity starts, repeated H2 keyword starts, and repeated subject-plus-verb openings. Rewrite nearby repeats instead of swapping in random synonyms.
- Before returning the draft, compare each H2 opening as a set and rewrite any cross-section pattern that appears 3 or more times.
- Do not let most H2 opening sentences begin by restating the H2 heading topic. The first definition H2 may use the primary term directly, but later sections should rotate into outcome-first, condition-first, concrete-fact-first, operational-detail-first, or stakeholder-decision openings.
- Do not let 3 or more H2 opening sentences share the same generic predicate frame, even when the subject changes. Watch for repeated frames such as "[concept] improves when", "[concept] works by", "[concept] matters because", "[concept] depends on", "[concept] starts with", or "[concept] comes from". Rewrite with outcome-first, condition-first, operational-detail-first, or stakeholder-decision framing.
- In any H2 with multiple H3s, do not let 3 or more sibling H3 opening sentences start with the same condition word or frame such as "After", "When", "Before", or "During".
- Avoid using generic glue nouns as the repeated connective tissue of the article. Terms such as context, events, alerts, review, records, data, dashboard, workflow, visibility, and signals are allowed when needed, but repeated use should be replaced with the specific object: fatigue warning, distraction clip, HOS log, repair ticket, route replay, claim file, coaching note, driver scorecard, dispatch decision, or inspection record.
- The ideal Matrack-style articles use simple causal flow and concrete operational nouns. When a sentence says something "adds context", "supports review", or "creates workflow", revise it to say who acts, what file or signal they use, and what decision changes.
- Do not add standalone transition paragraphs after an H3 before the next H2. Place the transition inside the second H3 paragraph or before the H3 list begins.

Return Markdown only.

Use this structure:

# [Final Article Title]

[article body]

## FAQs

## Final Thoughts

Article brief:

{{ARTICLE_BRIEF}}

Semantic map:

{{SEMANTIC_MAP}}

Approved outline:

{{APPROVED_OUTLINE}}
