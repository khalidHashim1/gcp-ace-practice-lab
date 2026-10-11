"""Import the original PDF without answer keys, then apply reviewed wording fixes.
Usage: python3 scripts/extract_questions.py SOURCE.pdf [--output FILE] [--raw]
PDF highlighting is NOT verification. --raw preserves the normalized original text.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import subprocess


def extract(source):
    raw = subprocess.check_output(['pdftotext', '-raw', str(source), '-'], text=True)
    raw = re.sub(r'Google Cloud Associate Cloud Engineer Practice Exam\n|ACE Practice Exam • 81 Questions Page \d+\n|\f', '', raw)
    chunks = re.split(r'(?m)^(\d+)\s*\n', raw)[1:]
    questions = []
    for number, body in zip(chunks[::2], chunks[1::2]):
        parts = re.split(r'(?m)^([A-Z]) ', body)
        labels = parts[1::2]
        if labels not in [list('ABCD'), list('ABCDE')]:
            raise ValueError(f'Malformed or nonsequential options: {number}')
        prompt = ' '.join(parts[0].split())
        topic = 'Operations & Monitoring'
        for label, pattern in [('Billing & Cost', 'billing|budget|cost'), ('IAM & Security', 'IAM|service account|permissions|authentication'), ('Networking', 'VPC|subnet|network|firewall|IP address'), ('Storage & Databases', 'database|BigQuery|Storage|Spanner|Bigtable|SQL'), ('Compute & Containers', 'Compute Engine|Kubernetes|GKE|Cloud Run|App Engine')]:
            if re.search(pattern, prompt, re.I):
                topic = label
                break
        questions.append(dict(id=f'ace-{int(number):03}', number=int(number), prompt=prompt, options=[dict(id=parts[i], text=' '.join(parts[i+1].split())) for i in range(1, len(parts), 2)], selectionCount=2 if re.search('choose two|select two', prompt, re.I) else 1, topic=topic, verification='ungraded', correctOptionIds=[], explanation=None, references=[]))
    if [q['number'] for q in questions] != list(range(1, 82)):
        raise ValueError('Expected questions 1 through 81')
    return questions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--raw', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    questions = extract(args.source)
    if not args.raw:
        for patch in json.loads((root / 'data/corrections.json').read_text()):
            q = questions[patch['number'] - 1]
            if 'prompt' in patch:
                q['prompt'] = patch['prompt']
            for option_id, text in patch.get('options', {}).items():
                next(o for o in q['options'] if o['id'] == option_id)['text'] = text
    output = args.output or root / 'data/questions.json'
    output.write_text(json.dumps(questions, ensure_ascii=False, indent=2) + '\n')
    if not args.output:
        (root / 'data/source-manifest.json').write_text(json.dumps(dict(source=args.source.name, sha256=hashlib.sha256(args.source.read_bytes()).hexdigest(), count=81, normalization='PDF wraps collapsed; A-E extracted separately; reviewed wording corrections in corrections.json. Highlighted candidate answers independently reviewed; keys excluded from public seed.'), indent=2) + '\n')
    print('Extracted 81 questions without private keys. Run npm run validate:questions.')


if __name__ == '__main__':
    main()
