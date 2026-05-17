"""
Batch essay evaluator — four metric families:

  1. LLM rubric score     — 9-trait holistic grade (existing, kept)
  2. Requirement coverage — per-assignment checklist, YES/PARTIAL/NO per item
  3. Prompt-essay alignment — % of assignment requirements addressed (derived from #2)
  4. Citation density      — in-text citation count, unique sources, reference list size (automatic)
  5. Specificity           — unique named-researcher mentions (automatic, proxy for
                             engagement with course material vs. generic claims)

Reads ANTHROPIC_API_KEY from .env at the project root (one level above Metric/).
"""

import csv
import os
import re
import sys

import anthropic
from dotenv import load_dotenv

# ── Load .env ─────────────────────────────────────────────────────────────────
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(_PROJECT_ROOT, ".env"))

# ── LLM rubric prompt ─────────────────────────────────────────────────────────
SYSTEM_PROMPT = """Act as an expert essay grader and judge. Your goal is to evaluate the provided essay objectively, rigorously, and analytically. Do not be overly complimentary. Be highly critical and constructive. You are evaluating this for a College Mind class.

Please score the essay based on different essay prompt and context in the following section:
Essay1: Autumn quarter of Mind challenges the naïve impression that our subjective experience of reality is a veridical reflection of the external world. By introducing a wide range of phenomena that illustrate the constructive nature of experience — perceptual, conceptual, affective, social, and cultural — the lectures and readings engage students in analyzing the mind's role in the construction of our realities. In particular, we consider our subjective awareness of and introspective access to the mental processes that shape reality for us and the bottom-up and top-down control of information processing in generating that reality. We also examine the dynamic nature of mind — how our constructed realities emerge and change over time and the role of nature and nurture in their development across a variety of time scales, exploring processes that unfold over the course of milliseconds as well as those that unfold over millennia.
    Essay1 prompt given to the writer: How and Why does the mind "go beyond the information given"?

Essay2: The primary goal of Mind Winter quarter is to understand the different kinds of
mechanisms that can be used to explain psychological and behavioral phenomena.
We have discussed a variety of psychological and behavioral phenomena and considered
mechanisms that operate on different levels of analysis. Some mechanisms were
described at a biological level of analysis (e.g., in terms of genetic or neural
underpinnings), others were described at a psychological level of analysis (e.g., in terms
of cognitive, affective, or behavioral processes), and still other mechanisms work at the
level of social and/or cultural organization (e.g., social drivers of the effect).
Drawing on the readings and lecture (explicitly and specifically to the extent possible),
identify two different phenomena (the "what") that each had mechanisms (the "why" and
"how") described at a particular level of analysis (biological, psychological, or social).
Suggest how understanding of each phenomenon could be enriched by testing
mechanisms of the phenomenon at another level of analysis.
In organizing your paper, it is important to clearly 1) identify each of the 2 phenomena
you have chosen, 2) describe the specific theory or mechanism(s) proposed in the
reading or lecture and how it operates to explain the phenomenon, being sure that the
level of explanation is apparent, and 3) evaluate the evidence that supports the theory.
Then for each of the phenomena, discuss how examining factors that operate at a
different level of analysis could further our understanding of the phenomenon.
Note that the 2 phenomena you choose must come from 2 different weeks of the course.
In considering these examples it is critical that you connect your presentation and
discussion to a larger, overarching claim about scientific explanation and levels of
analysis. In addition to in-text citations, be sure to include a References list at the end
of the paper, using APA Style.

## Grading Rubric

Score each trait 3 (Excellent), 2 (Adequate), or 1 (Poor) using the descriptors below.

### 1. Title, Introduction, Conclusion
3 — Title includes both subject and a hint about the thesis or point of view; engaging introduction that accurately prepares the reader for the body paragraphs; thought-provoking conclusion that ties everything together and takes the thesis further.
2 — Most but not all qualities of Excellent; there may be roughness or confusion in the introduction or conclusion.
1 — No title; introduction and/or conclusion seem to have little to do with the body of the essay.

### 2. Thesis/Focus
3 — Responds to the assignment with a clear argumentative thesis in the first paragraph that continues to be the focus throughout the paper.
2 — Has a clearly stated argumentative thesis that the paper basically focuses on.
1 — Thesis is implied or absent, or is stated but the paper does not connect back to it.

### 3. Organization
3 — One main idea per paragraph, good use of transitions, clear topic sentences, smooth connections between paragraphs; if an order is set in the introduction it is followed.
2 — Mostly one idea per paragraph, some transitions, mostly clear topic sentences, okay connections between paragraphs.
1 — Many ideas per paragraph, missing topic sentences, abrupt transitions, and/or missing or rough connections between paragraphs.

### 4. Development — Support
3 — Uses specific, concrete, relevant details, examples, evidence and numerous references to source material to substantiate and explain the thesis.
2 — Uses support, but it may be insufficient in some areas, or connections between evidence and ideas might not be clear.
1 — Lacks sufficient details and examples to support ideas; has insufficient or irrelevant evidence.

### 5. Development — Analysis
3 — Explains connections between evidence and main ideas thoughtfully and thoroughly; makes connections explicit; discusses implications, relevance, or significance.
2 — Mostly explains connections between ideas and evidence, although explanation may be incomplete or missing in some paragraphs; little discussion of facts and info.
1 — Does not clearly explain connections between evidence and ideas; does not elaborate beyond basic or obvious conclusions; analysis is too general or brief to be convincing.

### 6. Sentence Craft & Style
3 — Demonstrates excellent use of language: precisely chosen words, complex and varied sentence structure, appropriate tone and style.
2 — Adequate use of language, although some words may be vague or imprecise; sentence structure may be simple or awkward in spots; mostly appropriate tone and style.
1 — Vague and abstract language; words misused; sentences may be monotonous or choppy; tone or style may be inappropriate for the assignment.

### 7. Grammar and Spelling
3 — Almost entirely free of spelling, punctuation and grammatical errors (one per page or fewer).
2 — Contains a few errors which may distract the reader but not impede meaning (about 2–3 errors per page).
1 — Frequent or extensive errors in grammar, punctuation, or spelling (more than 4 errors per page).

### 8. Citations & References
Apply the citation style required by the essay's assignment (MLA for Essay1, APA for Essay2).
3 — Correctly formatted in-text citations and reference list with few or no errors; signal phrases used smoothly.
2 — Mostly cites correctly but does not introduce citations smoothly, or uses citation format inaccurately; reference list has more than a few errors.
1 — Missing many in-text citations; missing reference list; reference list contains only URLs or has other significant omissions or errors.

### 9. Hallucination
Judge accuracy using your knowledge of the field. Consider whether the essay contains false or misleading information and whether claims are supported by evidence.
3 — No false or misleading information; all claims are supported by evidence.
2 — Some minor inaccuracies or unsupported claims; generally reliable.
1 — Significant false or misleading information; claims are not supported by evidence.

## Output format

Respond with exactly this structure and nothing else:
Title, Introduction, Conclusion: <1–3>
Thesis/Focus: <1–3>
Organization: <1–3>
Development - Support: <1–3>
Development - Analysis: <1–3>
Sentence Craft & Style: <1–3>
Grammar and Spelling: <1–3>
Citations & References: <1–3>
Hallucination: <1–3>
Total: <sum>/27
Overall Score: <round(sum/27*100)>/100
"""

