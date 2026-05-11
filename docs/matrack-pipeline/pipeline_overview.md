# Matrack Blog Automation Pipeline — Master Handoff Document

**Version 1.0 | Pipeline complete with 6 artifacts**

This document is the single reference for the Matrack blog automation pipeline. It explains what each artifact does, how they connect, and how to operate the system in production.

---

## Pipeline Overview

```
┌────────────────────────────────────────────────────────────────────┐
│                      MATRACK BLOG PIPELINE                         │
└────────────────────────────────────────────────────────────────────┘

   [ INPUT ]
   primary_keyword + topic_context + audience + intent + word_count
        │
        ▼
   ┌─────────────────────────┐
   │ STAGE 1: RESEARCH       │  Web search + SERP analysis
   │ (Artifact 1)            │  → JSON research dossier
   └─────────────┬───────────┘
                 │
                 ▼ research_dossier.json
   ┌─────────────────────────┐
   │ STAGE 2: OUTLINE        │  Title + meta + H2 architecture
   │ (Artifact 2)            │  → JSON article outline
   └─────────────┬───────────┘
                 │
                 ▼ article_outline.json
   ┌─────────────────────────┐
   │ STAGE 3: DRAFTING       │  Generate article prose
   │ (Artifact 3)            │  → Markdown article
   └─────────────┬───────────┘
                 │
                 ▼ draft_article.md
   ┌─────────────────────────┐
   │ STAGE 4: AEO PASS       │  11 chunk-optimization transformations
   │ (Artifact 4)            │  → Optimized Markdown
   └─────────────┬───────────┘
                 │
                 ▼ optimized_article.md
   ┌─────────────────────────┐
   │ STAGE 5: QA AUDIT       │  35 checks + auto-fixes
   │ (Artifact 5)            │  → Final article + QA report
   └─────────────┬───────────┘
                 │
                 ▼
        ┌────────┴────────┐
        ▼                 ▼
   PASS / PASS_WITH_FIXES   FAIL
        │                 │
        ▼                 ▼
     PUBLISH        RE-RUN / HUMAN REVIEW

   ┌─────────────────────────┐
   │ ARTIFACT 0: STYLE       │  Reference document
   │ RUBRIC                  │  ← consulted by Stages 2, 3, 4, 5
   └─────────────────────────┘
```

---

## The 6 Artifacts

| # | Artifact | Type | Output | Purpose |
|---|----------|------|--------|---------|
| 0 | `matrack_style_rubric.md` | Reference doc | n/a | The canonical style and quality rules. Consulted by all other stages. |
| 1 | `stage_1_research_prompt.md` | Pipeline prompt | JSON dossier | Conducts web research and produces a structured fact base. |
| 2 | `stage_2_outline_prompt.md` | Pipeline prompt | JSON outline | Builds the article architecture: title, meta, H2s, briefs, stat placements. |
| 3 | `stage_3_drafting_prompt.md` | Pipeline prompt | Markdown article | Writes the article prose section by section. |
| 4 | `stage_4_aeo_optimization_prompt.md` | Pipeline prompt | Markdown article | Applies 11 transformations to maximize chunk-extractability. |
| 5 | `stage_5_qa_audit_prompt.md` | Pipeline prompt | Markdown + JSON QA report | Audits the article against the rubric; auto-fixes safe violations; decides publish/escalate. |

---

## Data Flow Between Stages

### Stage 1 → Stage 2

Stage 2 receives the entire JSON research dossier produced by Stage 1. Stage 2 references:
- `search_intent.primary_intent` to select the skeleton (A, B, C, or D)
- `paa_questions` to populate FAQ briefs
- `verified_statistics` to assign statistics to sections
- `entity_universe` to populate entity coverage requirements
- `comparison_candidates` to decide whether to include a comparison table H2
- `matrack_capability_mapping.highly_relevant` for the closing pitch capability selection

### Stage 2 → Stage 3

Stage 3 receives the JSON outline. Stage 3 walks `article_skeleton` in order, identifies each section's `structure_type`, and applies the matching writing protocol (A through H). Stage 3 uses only the entities, statistics, and capabilities specified in the outline — it does not introduce new content.

### Stage 3 → Stage 4

