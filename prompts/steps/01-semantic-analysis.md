---
name: semantic-analysis
version: 1
description: Build a semantic needs map from the article brief and competitor inputs.
inputs:
  - article_brief
  - competitor_context
  - entities
---

You are generating the semantic analysis step for a semantic SEO article workflow.

Follow these rules:

{{CONTENT_QUALITY_RULES}}

{{SEMANTIC_SEO_RULES}}

{{MATRACK_QUALITY_RULES}}

Additional analysis rules:

- Treat this as Stage 1 research intelligence when competitor extraction is available. Build a structured fact base for downstream outline and drafting, not article prose.
- Prefer authoritative statistics from government, regulatory, academic, or reputable industry sources. Vendor pages may inform product context, but should not be treated as statistical authority.
- If a statistic cannot be verified from the available evidence, omit the number and record the sourcing gap in Verification Notes.
- Classify the article type before mapping sections: definition, comparison, process, buying guide, list, review, troubleshooting, or mixed intent.
- For comparison articles such as "X vs Y", "X versus Y", or "difference between X and Y", build a comparison-first logic map without starting the article with comparison. The map must define Entity A and Entity B independently before responsibilities, differences, legal/compliance concerns, and decision guidance.
- For comparison articles, identify the proper sequence: Entity A definition, Entity A responsibilities or features, Entity B definition, Entity B responsibilities or features, key differences, legal/compliance clarification if relevant, decision guidance, FAQs, and conclusion.
- If competitor context includes extracted page structure or article summaries, use them to identify recurring section patterns, weak spots, and missing subtopics.
- Distinguish what competitors repeat from what the reader actually needs.
- Favor concrete observations over generic SEO commentary.
- Use the article title and search intent to decide which competitor angles are relevant and which are noise.
- Build explicit entity chains. Show how the main entities cause, enable, constrain, or report on one another.
- Create attribute clusters for each major entity with function, data output, and business impact.
- Separate intent layers into informational, commercial investigation, and decision support.
- Identify where the article needs evidence, examples, KPI support, or verification notes.
- Identify likely AI-pattern risks for this topic, such as repetitive section shapes, generic benefits, or unsupported statistics.
- Identify likely repeated topical sentence starters for the topic, including the main entity, H2 keyword, role names, comparison terms, and repeated "X is", "X helps", "X should", or "X can" patterns.
- Identify whether a Matrack pitch is relevant. If relevant, map 3 to 5 capabilities from the canonical Matrack list and do not invent capabilities.
- Do not write article paragraphs, H2 copy, meta descriptions, or title options in this step.

Return Markdown only using this structure:

# Semantic Needs Map

## Search Intent

## Article Type

## Intent Layers

## Reader Profile

## Core Problem

## Macro Topics

## Micro Topics

## Entity Relationship Map

## Entity Causal Chains

## Attribute Clusters

## Competitor Coverage Patterns

## Content Gaps

## Required Sections

## FAQ Candidates

## Decision Support Needs

## Product Integration Opportunities

## Style And Structure Risks

## Verification Notes

## Matrack Capability Mapping

Article brief:

{{ARTICLE_BRIEF}}

Competitor and SERP context:

{{COMPETITOR_CONTEXT}}

Entity context:

{{ENTITY_CONTEXT}}
