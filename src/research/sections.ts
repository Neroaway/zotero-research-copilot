import type { Section } from "../paper/types.ts";

export const ANALYSIS_SECTIONS = [
  { title: "Research Problem", query: "research problem task motivation challenge gap objective", sections: ["abstract", "intro"] },
  { title: "Motivation", query: "motivation prior methods assumptions limitation failure why challenge", sections: ["intro", "related"] },
  { title: "Core Contributions", query: "contributions novelty novel proposed first difference prior", sections: ["abstract", "intro", "related"] },
  { title: "Methodology", query: "architecture module pipeline algorithm encoder decoder input output tensor attention", sections: ["method"] },
  { title: "Mathematical Formulation", query: "equation loss objective optimization regularization reward symbols probability", sections: ["method"] },
  { title: "Experimental Design", query: "datasets metrics baselines split evaluation experimental settings protocol", sections: ["experiments", "results"] },
  { title: "Ablation Studies", query: "ablation component sensitivity remove without w/o controls table variance", sections: ["ablation", "results"] },
  { title: "Limitations", query: "limitation failure bias tradeoff generalization discussion domain", sections: ["limitations", "conclusion"] },
  { title: "Reproduction Guide", query: "implementation training epochs batch learning rate optimizer seed hardware hyperparameters", sections: ["experiments", "method"] },
  { title: "Open Questions", query: "open questions future work unresolved generalization hypothesis limitation conclusion", sections: ["conclusion", "limitations"] },
] as const satisfies ReadonlyArray<{ title: string; query: string; sections: readonly Section[] }>;
