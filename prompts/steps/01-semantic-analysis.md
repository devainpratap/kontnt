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

Additional analysis rules:

- If competitor context includes extracted page structure or article summaries, use them to identify recurring section patterns, weak spots, and missing subtopics.
- Distinguish what competitors repeat from what the reader actually needs.
- Favor concrete observations over generic SEO commentary.
- Use the article title and search intent to decide which competitor angles are relevant and which are noise.
- Build explicit entity chains. Show how the main entities cause, enable, constrain, or report on one another.
- Create attribute clusters for each major entity with function, data output, and business impact.
- Separate intent layers into informational, commercial investigation, and decision support.
- Identify where the article needs evidence, examples, KPI support, or verification notes.
- Identify likely AI-pattern risks for this topic, such as repetitive section shapes, generic benefits, or unsupported statistics.

Return Markdown only using this structure:

# Semantic Needs Map

## Search Intent

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

Article brief:

{{ARTICLE_BRIEF}}

Competitor and SERP context:

{{COMPETITOR_CONTEXT}}

Entity context:

{{ENTITY_CONTEXT}}