# ── Requirement checklists (per essay number) ─────────────────────────────────
REQUIREMENTS = {
    1: [
        "Has a clear organizational thesis or argumentative claim in the introduction",
        "Explicitly addresses HOW (the mechanism) by which the mind goes beyond the information given",
        "Explicitly addresses WHY (the function or purpose) the mind goes beyond the information given",
        "Draws evidence from at least 4 distinct weekly lecture topics",
        "Includes at least 2 topics from the first four lectures (e.g., visual perception, limits of awareness, concepts & categorization, long-term memory)",
        "Includes at least 2 topics from the last five lectures (e.g., changing realities, evolutionary biases, social construction of reality, development of social categories)",
    ],
    2: [
        "Identifies 2 distinct psychological or behavioral phenomena by name",
        "Describes the specific mechanism for each phenomenon at a named level of analysis (biological, psychological, or social)",
        "For each phenomenon, proposes how cross-level analysis would further understanding",
        "The 2 phenomena are drawn from 2 different weeks of the course",
        "Derives an overarching claim about scientific explanation and levels of analysis",
        "Includes an APA-formatted References list",
    ],
}

REQUIREMENT_SYSTEM_PROMPT = """You are an essay requirement checker.
For each numbered requirement, respond with exactly one of:
[N]: YES      — fully and clearly addressed
[N]: PARTIAL  — partially addressed or implied but not explicit
[N]: NO       — not addressed

After listing all requirements, output one final line:
Requirements Met: X/N
where X = (YES count × 1) + (PARTIAL count × 0.5), N = total requirements.

Output nothing else — no prose, no explanation."""

