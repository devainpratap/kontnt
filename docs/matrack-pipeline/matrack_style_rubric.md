# Matrack Blog Style & Quality Rubric

**Version 1.0 | The canonical reference document for the Matrack blog automation pipeline.**

This document encodes the writing standards extracted from Matrack's reference blogs. Every stage of the blog pipeline must reference this rubric. When in doubt, this document is authoritative.

This rubric exists to produce blogs that simultaneously rank in Google search **and** get cited by LLMs (ChatGPT, Perplexity, Gemini, Claude). Every rule below serves one or both of those goals.

---

## Section 1: Title & Meta Description Formulas

### 1.1 Title Formula (mandatory)

Every blog title must follow this structure:

```
What Is [Primary Term]? [Aspect 1], [Aspect 2], and [Aspect 3]
```

- **Title Case** throughout. Capitalize all major words.
- The primary keyword must appear in exact-match form before the colon.
- After the colon, list 2–4 sub-aspects that telegraph the article's H2 structure (e.g., "How It Works, Types & Costs", "Key Components, Industry Examples, and Business Benefits").
- Do not use marketing adjectives in titles (e.g., "Smarter," "Ultimate," "Powerful," "Complete Guide to," "Everything You Need to Know"). These are banned.
- Do not use tagline-style subtitles after a colon (e.g., "Smarter Insights for Better Fleet Decisions" — not allowed).

**Approved examples:**
- *What Is Freight Factoring? How It Works, Types & Costs*
- *What Is a Van Fleet Management System? Key Components, Industry Examples, and Business Benefits*
- *What Is Utility Fleet Management? How It Works, Importance, & Use Cases*

**Banned examples:**
- *Fleet Management Reporting: Smarter Insights for Better Fleet Decisions* (tagline-style, has marketing adjective)
- *The Ultimate Guide to GPS Tracking* (marketing puffery)
- *Geospatial Mapping Explained* (uses "Explained" instead of question)

### 1.2 Meta Description Formula (mandatory)

Every blog must include a meta description.

- Length: 22–30 words. Hard cap at 155 characters.
- Must start with the primary keyword as the subject of the sentence.
- Must include 3–5 related entities or benefits.
- Plain factual definition style. No questions. No "Discover," "Learn," "Explore."
- One or two sentences maximum.

**Approved examples:**
- *Van fleet management system tracks vans, routes, drivers, fuel, and maintenance to reduce costs and improve fleet efficiency.*
- *Freight factoring is selling unpaid freight invoices to a factoring company for fast cash, improving trucking cash flow, with fees and advance rates.*
- *EOBR is a legacy device that recorded driver hours and vehicle data before ELDs became the modern fleet compliance standard.*

---

## Section 2: Article Skeleton (Mandatory Structure)

Every Matrack blog has the following structure. H2s in **bold** are mandatory; others are optional based on topic intent.

```
[Meta Description]
[H1 — Title]
H2 #1 (mandatory): What Is [Primary Term]?           ← Definition block
H2 #2: How Does [Term] Work?                          ← Mechanism (with bullets)
H2 #3: What Are the Key Components/Types of [Term]?   ← Taxonomy (with H3s)
H2 #4: What Are the Benefits of [Term]?               ← Value props
H2 #5: Why Is [Term] Important? OR Challenges?        ← Context
H2 #6: Which Industries Use [Term]? OR Who Uses?      ← Applicability
H2 #7: How To Implement / What Should You Look For?   ← Actionable guidance
H2 #8: What Is the Difference Between X and Y?        ← Comparison (with table)
H2 #9 (mandatory): What Is the Best [Term] Solution?  ← Matrack pitch
H2 #10 (optional): Frequently Asked Questions         ← FAQ
H2 #11 (mandatory): Final Thoughts                    ← Closing
```

**Selection rules:**
- Pick 5–9 H2s per article based on search intent and topic depth.
- H2 #1 (definition), H2 #9 (Matrack pitch), and H2 #11 (Final Thoughts) are mandatory in every blog.
- FAQ section is mandatory for posts longer than 1,500 words; optional below that.
- Comparison table H2 is mandatory if the topic involves "X vs Y" intent (e.g., EOBR vs ELD).

**Forbidden:** Do not write an introduction paragraph before H2 #1. The first H2 is the introduction.

ABSOLUTE BAN ON PRE-H2 CONTENT:

No content of any kind is allowed between the YAML frontmatter and the first H2. This includes:

