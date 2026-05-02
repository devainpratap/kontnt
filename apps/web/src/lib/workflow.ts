import type { JobStepRecord, WorkflowStep } from "@semantic-seo/shared";

export const workflowStepOrder: WorkflowStep[] = [
  "semantic-map",
  "outline",
  "approve-outline",
  "draft",
  "final-optimize"
];

export const workflowStepMeta: Record<
  WorkflowStep,
  {
    phase: string;
    label: string;
    description: string;
    emptyState: string;
  }
> = {
  "semantic-map": {
    phase: "Analysis",
    label: "Semantic map",
    description: "Turn the brief into search intent, entity coverage, topic gaps, and risk notes.",
    emptyState: "Run semantic analysis after the intake has been saved."
  },
  outline: {
    phase: "Outline",
    label: "Outline",
    description: "Generate the article structure with H2s, H3s, FAQs, and product integration opportunities.",
    emptyState: "Generate the outline after the semantic map is ready."
  },
  "approve-outline": {
    phase: "Approval",
    label: "Approved outline",
    description: "Review, edit, and lock the outline before the long-form draft step.",
    emptyState: "Approve the outline after the generated structure looks right."
  },
  draft: {
    phase: "Drafting",
    label: "Draft",
    description: "Expand the approved structure into a full article draft.",
    emptyState: "Generate the draft once the outline has been approved."
  },
  "final-optimize": {
    phase: "Optimization",
    label: "Final optimized article",
    description: "Refine structure, coverage, and readability before export.",
    emptyState: "Run final optimization after the draft is ready."
  }
};

export const workflowPhases = [
  {
    key: "intake",
    title: "Intake",
    description: "Capture the article brief, source URLs, entities, and editorial constraints."
  },
  {
    key: "analysis",
    title: "Analysis",
    description: "Generate semantic research and compare the brief against the SERP."
  },
  {
    key: "approval",
    title: "Outline approval",
    description: "Shape the structure and keep the human approval gate before drafting."
  },
  {
    key: "drafting",
    title: "Drafting and export",
    description: "Generate the article, optimize it, and keep the final Markdown local."
  }
] as const;

export function getStepRecord(steps: JobStepRecord[], stepName: WorkflowStep) {
  return steps.find((step) => step.stepName === stepName);
}

export function getCurrentStep(steps: JobStepRecord[]) {
  return workflowStepOrder.find((stepName) => {
    const status = getStepRecord(steps, stepName)?.status ?? "idle";
    return status !== "completed";
  });
}
