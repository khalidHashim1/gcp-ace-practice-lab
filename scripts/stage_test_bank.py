"""Stage a third-party PDF as a private, ungraded question bank.

This tool deliberately assigns no answer keys. A reviewer must add a key,
explanation, and official Google Cloud URL before a staged question can be
marked verified or published. Do not commit its output to a public repository.

Usage:
  python scripts/stage_test_bank.py INPUT.pdf OUTPUT.json
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pdfplumber


HEADER = re.compile(r"(?m)^Question #(\d+)Topic\s+\d+\s*$")
OPTION = re.compile(r"(?m)^•\s*([A-E])\.\s+")


def clean(value: str) -> str:
    # The source PDF uses a font encoding that pdfplumber renders as this
    # sequence around inline code. Retain the intended code delimiters.
    value = value.replace("ג€", "`")
    return " ".join(value.replace("\u00a0", " ").split())


def topic_for(prompt: str) -> str:
    choices = [
        ("IAM & Security", r"\b(IAM|identity|service account|role|permission|encrypt|KMS|audit)\b"),
        ("Networking", r"\b(VPC|subnet|firewall|load balanc|VPN|interconnect|DNS|IP address)\b"),
        ("Storage & Databases", r"\b(Cloud Storage|BigQuery|Bigtable|Spanner|Cloud SQL|database|bucket)\b"),
        ("Compute & Containers", r"\b(Compute Engine|GKE|Kubernetes|Cloud Run|App Engine|instance|container)\b"),
    ]
    for topic, pattern in choices:
        if re.search(pattern, prompt, re.I):
            return topic
    return "Operations & Monitoring"


def parse(raw: str) -> list[dict]:
    headers = list(HEADER.finditer(raw))
    questions: list[dict] = []
    for index, match in enumerate(headers):
        body = raw[match.end() : headers[index + 1].start() if index + 1 < len(headers) else len(raw)]
        option_matches = list(OPTION.finditer(body))
        if len(option_matches) not in (4, 5):
            raise ValueError(f"Question {match.group(1)} has {len(option_matches)} options")
        prompt = clean(body[: option_matches[0].start()])
        options = []
        for option_index, option_match in enumerate(option_matches):
            end = option_matches[option_index + 1].start() if option_index + 1 < len(option_matches) else len(body)
            options.append({"id": option_match.group(1), "text": clean(body[option_match.end() : end])})
        number = int(match.group(1))
        if [item["id"] for item in options] != list("ABCDE")[: len(options)]:
            raise ValueError(f"Question {number} has non-sequential option labels")
        questions.append(
            {
                "id": f"ace2-{number:03}",
                "number": number,
                "prompt": prompt,
                "options": options,
                "selectionCount": 2 if re.search(r"\b(choose|select)\s+(two|2)\b", prompt, re.I) else 1,
                "topic": topic_for(prompt),
                "verification": "ungraded",
                "correctOptionIds": [],
                "explanation": None,
                "references": [],
            }
        )
    if not questions or [q["number"] for q in questions] != list(range(1, len(questions) + 1)):
        raise ValueError("Question numbers must be complete and sequential")
    return questions


def main() -> None:
    source, destination = map(Path, sys.argv[1:3])
    with pdfplumber.open(source) as pdf:
        raw = "\n".join(page.extract_text() or "" for page in pdf.pages)
    bank = parse(raw)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(bank, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Staged {len(bank)} ungraded questions at {destination}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: stage_test_bank.py INPUT.pdf OUTPUT.json")
    main()
