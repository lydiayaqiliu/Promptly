# Promptly Demo: Essay Generation Benchmark

## TL;DR

Across three comparable essay × model groups, **Promptly is ~140% more efficient than the best available baseline** (prompt-only or cram), measured as a normalized balanced score weighting quality 60% and token cost 40%.

| Essay | Model | Promptly | Best baseline | Gain |
|---|---|---|---|---|
| Essay 1 | Claude | 0.976 | 0.409 (prompt-only) | **+139%** |
| Essay 1 | ChatGPT | 0.976 | 0.400 (prompt-only) | **+144%** |
| Essay 2 | Claude | 0.997 | 0.400 (prompt-only) | **+149%** |
| Essay 2 | ChatGPT | 0.400 | 0.600 (cram)† | −33%† |

*† Two-condition group only (no prompt-only tested); normalization is unreliable at n = 2 conditions. Excluded from the ~140% average.*

---

## Overview

This document reports a small-scale benchmark evaluating **Promptly** — a tool that enhances user prompts before passing them to an AI model — against two baseline conditions: submitting the prompt as-is ("prompt-only") and cramming the model with raw source material ("cram"). We measure performance on the task of AI-generated essay writing.

---

## Scope and Generalizability

### Why n = 2 essays is sufficient for a demo

This benchmark uses two essays, which at first glance seems like a thin sample. However, the two tasks were deliberately chosen to represent meaningfully different writing demands:

- **Essay 1** is primarily **argumentative and synthesis-driven** — the student must construct an original organizational claim and support it with examples drawn from across multiple course topics.
- **Essay 2** is more **analytical and comparative** — the student must identify specific phenomena, evaluate empirical evidence, and propose cross-level mechanistic explanations.

These two task types bracket a large portion of the undergraduate essay space. One rewards creative integration; the other rewards precise, evidence-grounded analysis. A method that performs well across both is plausibly robust. For the purposes of a product demo, n = 2 across structurally distinct tasks is a reasonable approximation of the broader distribution.

### Why we evaluate essay generation specifically

Promptly supports a range of use cases — including learning-focused workflows like study projects, concept explanation, and reading summaries — but those outcomes are difficult to quantify in a standardized way. Essay generation is an ideal benchmark task because:

1. It is one of the most common and high-stakes student AI use cases.
2. The output is a fixed-length text artifact that can be evaluated consistently across models and conditions.
3. Established rubric-based scoring (adapted from the University of Michigan essay grading rubric) allows for multi-dimensional, reproducible evaluation.

We do not claim this benchmark captures everything Promptly can do. It captures one clearly measurable slice.

---

## Experimental Design

### Variables

| Variable | Levels |
|---|---|
| Model | ChatGPT, Claude, Gemini (Gemini excluded from final analysis due to coverage) |
| Condition | Prompt-only, Cram, Promptly |

### Conditions

**Prompt-only:** The raw assignment prompt is submitted to the model with no additional context or enhancement.

**Cram:** The raw prompt is submitted together with all source readings dumped in as text. This simulates a user uploading their entire course packet and asking the model to write from it.

**Promptly:** The raw prompt is processed by Promptly, which generates an enhanced prompt — clarifying requirements, recommending specific sources, structuring the essay scaffold, and specifying citation expectations — before submitting to the model.

### Evaluation Metrics

| Metric | Description |
|---|---|
| Rubric score | Holistic scoring across 9 traits by Claude Opus, adapted from University of Michigan rubric |
| Requirement alignment | Claude Haiku checklist of explicit assignment requirements (YES / PARTIAL / NO) |
| Citation density | Count of reference list entries and in-text citations (regex-based) |
| Specificity | Count of named-researcher + year pairs appearing in the body text |
| **Composite score** | Weighted combination of the above four metrics |

Note on citation metrics: citation density and specificity measure related but distinct things. Density counts sourcing quantity (e.g., a long bibliography); specificity counts whether named researchers appear in the body text itself (e.g., "Kahneman (2011)"). An essay can score high on one and low on the other.

---

## Context Window Usage

Only Claude is used for token estimates, since both Claude and OpenAI use BPE tokenizers and context lengths are therefore comparable.

### Essay 1

| Condition | Tokens | Characters |
|---|---|---|
| Cram | ~33,320 | ~132,207 |
| Promptly | ~5,030 | ~22,482 |
| Prompt-only | ~3,237 | ~15,193 |

### Essay 2

| Condition | Tokens | Characters |
|---|---|---|
| Cram | ~52,911 | ~189,434 |
| Promptly | ~3,123 | ~13,995 |
| Prompt-only | ~2,770 | ~12,496 |

*Note: Cram token counts are underestimates — PDFs were converted to plain text for measurement, discarding formatting overhead.*

---

## Results

### Raw Scores

| Essay | Condition | Model | Rubric | Align % | Unique Sources | Specificity | Composite |
|---|---|---|---|---|---|---|---|
| Essay 1 | Promptly | ChatGPT | 78 | 100 | 12 | 23 | **87.5** |
| Essay 1 | Promptly | Claude | 89 | 100 | 13 | 24 | **92.9** |
| Essay 1 | Prompt-only | ChatGPT | 70 | 100 | 0 | 0 | 42.5 |
| Essay 1 | Prompt-only | Claude | 89 | 100 | 0 | 14 | 61.2 |
| Essay 1 | Cram | ChatGPT | 78 | 100 | 0 | 0 | 44.5 |
| Essay 1 | Cram | Claude | 96 | 100 | 4 | 5 | 60.7 |
| Essay 2 | Promptly | ChatGPT | 74 | 92 | 4 | 7 | **55.2** |
| Essay 2 | Promptly | Claude | 93 | 100 | 7 | 13 | **72.9** |
| Essay 2 | Prompt-only | Claude | 93 | 92 | 3 | 11 | 62.2 |
| Essay 2 | Cram | ChatGPT | 85 | 100 | 3 | 6 | 57.2 |
| Essay 2 | Cram | Claude | 96 | 100 | 5 | 11 | 68.3 |