- Key Takeaways blocks
- TL;DR sections
- Executive summaries
- Introduction paragraphs
- Callout boxes or notice blocks
- Bullet point summaries
- "What you'll learn" lists
- Quick answers / quick definitions
- Any heading or sub-heading before the first ##

The first H2 is the article's entry point. The first H2's three-paragraph definition block serves as the introduction. This rule has no exceptions even if the model believes a TL;DR would improve scannability or AEO.

Reasoning: Pre-H2 content fragments the chunk structure that Google Featured Snippets and LLM citation engines reward. The first H2 must be the first thing readers and crawlers encounter.

---

## Section 3: The First H2 — Definition Block (Critical Section)

The first H2 is the most important real estate in the article. It must follow this exact 3-paragraph rhythm.

### 3.1 Paragraph 1 — The Direct Definition

- The first sentence must begin with the **exact primary keyword as grammatical subject**, followed by an "is" or "means" verb, followed by a packed definitional clause containing 3–5 related entities.
- Maximum 2 sentences.
- No throat-clearing ("In today's world…", "As we all know…").

**Approved openers:**
- *Van fleet management system is a software-driven solution that manages multiple vans using GPS tracking, telematics, and centralized dashboards.*
- *Freight factoring means a carrier sells an unpaid freight invoice from a completed load to a factoring company and receives cash before the broker or shipper makes payment.*

### 3.2 Paragraph 2 — Mechanism / Who Uses It

- Adds depth without restating the definition.
- 2–3 sentences.
- Names the operators, decision-makers, or workflows involved.

### 3.3 Paragraph 3 — Practical Context

- Names specific industries, use cases, or operational scenarios.
- 2–3 sentences.
- Should set up the rest of the article without using "in this article" or "we'll cover" language.

### 3.4 Forbidden in the Definition Block

- No H3 subsections under the first H2. The definition block is plain prose only.
- No bullet lists in the first H2 unless absolutely necessary (rare exception, not default).
- No comparison content. Comparisons go in their own dedicated H2 later.

---

## Section 4: H2 Architecture Rules

### 4.1 H2 Phrasing

- **Every H2 must be a question.** No statements. No noun phrases.
- Use Title Case (capitalize all major words).
- The primary keyword or a clear synonym should appear in at least 60% of H2s.
- Question stems to use: *What Is, How Does, What Are, Why Is, Which, Who, How To, What Should.*

**Approved H2s:**
- *What Are the Business Benefits of Van Fleet Management Systems?*
- *Which Industries Use Van Fleet Management Systems?*
- *How To Implement a Van Fleet Management System?*

**Banned H2s:**
- *Where do tools and services fit without turning the article promotional?* (process-meta, not topic-focused)
- *Reporting Versus Tracking* (statement, not question)
- *Why does on-time delivery matter in supply chain operations?* (sentence case — must be Title Case)

### 4.2 Forbidden H2 Topics

Do not write H2s about:
- The article's writing process
- Editorial decisions or caveats
- "Where this article fits" or "what we'll cover"

H2s must be reader-facing topical questions, never writer-facing process questions.

---

## Section 5: H3 Micro-Pattern (Components / Types Sections)

Under any H2 that lists components, types, features, or benefits, use H3 subsections that follow this strict pattern:

### 5.1 H3 Length & Structure

- Each H3 section: **exactly 2–3 sentences**, no more.
- Sentence 1: Functional definition — what it does or is.
- Sentence 2: Why it matters / what outcome it enables.
- Sentence 3 (optional): Specific use case, integration, or detail.
- **Never exceed 3 sentences in an H3 section.** This is a hard limit.

**Approved H3:**
> **GPS Fleet Tracking Device**
> *GPS fleet tracking gives teams real-time visibility into where each van is during active routes. Route progress, stop history, and vehicle movement help dispatch teams reduce delays and coordinate jobs more accurately.*

### 5.2 Why This Length Is Strict

Each H3 is a self-contained, citable unit for LLM extraction. If an H3 sprawls to 5–6 sentences, it stops being chunk-friendly. LLMs cite tight, complete units.

---

## Section 6: Bullet Formatting Rules

### 6.1 Standard Bullet Format

When using bullet lists, the format is:

```
- **Term:** Explanation in 1–2 sentences.
```

- The lead term is bolded and followed by a colon.
- The explanation is 1–2 sentences, never longer.
- This format is mandatory for all bulleted lists in components, benefits, challenges, and feature sections.