# ── Trait definitions ─────────────────────────────────────────────────────────
TRAITS = [
    ("Title, Introduction, Conclusion", "tic"),
    ("Thesis/Focus",                    "thesis"),
    ("Organization",                    "organization"),
    ("Development - Support",           "dev_support"),
    ("Development - Analysis",          "dev_analysis"),
    ("Sentence Craft & Style",          "sentence_craft"),
    ("Grammar and Spelling",            "grammar"),
    ("Citations & References",          "citations"),
    ("Hallucination",                   "hallucination"),
]

CSV_FIELDS = (
    ["essay_num", "condition", "model"]
    + [key for _, key in TRAITS]
    + ["total", "overall_score"]
    + ["req_met", "alignment"]
    + ["citation_count", "unique_sources", "ref_list_count", "specificity"]
    + ["composite_score"]
    + ["rubric_raw", "req_raw"]
)

# ── Composite score: equal weight across all four metric families ─────────────
# Each component is normalised to 0–100 before averaging:
#   overall_score  — already 0–100
#   alignment      — already 0–100
#   unique_sources — capped at 15  (≥15 unique sources → 100%)
#   specificity    — capped at 25  (≥25 named-researcher mentions → 100%)
UNIQUE_CAP = 15
SPEC_CAP   = 25


def compute_composite(row: dict) -> str:
    try:
        rubric    = float(row["overall_score"])
        alignment = float(row["alignment"])
        unique    = min(float(row["unique_sources"]) / UNIQUE_CAP, 1.0) * 100
        spec      = min(float(row["specificity"])    / SPEC_CAP,   1.0) * 100
        score = (rubric + alignment + unique + spec) / 4
        return str(round(score, 1))
    except (ValueError, TypeError):
        return "N/A"

# ── Config ────────────────────────────────────────────────────────────────────
METRIC_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_CSV = os.path.join(METRIC_DIR, "evaluation_results.csv")

FILE_PATTERN = re.compile(
    r"^Essay(\d+)-(promptly|prompt-only|cram)-(.+)\.txt$", re.IGNORECASE
)
CONDITIONS = ("promptly", "prompt-only", "cram")


# ── Discovery ─────────────────────────────────────────────────────────────────
def discover_essays(directory: str) -> list[dict]:
    entries = []
    for filename in sorted(os.listdir(directory)):
        m = FILE_PATTERN.match(filename)
        if not m:
            continue
        entries.append({
            "filename": filename,
            "path": os.path.join(directory, filename),
            "essay_num": int(m.group(1)),
            "condition": m.group(2).lower(),
            "model": m.group(3),
        })
    condition_order = {c: i for i, c in enumerate(CONDITIONS)}
    entries.sort(key=lambda e: (e["essay_num"], condition_order.get(e["condition"], 99)))
    return entries


