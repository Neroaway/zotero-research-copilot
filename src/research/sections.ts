import type { BlockKind, Section } from "../paper/types.ts";

interface AnalysisSection {
  title: string;
  query: string;
  sections: readonly Section[];
  preferredKinds?: readonly BlockKind[];
  guidance: string;
}

export const ANALYSIS_SECTIONS: readonly AnalysisSection[] = [
  {
    title: "Research Problem",
    query: "research problem task data input output supervision label setting challenge objective",
    sections: ["abstract", "intro"],
    guidance: "Define the task, input, target or output, and assumptions. Identify the data source and supervision when known. Preserve the authors' problem framing.",
  },
  {
    title: "Motivation",
    query: "motivation prior methods assumptions limitation failure why challenge",
    sections: ["intro", "related"],
    guidance: "Connect a specific shortcoming of prior approaches to a design choice in this paper. Distinguish reported shortfalls from your explanation.",
  },
  {
    title: "Core Contributions",
    query: "contributions novelty novel proposed first difference prior baseline",
    sections: ["abstract", "intro", "related"],
    guidance: "Separate authors' contribution claims, standard components, and the actual difference from a named prior approach. Indicate the strongest evidence for that difference.",
  },
  {
    title: "Methodology",
    query: "architecture module pipeline algorithm encoder decoder input output tensor attention annotation filtering protocol",
    sections: ["method"],
    preferredKinds: ["caption"],
    guidance: "Under a level-three Mechanism Flow heading, reconstruct 3–4 ordered steps with the input, operation, and destination of the output. For a benchmark or dataset, trace collection, filtering, labeling, splits, and evaluation as applicable. Explain training and inference separately when they differ.",
  },
  {
    title: "Mathematical Formulation",
    query: "equation loss objective optimization regularization reward symbols probability complexity",
    sections: ["method", "appendix"],
    preferredKinds: ["math"],
    guidance: "Render the essential formula or objective in TeX when legible. Define terms, dimensions, and what the optimization controls. Flag ambiguous glyphs and details absent from the excerpts.",
  },
  {
    title: "Experimental Design",
    query: "datasets metrics baselines split evaluation experimental settings protocol score performance main results",
    sections: ["experiments", "results"],
    preferredKinds: ["table", "caption"],
    guidance: "State the data split, metric, strongest reported baseline, and comparison conditions. Under a level-three Key Results heading, cite the 3–6 most informative numbers when available. Use a compact table with a citation on each row for three or more comparable entries. Explain what the strongest comparison establishes under that protocol.",
  },
  {
    title: "Ablation Studies",
    query: "ablation component sensitivity remove without w/o controls table variance worse unstable tradeoff",
    sections: ["ablation", "results"],
    preferredKinds: ["table", "caption"],
    guidance: "Trace component change to result and infer which mechanism it tests. Check whether the data, budget, and other components are held fixed. Include a negative, unstable, or cost-increasing result when the excerpts support one.",
  },
  {
    title: "Limitations",
    query: "limitation failure bias tradeoff generalization discussion domain leakage confound",
    sections: ["limitations", "conclusion", "results"],
    guidance: "Separate reported limitations from inferred threats to validity. Tie each important conclusion to the setting it supports and name any alternative explanation or untested generalization.",
  },
  {
    title: "Reproduction Guide",
    query: "implementation training epochs batch learning rate optimizer seed hardware hyperparameters public code preprocessing",
    sections: ["experiments", "method", "appendix"],
    guidance: "List the minimum reproducible steps in order with reported settings and evidence. Separate details that need verification before a comparable rerun from settings explicitly given by the paper.",
  },
  {
    title: "Open Questions",
    query: "open questions future work unresolved generalization hypothesis limitation conclusion sensitivity variance",
    sections: ["conclusion", "limitations", "ablation"],
    guidance: "Identify the highest-impact unresolved question. Under a level-three Research Improvements heading, give up to three ranked **[Research proposal]** items. Each cites the paper evidence motivating it and includes the gap, a specific change or test, a matched control or evaluation condition, a readout, and a result that would weaken the hypothesis. Use **[Evidence unavailable]** and name the source to check when a proposal lacks a grounded starting point.",
  },
];