**Approved:**
> - **Faster Payments:** Funds arrive soon after load delivery, helping cover expenses without waiting on broker or shipper settlements.
> - **Steady Cash Flow:** Predictable working capital supports fuel purchases, payroll, insurance, repairs, maintenance, and dispatch operations.

### 6.2 Numbered Lists

Use numbered lists only for:
- Sequential steps in a process (e.g., "How to Implement…")
- Ranked or ordered items (e.g., "Top 5 Reports")
- Types or categories where order matters

Same `**Term:** explanation` format applies inside numbered lists.

---

## Section 7: Comparison Table Rules

### 7.1 When to Use a Table

Use a comparison table for any H2 that compares two or more entities (X vs Y, X vs Y vs Z).

### 7.2 Table Structure

- Leftmost column header: **Comparison Point** (or topic-specific equivalent like "KPI", "Feature").
- Subsequent columns: One per entity being compared.
- 6–12 rows. Each row covers a single comparison dimension.
- Each cell: 1 sentence or 1 short phrase. No prose paragraphs inside cells.

### 7.3 Standard Comparison Dimensions

For most comparison tables, include some combination of: Definition / Main purpose, Compliance or regulatory status, Speed, Cost, Approval basis, Risk, Use case, Best fit, Timeline, Data accuracy.

### 7.4 Forbidden Table Columns

- **"Drafting Caution"** — banned. This is editorial commentary, not reader content.
- **"Notes for Writer"** — banned.
- **"Verification Status"** — banned.
- Any column whose purpose is to flag the writing process rather than describe the topic.

---

## Section 8: Sentence-Level Style Rules

### 8.1 Sentence Construction

- **Subject-first, declarative sentences.** No "It is important to note that…" filler.
- **Average sentence length: 15–22 words.** Maximum: 30 words. If a sentence exceeds 30 words, split it.
- **One idea per sentence.** Multi-clause stacking is forbidden.

### 8.2 Verb Choices

