# PRD: Local Semantic SEO Content Workflow App

## 1. Product Summary

Build a local-first content workflow app that helps users create high-quality semantic SEO blog articles with minimal manual intervention. The app uses the user's existing local Codex CLI login for generation, organizes every workflow step into structured inputs and outputs, and preserves a fallback path for users who prefer to paste prepared prompts into ChatGPT.com.

The first version should be simple, reliable, and workflow-focused. It should not attempt to become a full CMS, SEO platform, or complex automation dashboard.

## 2. Core Decision

The recommended product is a small local web app plus local workflow runner.

The backend runs on the user's machine and calls the local Codex CLI through non-interactive commands. The frontend gives the user a clean interface to enter article inputs, review outputs, approve the outline, and export the final article.

If Codex CLI is unavailable or the user does not want local generation, the app generates step-by-step ChatGPT.com handoff prompts and structured input files.

## 3. Goals

- Reduce a 10-step manual content workflow into a guided 4-step process.
- Use the user's existing local Codex CLI login instead of requiring API keys.
- Produce article outputs as Markdown files that are easy to edit, export, or paste elsewhere.
- Preserve one important human approval gate before full article drafting.
- Improve article quality through structured semantic analysis, outline rules, and final optimization checks.
- Keep setup lightweight and local.

## 4. Non-Goals

- No multi-user SaaS in v1.
- No payment system.
- No complex permissions or team management.
- No full CMS publishing in v1.
- No advanced crawling infrastructure.
- No dependency on n8n, Trigger.dev, or Docker for the first version.
- No heavy database setup unless needed later.

## 5. Target User

The user is a content operator, SEO strategist, founder, or agency operator who already uses ChatGPT/Codex for writing but spends too much time manually moving information between prompts, outlines, approvals, drafts, and optimization steps.

The user values:

- Fast article production.
- Strong topical coverage.
- Clear structure.
- Consistent quality.
- Minimal technical setup.
- Control before final drafting.

## 6. User Workflow

### Step 1: Article Intake

The user enters:

- Blog title or H1.
- Target keyword or query.
- Intended audience.
- Search intent.
- Top-ranking URLs.
- Competitor notes or pasted content.
- Main entities.
- Secondary entities.
- Product, brand, or service context.
- Attributes such as features, benefits, pricing points, use cases, comparisons, pros, cons, alternatives, and objections.
- Optional anchor keywords.
- Desired tone.
- Target word count.
- Internal links or preferred CTAs.

### Step 2: Generate Semantic Map

The app creates:

- Search intent summary.
- Reader problem map.
- Macro topic map.
- Micro topic map.
- Entity relationship map.
- Competitor heading patterns.
- Missing topical gaps.
- FAQ candidates.
- Product integration opportunities.
- Risk notes, such as claims that require verification.

### Step 3: Generate and Approve Outline

The app creates a full outline using:

- Key Takeaways.
- Question-based H2s.
- Supporting H3s.
- Macro education section.
- Micro application section.
- Buying guide or decision framework where relevant.
- Product or brand integration section where relevant.
- FAQs.
- Final Thoughts.

The user reviews the outline and can:

- Approve it.
- Edit it directly.
- Request regeneration.
- Add missing topics.
- Remove unwanted sections.

### Step 4: Draft and Optimize Article

After approval, the app generates:

- Full article draft.
- Final optimized article.
- SEO checklist.
- Entity coverage checklist.
- ChatGPT.com handoff prompt file.

## 7. System Architecture

### Recommended v1 Stack

Frontend:

- Next.js or Vite React app.
- Simple local browser interface.
- No complicated design system.
- Plain, fast UI focused on form input, review, and output.

Backend:

- Node.js backend.
- Local process runner for Codex CLI.
- File-based job workspace.
- Optional SQLite database for job metadata.

Database:

- Use SQLite for v1 if job history is needed.
- Use local files as the source of truth for article inputs and outputs.

Storage:

- Each article gets its own local folder.
- Inputs, prompts, logs, and outputs are saved as Markdown/JSON.

Suggested structure:

