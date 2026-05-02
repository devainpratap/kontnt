export const workflowSteps = [
  "semantic-map",
  "outline",
  "approve-outline",
  "draft",
  "final-optimize"
] as const;

export const jobStatuses = [
  "draft",
  "semantic-map-ready",
  "outline-ready",
  "outline-approved",
  "draft-ready",
  "final-ready",
  "manual-input-required",
  "error"
] as const;

export const stepStatuses = [
  "idle",
  "running",
  "completed",
  "manual-input-required",
  "failed"
] as const;