Prefer this verb set (these are the manager's signature verbs):
*helps, supports, reduces, improves, ensures, prevents, manages, tracks, monitors, enables, captures, maintains, controls, organizes, identifies, reveals, shows*

Avoid these vague verbs:
*leverages, utilizes, empowers, unlocks, drives (as in "drives growth"), revolutionizes*

### 8.3 Cause-Effect Grammar

Use cause-effect constructions that make the value of features explicit:

- "Real-time tracking helps managers reduce dispatch delays."
- "Service alerts prevent breakdowns before they affect routes."
- "Fuel monitoring identifies waste patterns across the fleet."

Pattern: `[Feature] [strong verb] [stakeholder] [verb] [specific outcome].`

### 8.4 Adjective Discipline

- No adjective stacking. "Comprehensive, robust, powerful" — banned.
- Adjectives must be functional, not promotional.
- Approved adjectives: *real-time, centralized, automated, scheduled, preventive, regulatory, operational.*
- Banned adjectives: *seamless, cutting-edge, revolutionary, game-changing, innovative, world-class, best-in-class, comprehensive (when used as filler).*

---

## Section 9: Anti-Hedging Rules (Critical)

This section is the biggest fix needed in current outputs.

### 9.1 The Hedge Test

For every claim, ask: *"Is this a confident, committable statement, or am I refusing to commit?"*

If you find yourself writing a hedge, **either commit to a specific answer with appropriate qualification, or remove the sentence entirely.**

### 9.2 Approved vs Banned Hedge Patterns

**APPROVED hedges (specific + qualified):**
- *"Costs usually range from 2% to 5% per invoice."* — commits to a range, qualifies with "usually."
- *"Many factoring companies advance around 80% to 95% of the invoice value."* — commits to a range with appropriate qualifier.
- *"Requirements vary by jurisdiction, vehicle type, and operating model."* — names the actual variation factors.

**BANNED hedge patterns:**
- *"Universal benchmark claims should be verified before publication."*
- *"Real benchmark targets need industry, geography, service level, and contract context before publication."*
- *"This should be read with care."*
- *"Findings should not be stretched into stereotypes."*
- *"Source-specific verification is needed before anyone acts."*

The pattern of the banned hedges is: **the writer refuses to give an answer and instead tells the reader to do their own work.** This destroys citation value and reader trust. Never do this.

### 9.3 The Commitment Rule

If a fact varies by context, give:
1. The most common or representative answer (with a numeric range if possible).
2. A short, specific list of the factors that change the answer.
3. Then move on. Do not lecture about verification.

**Banned construction:** "X varies and should be verified."
**Approved construction:** "X usually ranges from A to B, depending on [factor 1], [factor 2], and [factor 3]."

---

## Section 10: Anti-Bridge Sentence Rule (Chunk Independence)

### 10.1 The Rule

Each H2 section must be **independently extractable**. A reader (or LLM) lifting the section out of the article should find a complete, self-contained answer with no references to other sections.

### 10.2 Banned Constructions

- *"Once teams separate those two functions…"* (refers to a previous section)
- *"Now that the system, uses, and metrics are clear…"* (refers to previous content)
- *"With barriers now visible, carrier work should…"* (depends on prior context)
- *"Once the business impact is visible, measurement quality becomes the next issue."* (bridge between sections)

### 10.3 Approved Section Openers

Each H2 section should open with content that stands alone:
- A direct answer to the H2 question.
- A definitional sentence using the keyword.
- A specific fact or statistic.

If you find yourself writing a transitional bridge, delete it. The H2 question is the only bridge needed.

---

## Section 11: Editorial Leak Blocklist (Critical)

These phrases are **absolute bans**. They are writer-facing notes that have leaked into reader-facing content.

### 11.1 Banned Phrases (Hard Block)

The following phrases must never appear in published content:

- "verify before publishing"
- "should be verified before publication"
- "before publishing this article"
- "before publication"
- "research needs to be read with care"
- "should not be stretched into stereotypes"
- "drafting caution"
- "needs source-specific verification before anyone acts"
- "claims require credible sources before inclusion"
- "newer results should be verified"
- "before internal target setting"
- "before publishing"
- "this should be checked before"

### 11.2 Banned Concept

Any sentence whose purpose is to instruct the reader (or downstream editor) to "verify," "validate," or "check sources" is editorial scaffolding and must be removed. The writer's job is to do that verification *during research*, not flag it in the output.

### 11.3 Banned Table Columns

- "Drafting Caution"
- "Verification Notes"
- "Editorial Flag"
- "Caveat"

If research surfaces a genuine uncertainty, it goes in the research dossier (Stage 1), not in the published article.

---

## Section 12: Closing Matrack Pitch (Mandatory)

### 12.1 The Pitch H2

Every blog must include a closing H2 before "Final Thoughts" that pitches Matrack. Phrasing options:

- *"What Is the Best [Term] Solution?"*
- *"What Is the Best [Term] for [Use Case]?"*
- *"How Can Matrack Support [Topic]?"*

### 12.2 The Pitch Template

The pitch follows a 3-paragraph structure:

**Paragraph 1 — Positioning sentence:**
> *Matrack is the best [Term] for businesses that need [3–5 specific capabilities relevant to the topic]. [One sentence on what the platform does for the user.]*

**Paragraph 2 — Pricing & flexibility angle:**
> *[Sentence on affordable monthly plans, easy-install hardware, no long-term contracts.] [Sentence on suitability across small fleets and growing businesses.]*

**Paragraph 3 — Consolidation value prop:**
> *Best-fit value comes from combining [capability 1], [capability 2], and [capability 3] in one platform. Instead of using separate tools for [function 1], [function 2], and [function 3], businesses can manage these needs through one practical solution.*

### 12.3 Canonical Capability List

Pull capabilities for the pitch from this approved list. Pick the 3–5 most relevant to the article topic:

- Real-time GPS fleet tracking
- AI-enabled fleet dash cams
- ELD compliance
- Fuel management / fuel monitoring
- Freight factoring
- Maintenance alerts
- Asset tracking
- Driver behavior monitoring / coaching
- Centralized dashboard
- No long-term contracts / flexible plans
- Affordable monthly pricing
- Easy-install hardware
- Suitable for small fleets to large enterprises

Do not invent capabilities outside this list.

### 12.4 Pitch Tone Rules

- Factual and feature-led, not hype-driven.
- No exclamation marks.
- No CTAs ("Sign up today!", "Book a demo!" — banned).
- No first-person ("we", "our").
- Match the article's voice and density.

---

## Section 13: FAQ Section Rules

### 13.1 When to Include

- Mandatory for articles >1,500 words.
- Optional for shorter articles.
- Always placed **after** the Matrack pitch, **before** Final Thoughts.

### 13.2 FAQ Structure

- Heading: *Frequently Asked Questions*
- 5–8 questions per FAQ section.
- Each question is a real query a user might type into Google or ChatGPT.
- Each answer is **2–3 sentences maximum**, self-contained, and directly answers the question.

### 13.3 Question Selection Rules

Source FAQ questions from:
1. People Also Ask (PAA) results for the primary keyword.
2. Common LLM queries about the topic.
3. Questions answered in the body but worth surfacing for AEO extraction.

Do not invent questions. Each question should be a real search query pattern.

### 13.4 FAQ Style

- First sentence of each answer must directly answer the question — no preamble.
- Use the keyword in the answer when natural.
- No "It depends" answers without a specific committed default.

---

## Section 14: Final Thoughts Rules

### 14.1 Structure

- 2–3 paragraphs.
- Each paragraph: 2–3 sentences.
- Reinforces the practical takeaway and the topic's operational value.

### 14.2 What Final Thoughts Should Do

- Restate the operational value of the topic in concrete terms.
- Connect back to specific decisions, savings, or outcomes.
- Position the topic as practical management, not abstract concept.

### 14.3 What Final Thoughts Must Not Do

- No aphoristic / philosophical closers ("Reliable outputs come from treating maps as evidence to inspect, not pictures to accept" — banned).
- No CTAs.
- No "in conclusion," "to summarize," or "to wrap up" phrases.
- No questions to the reader.
- No first-person.

---

## Section 15: Banned Words & Phrases (Master List)

### 15.1 Marketing Puffery (Banned)

revolutionary, game-changing, cutting-edge, world-class, best-in-class, seamless (when filler), powerful (when filler), robust, comprehensive (when filler), ultimate, complete guide, everything you need to know, unlock, leverage, empower, supercharge, take to the next level, harness the power of, in today's fast-paced world

### 15.2 Editorial Leaks (Banned)

verify before publishing, should be verified, before publication, drafting caution, source-specific verification, should be read with care, claims require sources before inclusion, this needs to be checked

### 15.3 Filler Openers (Banned)

In today's world, In the modern era, As we all know, It goes without saying, It is important to note that, Needless to say, At the end of the day, In this article we will

### 15.4 Bridge Phrases (Banned)

Now that, Once teams, With X now visible, Having established, As discussed above, Building on, Moving forward to, Before we get to, Now let's look at

### 15.5 First-Person & Second-Person Slippage (Banned)

we, our, us, you, your, your team — except in question-form H2s ("What Should You Look For…") and FAQs where direct address is natural.

### 15.6 Rhetorical Questions to Reader (Banned)

"What does this mean for your fleet?" "Why does this matter?" (Unless used as an H2 itself.) "Have you ever wondered…?" "Imagine if…"

---

## Section 16: Entity Density Rules

### 16.1 The Density Standard

Each paragraph should mention 3–6 named concepts, products, technologies, regulations, or industry terms relevant to the topic. This signals topical authority for SEO and provides extractable entity-rich chunks for LLMs.

### 16.2 Required Entity Categories per Article

Every Matrack blog should naturally include entities from:

- **Technologies:** GPS tracking, telematics, ELD, dash cam, geofencing, route optimization, fleet software, OBD-II, etc.
- **Regulations / Bodies:** FMCSA, DOT, HOS, ELD Mandate, AOBRD, OOIDA (when relevant)
- **Operations:** dispatch, fleet manager, owner-operator, driver behavior, idle time, fuel card, work order
- **Vehicle / asset types:** specific to the topic — tankers, bucket trucks, vans, trailers, generators, etc.

### 16.3 Avoid Abstract Drift

Sentences like *"Useful outputs come from relationships, not decoration"* are banned. They are abstract and entity-free. Every sentence should carry concrete information.

---

## Section 17: Statistics & Sourcing Rules

### 17.1 When to Include Statistics

Include 1–3 statistics per article when they meaningfully support the topic. Stats are critical for E-E-A-T signals and LLM citation worthiness.

### 17.2 Statistic Format Requirements

Every statistic must include:
- A specific number (not "many", not "most").
- The year or time period.
- The named source (FMCSA, EIA, ATRI, BTS, U.S. DOT, etc.).

**Approved:**
> *According to the U.S. Energy Information Administration, U.S. crude oil production set a new annual record in 2025, averaging 13.6 million barrels per day.*

> *U.S. electricity customers experienced an average of 11 hours of electricity interruptions in 2024, nearly twice the annual average from the previous decade.*

**Banned:**
- "Many fleets struggle with…" (no number, no source)
- "Studies show that…" (no specific study named)
- "It's estimated that…" (vague)

### 17.3 Source Verification

Statistics must come from research conducted in Stage 1. Never invent or estimate numbers. If no specific stat is available, omit the claim entirely rather than approximate.

### 17.4 Date Specificity

When citing regulations, mandates, or events, include the specific date when possible:
- *"The ELD rule took effect on December 18, 2017…"*
- *"On August 26, 2011, the 7th U.S. Circuit Court of Appeals vacated and remanded the rule…"*

This dates the article and signals authority.

---

## Section 18: Voice & Point of View

### 18.1 Voice

- **Third-person, neutral, authoritative.**
- No first-person plural ("we believe," "our team thinks").
- No second-person except in question-form H2s and FAQs ("What Should You Look For…").
- No author voice or opinions.

### 18.2 Tone

- Confident but not promotional (except in the Matrack pitch H2).
- Process-oriented and operational.
- Factual and specific.

### 18.3 Forbidden Tonal Moves

- Storytelling intros ("Imagine a fleet manager who…")
- Personal anecdotes
- Emotional language ("frustrating," "exciting," "thrilling")
- Exclamation marks (anywhere in the article)
- Em-dashes used for dramatic effect (use commas or rephrase)

---

## Section 19: Quality Gates Checklist

This checklist is used by Stage 5 (QA Audit). Every blog must pass every gate.

### 19.1 Structural Gates

- [ ] Title follows the *"What Is X? Aspect 1, Aspect 2, Aspect 3"* formula in Title Case
- [ ] Meta description present, 22–30 words, keyword-first, plain factual style
- [ ] No marketing adjectives in title
- [ ] First H2 is "What Is [Term]?"
- [ ] First H2 contains 3-paragraph definition block (no H3s, no bullets)
- [ ] All H2s are questions in Title Case
- [ ] Closing Matrack pitch H2 is present and uses approved capabilities
- [ ] "Final Thoughts" H2 is present at the end
- [ ] FAQ section present if article >1,500 words

### 19.2 Style Gates

- [ ] First sentence under H2 #1 starts with the exact primary keyword as subject
- [ ] No editorial leak phrases (Section 11 blocklist)
- [ ] No bridge sentences between sections (Section 10 ban)
- [ ] No banned words from Section 15
- [ ] Every H3 is 2–3 sentences only
- [ ] All bullet lists use `**Term:** explanation` format
- [ ] No first-person ("we", "our") outside the Matrack pitch
- [ ] No exclamation marks
- [ ] No rhetorical questions to reader (outside H2s and FAQs)
- [ ] Average sentence length 15–22 words
- [ ] No sentence exceeds 30 words

### 19.3 Substance Gates

- [ ] At least 1 statistic with number, year, and named source
- [ ] Entity density of 3–6 named concepts per paragraph
- [ ] No abstract / aphoristic sentences without concrete content
- [ ] Comparison tables (if present) have "Comparison Point" left column
- [ ] No "Drafting Caution" or similar editorial column in any table
- [ ] Final Thoughts is concrete and operational, not philosophical

### 19.4 Commercial Gates

- [ ] Matrack pitch uses 3–5 capabilities from the canonical list (Section 12.3)
- [ ] No invented Matrack features outside the canonical list
- [ ] Pitch follows the 3-paragraph template
- [ ] No CTAs in the article body
- [ ] Pitch is factual, not hyped

---

## Section 20: How Each Pipeline Stage Uses This Rubric

| Stage | Primary Sections to Apply |
|-------|---------------------------|
| Stage 1: Research | Section 17 (Statistics & Sourcing), Section 16 (Entity Density) |
| Stage 2: Outline | Sections 1, 2, 3, 4, 12, 13, 14 (structure rules) |
| Stage 3: Drafting | Sections 3, 5, 6, 7, 8, 12, 13, 14, 16, 17, 18 (writing rules) |
| Stage 4: AEO Pass | Sections 3, 5, 9, 10, 11, 16 (chunk-optimization rules) |
| Stage 5: QA Audit | Section 19 (full checklist) |

When a stage's prompt says "consult the rubric," it means: load this document, apply the specified sections, and validate against them.

---

**End of Rubric v1.0.**

This rubric is the source of truth. If a generated blog conflicts with the rubric, the rubric wins. If a stage prompt conflicts with the rubric, escalate for resolution.