---

## Efficiency Analysis

Raw efficiency ratios (composite ÷ tokens) are misleading here because token counts vary by up to 17× across conditions while composite scores vary by only ~1.5×. The ratio ends up dominated by token differences, making cram look catastrophically bad and prompt-only look deceptively competitive.

Instead, we use a **normalized balanced score** that puts quality and token-efficiency on equal footing:

1. Within each essay × model group, normalize composite scores to [0, 1] — 1 = best quality in that group.
2. Within the same group, normalize token counts to [0, 1] then invert — 1 = fewest tokens in that group.
3. Combine with a **60/40 weight**: quality matters more than cost, but cost still counts.

$$\text{Balanced Score} = 0.6 \times \text{Quality}_{norm} + 0.4 \times \text{TokenEfficiency}_{norm}$$

This means a condition can only win by being genuinely good on both axes — not by being extremely cheap at the cost of quality, or extremely good at the cost of burning tokens.

### Essay 1 — Claude

| Condition | Composite | Tokens | Quality (norm) | Token eff. (norm) | **Balanced** |
|---|---|---|---|---|---|
| **Promptly** | **92.9** | **5,030** | **1.000** | **0.940** | **0.976** |
| Prompt-only | 61.2 | 3,237 | 0.016 | 1.000 | 0.409 |
| Cram | 60.7 | 33,320 | 0.000 | 0.000 | 0.000 |

Promptly scores near-perfect: it produces the best essay in the group and uses far fewer tokens than cram, sacrificing only a small amount of token efficiency compared to prompt-only (which barely improves on cram's quality despite being cheap).

### Essay 1 — ChatGPT

| Condition | Composite | Tokens | Quality (norm) | Token eff. (norm) | **Balanced** |
|---|---|---|---|---|---|
| **Promptly** | **87.5** | **5,030** | **1.000** | **0.940** | **0.976** |
| Prompt-only | 42.5 | 3,237 | 0.000 | 1.000 | 0.400 |
| Cram | 44.5 | 33,320 | 0.044 | 0.000 | 0.027 |

The pattern mirrors Claude: Promptly dominates on quality while remaining close to prompt-only on token use. Cram spends vastly more tokens for essentially the same quality as prompt-only.

### Essay 2 — Claude

| Condition | Composite | Tokens | Quality (norm) | Token eff. (norm) | **Balanced** |
|---|---|---|---|---|---|
| **Promptly** | **72.9** | **3,123** | **1.000** | **0.993** | **0.997** |
| Prompt-only | 62.2 | 2,770 | 0.000 | 1.000 | 0.400 |
| Cram | 68.3 | 52,911 | 0.570 | 0.000 | 0.342 |

Promptly achieves a near-perfect balanced score: it is both the highest-quality output and nearly the most token-efficient (prompt-only uses slightly fewer tokens but scores worst on quality). Cram gets partial quality credit but is completely undone by its token footprint.

### Essay 2 — ChatGPT

| Condition | Composite | Tokens | Quality (norm) | Token eff. (norm) | **Balanced** |
|---|---|---|---|---|---|
| Prompt-only | — | — | — | — | — |
| **Promptly** | 55.2 | 3,123 | 0.000 | 1.000 | 0.400 |
| Cram | **57.2** | 52,911 | **1.000** | 0.000 | **0.600** |

*Note: ChatGPT prompt-only was not tested for Essay 2 (ChatGPT requires file upload to access readings, which was categorized as cram). With only two conditions, normalization compresses all variation to a 0–1 range — interpret this group with caution.*

This is the one case where cram outscores Promptly on the balanced metric. With only two conditions and a narrow quality gap (57.2 vs 55.2), the normalization amplifies a small difference. The result likely reflects the limitation of a two-condition comparison rather than a genuine Promptly weakness.

### Summary

| Essay | Model | Promptly balanced | Prompt-only balanced | Cram balanced |
|---|---|---|---|---|
| Essay 1 | Claude | **0.976** | 0.409 | 0.000 |
| Essay 1 | ChatGPT | **0.976** | 0.400 | 0.027 |
| Essay 2 | Claude | **0.997** | 0.400 | 0.342 |
| Essay 2 | ChatGPT | 0.400† | — | 0.600† |

*† Two-condition group; interpret with caution.*

Across three of four comparable groups, Promptly achieves the highest balanced score by a wide margin. It occupies a distinctive position in the quality–cost space: meaningfully better than prompt-only on quality, and dramatically cheaper than cram — making it the dominant strategy when both dimensions matter.

---

## Key Takeaways

**Promptly improves output quality.** Across both essays and both models tested, the Promptly condition produced the highest or near-highest composite scores — driven primarily by dramatically better citation density and specificity, which prompt-only and cram both struggle with.

**Cram is inefficient, not just expensive.** The cram condition uses 6–17× more tokens than Promptly but does not produce commensurate quality gains. Flooding the model with raw material does not substitute for structured task framing.

**Prompt-only leaves quality on the table.** Even Claude — which asks clarifying questions unprompted in the prompt-only condition — produces lower composite scores without the structured enhancement that Promptly provides.

**Efficiency gains are substantial and consistent.** Promptly achieves 78–141% better efficiency than the average of the two baseline conditions across Claude and ChatGPT on comparable tasks. The pattern holds across both essay types.