```text
content-workflow/
  app/
  jobs/
    article-slug-2026-04-30/
      input/
        brief.json
        urls.txt
        entities.md
        competitor-notes.md
      prompts/
        01-semantic-analysis.md
        02-outline.md
        03-draft.md
        04-final-optimization.md
        chatgpt-handoff.md
      outputs/
        semantic-map.md
        outline.md
        approved-outline.md
        draft.md
        final-optimized-blog.md
        quality-checklist.md
      run-log.json
```

## 8. Backend Requirements

### 8.1 Codex CLI Integration

The backend must:

- Check whether Codex CLI is installed.
- Check whether the user appears to be logged in.
- Run generation steps through local Codex CLI commands.
- Save each response to the correct output file.
- Capture errors and show them in the UI.
- Avoid asking the user for API keys in v1.

The backend should support a generation command abstraction:

```text
runGenerationStep({
  jobId,
  stepName,
  inputFiles,
  promptTemplate,
  outputFile
})
```

### 8.2 Step Runner

The backend must support these workflow states:

- Draft intake created.
- Semantic map generated.
- Outline generated.
- Outline approved.
- Draft generated.
- Final optimization completed.
- Export ready.

Each step should be restartable. If a step fails, the user should be able to rerun that step without deleting the whole article job.

### 8.3 File Handling

The backend must:

- Save all user inputs.
- Save generated prompts.
- Save raw generated outputs.
- Save edited outline separately from generated outline.
- Never overwrite user-edited approved outline unless the user confirms.

### 8.4 Competitor Input Handling

V1 should support:

- Manual URL entry.
- Pasted competitor content.
- Uploaded text or Markdown files.
- SEO tool export paste area.

Optional v1.5:

- Fetch public article pages from URLs.
- Extract title, meta description, H1, H2, H3, and body text.

### 8.5 ChatGPT.com Fallback

For every workflow step, the backend must also generate copy-ready prompts for ChatGPT.com.

The fallback file should include:

- Step name.
- What to paste into ChatGPT.com.
- Required input context.
- Expected output format.
- Where to paste the result back into the app.

## 9. Frontend Requirements

### 9.1 UI Philosophy

The UI should be simple and operational. It should feel like a production tool, not a marketing website.

It should have:

- One main job list.
- One article workspace.
- Clear step navigation.
- Large editable text areas for inputs and outputs.
- Obvious run, approve, regenerate, and export actions.
- No complex dashboards.
- No decorative landing page.

### 9.2 Main Screens

#### Screen 1: Job List

Purpose:

- Start a new article.
- Open previous article jobs.
- See current workflow status.

Fields:

- Article title.
- Status.
- Last updated.
- Final output link.

Actions:

- New Article.
- Open.
- Duplicate.
- Delete.

#### Screen 2: Article Intake

Purpose:

- Collect all required inputs in one place.

Sections:

- Core article brief.
- SERP and competitor inputs.
- Entity inputs.
- Product or brand context.
- Tone and formatting preferences.

Actions:

- Save.
- Generate Semantic Map.
- Generate ChatGPT Handoff.

#### Screen 3: Semantic Map

Purpose:

- Review the generated analysis before outline creation.

Sections:

- Search intent.
- Reader needs.
- Macro topics.
- Micro topics.
- Entity relationships.
- Competitor patterns.
- Content gaps.
- FAQ candidates.

Actions:

- Regenerate.
- Edit.
- Generate Outline.

#### Screen 4: Outline Review

Purpose:

- Preserve the main human quality gate.

Sections:

- Editable outline.
- Notes/requested changes.
- Quality checklist.

Actions:

- Regenerate Outline.
- Save Edits.
- Approve Outline.
- Generate Draft.

#### Screen 5: Draft and Optimization

Purpose:

- Generate the article and optimize it.

Sections:

- Draft article.
- Final optimized article.
- Quality checklist.
- Export options.

Actions:

- Regenerate Draft.
- Run Final Optimization.
- Export Markdown.
- Export Copyable Text.
- Open Output Folder.

## 10. Database Schema

Use SQLite only for lightweight metadata. Store large content in files.

### Table: jobs

```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  job_path TEXT NOT NULL
);
```

