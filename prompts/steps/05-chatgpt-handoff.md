---
name: chatgpt-handoff
version: 1
description: Manual handoff wrapper for ChatGPT.com when local Codex generation is unavailable.
inputs:
  - step_name
  - prompt
---

# ChatGPT.com Handoff

Step:

{{STEP_NAME}}

Paste the prompt below into ChatGPT.com and save the response back into the matching output file in this job.

## Prompt

{{PROMPT}}
