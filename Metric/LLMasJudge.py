import argparse
import sys
from openai import OpenAI

SYSTEM_PROMPT = """Act as an expert essay grader and judge. Your goal is to evaluate the provided essay objectively, rigorously, and analytically based on specific criteria. Do not be overly complimentary. Be highly critical and constructive. You are evaluating this for a College Mind class.

The main topic of the course is: Autumn quarter of Mind challenges the naïve impression that our subjective experience of reality is a veridical reflection of the external world. By introducing a wide-range of phenomena that illustrate the constructive nature of experience — perceptual, conceptual, affective, social, and cultural — the lectures and readings engage students in analyzing the mind's role in the construction of our realities. In particular, we consider our subjective awareness of and introspective access to the mental processes that shape reality for us and the bottom-up and top-down control of information processing in generating that reality. We also examine the dynamic nature of mind — how our constructed realities emerge and change over time and the role of nature and nurture in their development across a variety of time scales, exploring processes that unfold over the course of milliseconds as well as those that unfold over millennia.

The prompt the writer was given was: How and Why does the mind "go beyond the information given"? Minds are dynamic in several senses of the word — 1) they actively construct and shape our experience of reality, and 2) these constructed realities emerge and change over time. This quarter of Mind we have introduced a wide range of phenomena that illustrate the constructive nature of our experience of reality. Within the context of an organizational claim, please discuss HOW (mechanism) our minds "go beyond the information given." As part of your paper, please consider the functional role the challenges we face might play in WHY (function) the mind "goes beyond the information given" in the ways that it does. The paper must draw evidence from at least 4 weekly topics — 2 from the first four lectures and 2 from the last 5 lectures. Length limit: 5 pages, double spaced, 12-point font, 1-inch margins.

Please evaluate the essay and only provide an overall Score: Score out of 100 with a 1–2 sentence justification.
"""


def evaluate_essay(essay_text: str) -> str:
    client = OpenAI()

    response = client.responses.create(
        model="gpt-5.4",
        instructions=SYSTEM_PROMPT,
        input=f"Please evaluate the following essay:\n\n{essay_text}",
        max_output_tokens=2048,
    )

    return response.output_text


def main():
    parser = argparse.ArgumentParser(description="Evaluate an essay using GPT-5.4 as a judge.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--essay", type=str, help="Essay text passed directly as a string.")
    group.add_argument("--file", type=str, help="Path to a file containing the essay.")
    args = parser.parse_args()

    if args.essay:
        essay_text = args.essay
    else:
        try:
            with open(args.file, "r", encoding="utf-8") as f:
                essay_text = f.read()
        except FileNotFoundError:
            print(f"Error: file not found: {args.file}", file=sys.stderr)
            sys.exit(1)
        except OSError as e:
            print(f"Error reading file: {e}", file=sys.stderr)
            sys.exit(1)

    if not essay_text.strip():
        print("Error: essay text is empty.", file=sys.stderr)
        sys.exit(1)

    try:
        result = evaluate_essay(essay_text)
    except Exception as e:
        print(f"Error calling OpenAI API: {e}", file=sys.stderr)
        sys.exit(1)

    print(result)


if __name__ == "__main__":
    main()
