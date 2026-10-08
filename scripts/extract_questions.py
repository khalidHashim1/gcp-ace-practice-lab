"""Reproduce seed import from the supplied PDF. Requires system pdftotext.
Usage: python3 scripts/extract_questions.py /path/to/ACE_Practice_Exam.pdf
No cloud calls. Existing verified keys must be exported before replacing the seed.
"""
from pathlib import Path
import hashlib, json, re, subprocess, sys
source=Path(sys.argv[1])
raw=subprocess.check_output(["pdftotext","-raw",str(source),"-"],text=True)
raw=re.sub(r"Google Cloud Associate Cloud Engineer Practice Exam\n|ACE Practice Exam • 81 Questions Page \d+\n|\f","",raw)
parts=re.split(r"(?m)^(\d+)\s*\n",raw)[1:]
questions=[]
for number,body in zip(parts[::2],parts[1::2]):
    parts=re.split(r"(?m)^([A-D]) ",body)
    if len(parts)!=9: raise ValueError(f"Malformed options: {number}")
    prompt=" ".join(parts[0].split())
    topic="Operations & Monitoring"
    for label,pattern in [("Billing & Cost","billing|budget|cost"),("IAM & Security","IAM|service account|permissions|authentication"),("Networking","VPC|subnet|network|firewall|IP address"),("Storage & Databases","database|BigQuery|Storage|Spanner|Bigtable|SQL"),("Compute & Containers","Compute Engine|Kubernetes|GKE|Cloud Run|App Engine")]:
        if re.search(pattern,prompt,re.I): topic=label;break
    questions.append(dict(id=f"ace-{int(number):03}",number=int(number),prompt=prompt,options=[dict(id=parts[i],text=" ".join(parts[i+1].split())) for i in range(1,9,2)],selectionCount=2 if re.search("choose two|select two",prompt,re.I) else 1,topic=topic,verification="ungraded",correctOptionIds=[],explanation=None,references=[]))
if len(questions)!=81 or [q["number"] for q in questions]!=list(range(1,82)): raise ValueError("Expected questions 1 through 81")
root=Path(__file__).resolve().parent.parent
(root/"data/questions.json").write_text(json.dumps(questions,ensure_ascii=False,indent=2)+"\n")
(root/"data/source-manifest.json").write_text(json.dumps(dict(source=source.name,sha256=hashlib.sha256(source.read_bytes()).hexdigest(),count=81,normalization="PDF line wraps collapsed to spaces; wording and choices preserved. Topics are heuristic editorial metadata. No answer key supplied."),indent=2)+"\n")
print("Extracted 81 ungraded questions. Run npm run validate:questions.")