# ── Metric 1: LLM rubric score ────────────────────────────────────────────────
def evaluate_rubric(essay_text: str, essay_num: int, client: anthropic.Anthropic) -> dict:
    response = client.messages.create(
        model="claude-opus-4-7",
        max_tokens=300,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content":
            f"This is Essay{essay_num}. Use the Essay{essay_num} course context and prompt when grading.\n\nEssay text:\n\n{essay_text}"}],
    )
    raw = response.content[0].text.strip()

    scores = {}
    for label, key in TRAITS:
        m = re.search(re.escape(label) + r"[:\s]+([1-3])", raw)
        scores[key] = m.group(1) if m else "N/A"

    m = re.search(r"Total[:\s]+(\d+)\s*/\s*27", raw, re.IGNORECASE)
    scores["total"] = m.group(1) if m else "N/A"

    m = re.search(r"Overall Score[:\s]+(\d+(?:\.\d+)?)\s*/\s*100", raw, re.IGNORECASE)
    scores["overall_score"] = m.group(1) if m else "N/A"

    scores["rubric_raw"] = raw
    return scores


# ── Metric 2 & 3: Requirement coverage + alignment ───────────────────────────
def check_requirements(essay_text: str, essay_num: int, client: anthropic.Anthropic) -> dict:
    reqs = REQUIREMENTS.get(essay_num)
    if not reqs:
        return {"req_met": "N/A", "alignment": "N/A", "req_raw": ""}

    req_list = "\n".join(f"{i + 1}. {r}" for i, r in enumerate(reqs))
    user_msg = (
        f"Essay{essay_num} assignment requirements:\n{req_list}\n\nEssay text:\n\n{essay_text}"
    )
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=200,
        system=REQUIREMENT_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_msg}],
    )
    raw = response.content[0].text.strip()

    yes_count = len(re.findall(r"\[\d+\]:\s*YES", raw, re.IGNORECASE))
    partial_count = len(re.findall(r"\[\d+\]:\s*PARTIAL", raw, re.IGNORECASE))
    total = len(reqs)
    score = yes_count + partial_count * 0.5

    return {
        "req_met": f"{score}/{total}",
        "alignment": str(round(score / total * 100)) if total else "N/A",
        "req_raw": raw,
    }


# ── Metric 4: Citation density (automatic) ───────────────────────────────────
def count_citations(essay_text: str) -> dict:
    """
    Counts APA/MLA in-text citations and reference-list entries.

    Handles:
      (Author, Year)             — single author parenthetical
      (Author & Author, Year)    — two-author parenthetical
      (Author et al., Year)      — et al. parenthetical
      Author (Year)              — narrative single
      Author et al. (Year)       — narrative et al.
      Author & Author (Year)     — narrative two-author
    """
    # Any parenthetical block that contains at least one capital-letter word and a 4-digit year
    paren = re.findall(r"\([^)]*[A-Z][a-zA-Z\-]+[^)]*\b(19|20)\d{2}\b[^)]*\)", essay_text)
    # Narrative: one or more capitalized words immediately before (Year)
    narrative = re.findall(r"[A-Z][a-zA-Z\-]+(?:(?:\s+(?:&|and|et)\s+\S+)+)?\s+\(\d{4}\)", essay_text)

    citation_count = len(paren) + len(narrative)

    # Unique sources: first author + year extracted from each citation
    unique = set()
    for c in paren + narrative:
        year_m = re.search(r"\b((?:19|20)\d{2})\b", c)
        auth_m = re.search(r"([A-Z][a-zA-Z\-]+)", c)
        if year_m and auth_m:
            unique.add((auth_m.group(1), year_m.group(1)))

    # Reference list entries: lines starting with a capital letter after the
    # References / Works Cited / Bibliography header
    ref_section = re.split(
        r"\n(?:References|Works Cited|Bibliography)\s*\n",
        essay_text,
        flags=re.IGNORECASE,
    )
    ref_count = 0
    if len(ref_section) > 1:
        ref_lines = [l for l in ref_section[-1].strip().splitlines()
                     if re.match(r"^[A-Z]", l.strip())]
        ref_count = len(ref_lines)

    return {
        "citation_count": citation_count,
        "unique_sources": len(unique),
        "ref_list_count": ref_count,
    }