Stage 4 receives the Markdown article from Stage 3. Stage 4 applies 11 targeted transformations without changing structure or adding content. The output Markdown has the same H2/H3 hierarchy as the input.

### Stage 4 → Stage 5

Stage 5 receives the optimized Markdown. Stage 5 audits against 35 checks, applies safe auto-fixes, and outputs:
- The audited Markdown article (with auto-fixes applied)
- A `---END_ARTICLE---` separator
- A JSON QA report

The QA report's `ready_to_publish` flag drives the next action: publish, re-run an earlier stage, or escalate to human review.

---

## How to Plug Into Your Existing GPT-5 Workflow

### Recommended Workflow Architecture

Your automation tool should orchestrate the 5 stages as sequential API calls. Here's the suggested structure:

```
function generateMatrackBlog(primary_keyword, topic_context, audience, intent, word_count):

    # Stage 1
    stage_1_input = {primary_keyword, topic_context, audience, intent, word_count}
    research_dossier = call_gpt5(stage_1_prompt, stage_1_input)
    validate_json(research_dossier)

    # Stage 2
    article_outline = call_gpt5(stage_2_prompt, research_dossier)
    validate_json(article_outline)

    # Stage 3
    draft_article = call_gpt5(stage_3_prompt, article_outline)

    # Stage 4
    optimized_article = call_gpt5(stage_4_prompt, draft_article)

    # Stage 5
    audit_output = call_gpt5(stage_5_prompt, optimized_article)
    audited_article, qa_report = split_on_separator(audit_output)
    validate_json(qa_report)

    # Branch on verdict
    if qa_report.ready_to_publish:
        return audited_article
    else:
        handle_failure(qa_report.violations_requiring_action)
```

### Validation Between Stages

After each stage, validate the output before passing to the next stage:

- **Stages 1, 2, 5:** Validate JSON parses cleanly
- **Stages 3, 4:** Validate YAML frontmatter parses cleanly
- **Stage 5:** Check `ready_to_publish` flag and route accordingly

If any validation fails, log the failure and either retry the stage or escalate.

### Failure Handling

When Stage 5 returns `ready_to_publish: false`, branch on the `recommended_action` field of the highest-severity violation:

| Recommended Action | Workflow Response |
|--------------------|-------------------|
| `re_run_stage_2` | Re-run Stages 2, 3, 4, 5 with same Stage 1 dossier |
| `re_run_stage_3` | Re-run Stages 3, 4, 5 with same Stage 2 outline |
| `re_run_stage_4` | Re-run Stages 4, 5 with same Stage 3 draft |
| `human_review` | Send the article + QA report to a human editor |

---

## Operating Recommendations

### 1. Test Each Stage Before Going Production

Before running the full pipeline on real content, validate each stage individually:

- Run Stage 1 on a sample keyword. Confirm the JSON dossier has 25+ entities, 2+ Tier 1/2 statistics, and clean structure.
- Run Stage 2 on the Stage 1 output. Confirm the outline has the correct skeleton, all required H2s, and brief-style (not prose) section plans.
- Run Stage 3 on the Stage 2 output. Confirm the article matches your manager's voice on a manual read-through.
- Run Stage 4 on the Stage 3 output. Compare side-by-side to confirm targeted transformations were made (no regeneration).
- Run Stage 5 on the Stage 4 output. Confirm the QA report flags appropriate violations.

### 2. Monitor Common Failure Modes

Track these in your workflow logs:

- **Stage 1 failures:** Empty `verified_statistics` (research went thin), invented sources
- **Stage 2 failures:** Missing Matrack pitch H2, wrong title formula, prose in briefs
- **Stage 3 failures:** Bridge sentences leaked through, hedges leaked through, low entity density
- **Stage 4 failures:** Made structural changes (added/removed H2s), invented content
- **Stage 5 failures:** Frequent `FAIL` verdicts on the same checks (signals an upstream stage needs tuning)

If the same failure appears repeatedly, it usually points to a specific upstream prompt that needs sharpening.

### 3. Human Review Trigger Thresholds

Auto-publish only if Stage 5 returns `PASS` or `PASS_WITH_FIXES` with the following additional thresholds:

