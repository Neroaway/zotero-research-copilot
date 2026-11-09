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
    query: "research problem task dataset source cohort input output supervision annotation label train test split setting challenge objective",
    sections: ["abstract", "intro"],
    guidance: "Give a faithful rendering of the supplied abstract under an abstract subheading when available. Then explain the precise problem and its assumptions. Under a data-and-task subheading, distinguish data source, sample or split, inputs, targets, supervision, and evaluation task.",
  },
  {
    title: "Motivation",
    query: "motivation prior methods assumptions limitation failure why challenge",
    sections: ["intro", "related"],
    guidance: "Connect a documented shortcoming of a named prior approach to a specific design choice. Explain why that choice would address the failure and what result would test the explanation.",
  },
  {
    title: "Core Contributions",
    query: "contributions novelty novel proposed first difference prior baseline",
    sections: ["abstract", "intro", "related"],
    guidance: "Give a one-sentence takeaway about the paper's actual contribution. For each major contribution, identify what changes relative to a named prior approach, which components it reuses, and the strongest evidence for its claimed benefit.",
  },
  {
    title: "Methodology",
    query: "architecture module pipeline algorithm encoder decoder input output tensor attention annotation filtering protocol",
    sections: ["method"],
    preferredKinds: ["caption"],
    guidance: "Under ### 机制流程 for Chinese or ### Mechanism Flow for English, reconstruct 3–4 ordered steps. At each step name the input, operation, output destination, and role in the claimed mechanism. Specify shapes and stages only where supported. Separate training from inference when they differ. For a dataset or benchmark, trace collection, filtering, labeling, splits, and evaluation instead.",
  },
  {
    title: "Mathematical Formulation",
    query: "equation loss objective optimization regularization reward symbols probability complexity",
    sections: ["method", "appendix"],
    preferredKinds: ["math"],
    guidance: "Render the essential formula or objective in TeX when legible. Define the symbols, dimensions, assumptions and loss terms, and connect them to the relevant operation in the method. Explain what changing a key term would do when supported, and flag unclear extraction or unreported values.",
  },
  {
    title: "Experimental Design",
    query: "datasets metrics baselines split evaluation experimental settings protocol score performance main results",
    sections: ["experiments", "results"],
    preferredKinds: ["table", "caption"],
    guidance: "State the split, metric and units, strongest reported baseline, and conditions needed for a fair comparison. Under ### 关键结果 for Chinese or ### Key Results for English, report the 3–6 most decisive numbers, with baseline, proposed score, and correctly labeled difference where available. Use a compact cited table for three or more comparable entries. Explain what the comparison establishes and which claim remains untested.",
  },
  {
    title: "Ablation Studies",
    query: "ablation component sensitivity remove without w/o controls table variance worse unstable tradeoff",
    sections: ["ablation", "results"],
    preferredKinds: ["table", "caption"],
    guidance: "Trace each decisive ablation from the changed component and matched control to the measured score and effect size. Check what was held fixed. Explain which mechanism the result supports and what alternative explanation survives. Include negative, unstable, or cost-increasing results when supported.",
  },
  {
    title: "Limitations",
    query: "limitation failure bias tradeoff generalization discussion domain leakage confound",
    sections: ["limitations", "conclusion", "results"],
    guidance: "Separate reported limitations from inferred threats to validity. For the central conclusions, connect the evidence to the exact supported setting, the assumption or confound behind the boundary, and a concrete untested generalization. Explain how the failure mode would affect the result.",
  },
  {
    title: "Reproduction Guide",
    query: "implementation training epochs batch learning rate optimizer seed hardware hyperparameters public code preprocessing",
    sections: ["experiments", "method", "appendix"],
    guidance: "Outline the smallest runnable reproduction, from data and splits through training, inference, metrics, and the key baseline or ablation. Cite reported settings, name details that still need verification, and state which measured result would count as a successful rerun.",
  },
  {
    title: "Open Questions",
    query: "open questions future work unresolved generalization hypothesis limitation conclusion sensitivity variance",
    sections: ["conclusion", "limitations", "ablation"],
    guidance: "Identify the highest-impact unresolved question. Under a level-three Research Improvements heading, give up to three ranked **[Research proposal]** items. Each cites the paper evidence motivating it and includes the gap, a specific change or test, a matched control or evaluation condition, a readout, and a result that would weaken the hypothesis. Use **[Evidence unavailable]** and name the source to check when a proposal lacks a grounded starting point.",
  },
];