# ── Metric 5: Specificity (automatic) ────────────────────────────────────────
def count_specificity(essay_text: str) -> dict:
    """
    Unique (first-author, year) pairs found anywhere in the text via a loose
    scan. Measures engagement with named sources vs. generic claims.
    Deliberately broader than count_citations to catch informal mentions.
    """
    pairs = set()
    # Find any capital-letter word within 60 chars of a 4-digit year
    for m in re.finditer(r"\b([A-Z][a-zA-Z\-]+)\b.{0,60}?\b((19|20)\d{2})\b", essay_text):
        candidate = m.group(1)
        year = m.group(2)
        # Exclude common false positives (section headings, "The", "In", etc.)
        if candidate not in {"The", "In", "A", "An", "This", "That", "These",
                              "For", "As", "At", "By", "Of", "On", "To", "It",
                              "References", "Works", "Cited", "Figure", "Table"}:
            pairs.add((candidate, year))
    return {"specificity": len(pairs)}


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("Error: ANTHROPIC_API_KEY not found. Add it to .env at the project root.", file=sys.stderr)
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)
    essays = discover_essays(METRIC_DIR)

    if not essays:
        print("No matching essay files found.", file=sys.stderr)
        sys.exit(1)

    print(f"Found {len(essays)} essay file(s). Evaluating...\n")

    rows = []
    for entry in essays:
        with open(entry["path"], "r", encoding="utf-8") as f:
            text = f.read()

        if not text.strip():
            print(f"  SKIP  {entry['filename']} (empty)")
            continue

        print(f"  {entry['filename']}")

        try:
            print("    rubric ...", end=" ", flush=True)
            rubric = evaluate_rubric(text, entry["essay_num"], client)
            print(f"score={rubric['overall_score']}/100")

            print("    requirements ...", end=" ", flush=True)
            req = check_requirements(text, entry["essay_num"], client)
            print(f"met={req['req_met']}  alignment={req['alignment']}%")

        except Exception as e:
            print(f"    API ERROR: {e}")
            rubric = {key: "ERROR" for _, key in TRAITS}
            rubric.update({"total": "ERROR", "overall_score": "ERROR", "rubric_raw": str(e)})
            req = {"req_met": "ERROR", "alignment": "ERROR", "req_raw": str(e)}

        auto = count_citations(text)
        auto.update(count_specificity(text))
        print(f"    citations={auto['citation_count']}  unique={auto['unique_sources']}  "
              f"refs={auto['ref_list_count']}  specificity={auto['specificity']}")

        row = {
            "essay_num": entry["essay_num"],
            "condition": entry["condition"],
            "model": entry["model"],
            **rubric,
            **req,
            **auto,
        }
        row["composite_score"] = compute_composite(row)
        print(f"    composite={row['composite_score']}/100")
        rows.append(row)

    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nResults saved to {OUTPUT_CSV}")

    # ── Summary table ────────────────────────────────────────────────────────
    print("\n── Summary ──────────────────────────────────────────────────────────────────────")
    print(f"{'Essay':<8} {'Condition':<14} {'Model':<12} "
          f"{'Rubric':>7} {'Align%':>7} {'Uniq':>5} {'Spec':>5} {'Composite':>10}")
    print("─" * 80)
    for r in rows:
        print(f"Essay {r['essay_num']:<3} {r['condition']:<14} {r['model']:<12} "
              f"{r['overall_score']:>7} {r['alignment']:>7} "
              f"{r['unique_sources']:>5} {r['specificity']:>5} {r['composite_score']:>10}")


if __name__ == "__main__":
    main()