### Table: job_steps

```sql
CREATE TABLE job_steps (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  step_name TEXT NOT NULL,
  status TEXT NOT NULL,
  input_path TEXT,
  prompt_path TEXT,
  output_path TEXT,
  started_at TEXT,
  completed_at TEXT,
  error_message TEXT,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
```

### Table: settings

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

## 11. Prompt Configuration

Prompt templates should live as editable Markdown files. The app should not hardcode all prompting inside backend code.

Suggested folder:

```text
prompts/
  system/
    content-quality-rules.md
    semantic-seo-rules.md
  steps/
    01-semantic-analysis.md
    02-outline-generation.md
    03-blog-draft.md
    04-final-optimization.md
    05-chatgpt-handoff.md
```

### Global Prompt Rules

All generation steps must follow:

- Write for the reader first, SEO second.
- Avoid fluff, generic filler, and unsupported claims.
- Use entities naturally.
- Do not keyword-stuff.
- Use clear section transitions.
- Prefer concrete explanations, examples, comparisons, and decision criteria.
- Keep product mentions useful and non-promotional unless the user asks for sales copy.
- Preserve the user's brand, tone, and article constraints.
- Flag facts that require external verification.

## 12. Step Prompt Specs

### 12.1 Semantic Analysis Prompt

Input:

- Article brief.
- Competitor URLs or pasted competitor content.
- Entities.
- Attributes.
- Anchors.
- Product context.

Output format:

```markdown
# Semantic Needs Map

## Search Intent

## Reader Profile

## Core Problem

## Macro Topics

## Micro Topics

## Entity Relationship Map

## Competitor Coverage Patterns

## Content Gaps

## Required Sections

## FAQ Candidates

## Product Integration Opportunities

## Verification Notes
```

Quality rules:

- Identify the main intent and secondary intents.
- Separate educational topics from buying/application topics.
- Include only sections that are relevant to the article title.
- Note where competitor pages are thin or repetitive.

### 12.2 Outline Generation Prompt

Input:

- Article brief.
- Semantic map.
- User preferences.

Output format:

```markdown
# Article Outline

## Working Title

## Suggested Meta Description

## Key Takeaways

## Introduction Angle

## Macro Section

### H2: [Question-based heading]

#### H3: [Supporting point]

## Micro Section

### H2: [Question-based heading]

#### H3: [Supporting point]

## Buying Guide / Decision Framework

## Product or Brand Integration

## FAQs

## Final Thoughts

## Notes for Writer
```

Quality rules:

- H2s should usually be question-based.
- H3s should support the parent H2 directly.
- Avoid duplicate sections.
- Include a clear flow from education to application.
- Include product context only where it genuinely helps the reader.

### 12.3 Draft Generation Prompt

Input:

- Approved outline.
- Article brief.
- Semantic map.
- Tone preferences.
- Entity and anchor requirements.

Output format:

```markdown
# [Final Article Title]

## Key Takeaways

[Article body]

## FAQs

## Final Thoughts
```

Quality rules:

- Follow the approved outline.
- Use short, readable paragraphs.
- Avoid thin sections.
- Add contextual bridges between sections.
- Use concrete examples where helpful.
- Do not invent statistics, citations, pricing, or claims.
- Mark uncertain claims as needing verification.

### 12.4 Final Optimization Prompt

Input:

- Draft article.
- Approved outline.
- Semantic map.
- Quality rules.

Output format:

```markdown
# Final Optimized Blog

[Optimized article]

---

# Quality Checklist

- Search intent alignment:
- Entity coverage:
- Section flow:
- H2 quality:
- FAQ usefulness:
- Product mention balance:
- Claims needing verification:
- Readability:
```

Quality rules:

- Improve flow without changing the core structure.
- Remove repetition.
- Strengthen weak transitions.
- Fix vague introductions.
- Improve section completeness.
- Keep tone consistent.
- Preserve important user edits.

## 13. Configuration

The app should expose a simple settings file:

```json
{
  "generation": {
    "provider": "codex-cli",
    "model": "default",
    "timeoutSeconds": 600,
    "saveRawLogs": true
  },
  "articleDefaults": {
    "tone": "clear, expert, practical",
    "targetWordCount": 1800,
    "includeFAQs": true,
    "includeKeyTakeaways": true,
    "includeFinalThoughts": true,
    "productMentionStyle": "helpful and non-promotional"
  },
  "workflow": {
    "requireOutlineApproval": true,
    "allowStepRegeneration": true,
    "createChatGPTFallbackPrompts": true
  }
}
```

## 14. MVP Feature List

### Must Have

- Local web UI.
- New article job creation.
- Intake form.
- Save inputs to local files.
- Generate semantic map through Codex CLI.
- Generate outline through Codex CLI.
- Editable outline approval.
- Generate draft through Codex CLI.
- Run final optimization through Codex CLI.
- Export final article as Markdown.
- Generate ChatGPT.com handoff prompts.
- Simple error display.
- Rerun failed steps.

### Should Have

- SQLite job history.
- Duplicate article job.
- Import pasted SEO tool exports.
- Basic public URL fetch and text extraction.
- Output folder shortcut.
- Quality checklist view.

### Could Have

- DOCX export.
- HTML export.
- Internal link suggestions.
- Content brief templates.
- Saved brand voice profiles.
- Saved product profiles.
- SERP screenshot upload and OCR.

### Not in MVP

- Team accounts.
- Cloud sync.
- WordPress publishing.
- Automated rank tracking.
- Full SERP scraping at scale.
- n8n or Trigger.dev orchestration.

## 15. Quality Bar

An article is considered successful when:

- The search intent is clear.
- The outline has logical progression.
- Macro and micro sections are both represented.
- H2s answer real reader questions.
- Product mentions feel natural.
- FAQs are not generic duplicates.
- The final article avoids obvious filler.
- Claims that need verification are flagged.
- The output is ready for human review with minimal cleanup.

## 16. Error Handling

The app should handle:

- Codex CLI not installed.
- Codex CLI not logged in.
- Generation timeout.
- Empty output.
- User edits that conflict with regeneration.
- Missing required intake fields.
- Failed URL fetch.
- File write errors.

The UI should show plain-language messages and the next action.

Examples:

- "Codex CLI is not available on this machine. You can still generate ChatGPT.com handoff prompts."
- "This step did not finish. You can rerun it or use the handoff prompt."
- "Your edited outline is saved. Regenerating will create a new version, not overwrite this one."

## 17. Security and Privacy

- All article data stays local in v1.
- No API keys are required for the default Codex CLI path.
- The app should not upload files to third-party services except through the user's local Codex CLI generation flow.
- Job folders should be human-readable and portable.
- Logs should not expose hidden credentials.

## 18. Implementation Plan

### Phase 1: Local Runner

- Create folder structure.
- Add prompt templates.
- Add config file.
- Add step runner.
- Add Codex CLI execution wrapper.
- Add output writing.
- Add ChatGPT handoff prompt generation.

### Phase 2: Minimal Web UI

- Build job list.
- Build article intake screen.
- Build semantic map screen.
- Build outline approval screen.
- Build draft/final output screen.
- Connect UI to backend step runner.

### Phase 3: Quality Enhancements

- Add competitor URL extraction.
- Add quality checklist.
- Add job duplication.
- Add saved brand/product profiles.
- Add DOCX or HTML export.

## 19. Success Metrics

- User can create a full article from intake to final optimized Markdown.
- Manual intervention is reduced to intake and outline approval.
- The app can regenerate individual steps without restarting the job.
- The user can complete a high-quality draft faster than the current Custom GPT workflow.
- ChatGPT.com fallback prompts are clear enough to complete the workflow manually if Codex CLI is unavailable.

## 20. Recommended MVP Scope

Build the smallest useful version:

- Local React UI.
- Node backend.
- SQLite metadata.
- File-based article storage.
- Codex CLI generation runner.
- Prompt templates.
- One approval gate.
- Markdown exports.
- ChatGPT.com fallback prompts.

This gives the user a reliable local workflow without the overhead of Docker, n8n, Trigger.dev, or a production SaaS architecture.