- Word count variance < 10%
- 0 critical violations remaining
- 0 major violations remaining
- ≤ 3 minor violations remaining

For new content categories or unfamiliar topics, force human review on the first 5–10 articles regardless of QA verdict, until you've validated the system handles the topic correctly.

### 4. Iterate the Rubric Over Time

Artifact 0 (the Style Rubric) is the source of truth. As you observe new failure patterns or new manager preferences, update the rubric and propagate changes to the relevant stage prompts. Versioning matters:

- Increment the rubric version on substantive changes
- Note which stage prompts depend on which rubric sections
- Test rubric changes on at least one full pipeline run before deploying

### 5. Track Quality Metrics

For each generated article, log:

- Stage 5 QA verdict (PASS / PASS_WITH_FIXES / FAIL)
- Number of auto-fixes applied
- Number of violations by severity
- Word count variance from target
- Time to generate (sum of all 5 stages)

After 50–100 articles, you should have enough data to identify systematic issues and improve specific stages.

---

## What This Pipeline Fixes vs Your Current System

Based on the gap analysis from your 4 sample blogs, here's what this pipeline specifically addresses:

| Issue Found in Current Outputs | Stage That Fixes It |
|-------------------------------|---------------------|
| Editorial leak phrases ("verify before publishing") | Stage 5 (auto-fix) + Stage 3 (prevention) |
| Missing Matrack pitch H2 | Stage 2 (mandatory inclusion) + Stage 5 (audit) |
| Missing meta description | Stage 2 (required output field) + Stage 5 (audit) |
| Excessive hedging | Stage 3 (anti-hedge rules) + Stage 4 (commitment rewrites) + Stage 5 (audit) |
| Title pattern inconsistency | Stage 2 (locked formula) + Stage 5 (audit) |
| Sentence-case H2s | Stage 2 (Title Case enforced) + Stage 5 (auto-fix) |
| Bridge sentences between sections | Stage 3 (prevention) + Stage 4 (removal) + Stage 5 (audit) |
| H3 sections too long | Stage 3 (2-3 sentence hard limit) + Stage 5 (audit) |
| Aphoristic Final Thoughts | Stage 3 (concrete framing rule) + Stage 4 (transformation 10) + Stage 5 (audit) |
| Inconsistent bullet formatting | Stage 3 (`**Term:** explanation` rule) + Stage 5 (auto-fix) |
| First-person ("you", "your") creep | Stage 3 (prevention) + Stage 5 (audit) |
| Drafting Caution column in tables | Stage 2 (banned column list) + Stage 5 (Critical violation) |
| Low entity density | Stage 1 (entity universe capture) + Stage 2 (entity assignment) + Stage 3 (density rules) |
| Statistics without sources | Stage 1 (verification rules) + Stage 3 (attribution format) + Stage 5 (audit) |
| Process-meta H2s | Stage 2 (banned phrasing) + Stage 5 (audit) |

---

## File Manifest

All 6 artifacts are delivered as standalone Markdown files:

1. `matrack_style_rubric.md` — Reference document
2. `stage_1_research_prompt.md` — Stage 1 prompt
3. `stage_2_outline_prompt.md` — Stage 2 prompt
4. `stage_3_drafting_prompt.md` — Stage 3 prompt
5. `stage_4_aeo_optimization_prompt.md` — Stage 4 prompt
6. `stage_5_qa_audit_prompt.md` — Stage 5 prompt

Plus this overview:

7. `pipeline_overview.md` — This document

---

## Next Steps

1. **Test the pipeline end-to-end** on a sample keyword before deploying broadly. Use a topic where you can compare the output to your manager's standards.

2. **Tune stage prompts as needed.** If a specific failure pattern recurs, identify which stage owns that rule and refine its prompt.

3. **Train your team on the rubric.** The rubric is also useful as a manual style guide for human editors reviewing pipeline output.

4. **Plan rubric versioning.** As your manager's preferences evolve or new content types emerge, version the rubric and propagate changes through the dependent stage prompts.

5. **Consider observability.** Log Stage 5 QA reports across articles to identify systematic quality trends.

---

**Pipeline complete.** This is a working blueprint based on the gap analysis between your manager's reference blogs and your current system's outputs. Iterate based on real-world results.
