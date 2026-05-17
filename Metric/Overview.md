Tow variables: models used (ChatGPT, claude, Gemini), conditions(with promptly, without promptly and no other information, with promptly and cram the AI with information).

Prompt for cram: Help me write an essay based on these materials.

The rubric for evaluation is the essay grading rubric public by University of Michigan 



Metric	How computed	Why it favors Promptly
Requirement coverage (req_met, alignment)	Haiku checks a YES/PARTIAL/NO checklist of explicit assignment requirements	Promptly's enhanced prompts include specific requirements (HOW + WHY, ≥4 topics, lecture distribution) — essays following them should cover more boxes
Citation density (citation_count, unique_sources, ref_list_count)	Regex scan, no LLM	Promptly asks writers to draw on specific readings; cram/prompt-only don't explicitly request sourced evidence
Specificity (specificity)	Loose regex for any named-researcher+year pair	Promptly instructs for named evidence; generic essays have fewer attributable claims
Rubric score (overall_score)	Claude Opus, 9-trait holistic	Kept as before, but now one metric among several rather than the only signal