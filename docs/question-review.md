# ACE question review — 8 October 2026

All 81 questions were compared with the supplied correction handoff, original PDF and current official Google Cloud documentation. PDF green highlights were treated as candidate answers, not proof. The corrected protected bank contains 78 verified questions with explanations and official references; 53, 60 and 74 remain ungraded. There is no partial credit for choose-two questions; the exact unordered set must match. Ungraded questions are excluded from the percentage denominator.

## Unresolved questions

| Question | Why it remains ungraded | What would resolve it |
| --- | --- | --- |
| 53 | Agent-based Storage Transfer Service and Transfer Appliance can both fit an on-premises transfer. Volume alone does not establish the best approach. | Specify available bandwidth, transfer deadline, connectivity and appliance eligibility. |
| 60 | The cheapest storage class depends on retention duration, retrieval frequency and early-deletion charges. | Specify retention and access assumptions, then compare applicable regional pricing. |
| 74 | A region-wide relational dataset over 150 TB does not specify database or cluster size, partitioning, or query requirements. AlloyDB currently limits a cluster to 128 TiB; multiple clusters change the assessment. | Specify a single-database requirement or partitioning strategy, consistency and query patterns. |

The complete public audit is [question-review.json](../data/question-review.json): every question has a review status, wording note and official references. [corrections.json](../data/corrections.json) records the 50 wording/choice updates independently from original extraction. Neither file contains the private answer mapping or explanations. This review verifies answers for the corrected wording, not an endorsement of an official exam answer key.

## Load the protected bank locally

Download the separately supplied `ace-reviewed.protected.json`; never upload it to the public repository or place it under `apps/web/public`. Save it in the ignored `.private/` directory at the repository root. Validate it:

```bash
npm run validate:questions -- .private/ace-reviewed.protected.json
```

Set `QUESTION_BANK_PATH` in `apps/web/.env.local` to the **absolute** path of that file. Keep `DATA_MODE=local`, then run `npm run dev`. This variable is read only by the server. It seeds local questions when no admin-saved `.local/questions.json` exists. Alternatively, paste the validated bank into the local admin editor and save; the admin-saved bank takes precedence. Start a new exam after importing: existing sessions and attempts retain their original snapshot and are not silently regraded.

For a future approved cloud deployment, import through the authenticated admin interface after assigning the Firebase admin claim. Cloud mode stores the bank server-side in Firestore; it does not load `QUESTION_BANK_PATH`. Never use a `NEXT_PUBLIC_` variable for keys. No Google Cloud deployment or cloud import was performed for this review.

## Reproduce extraction and validation

Install Python 3 and Poppler (`pdftotext`). The original PDF is user supplied and is not redistributed. Extract raw original wording with `--raw`, or apply the versioned corrections by default:

```bash
python3 scripts/extract_questions.py /absolute/path/ACE_Practice_Exam.pdf --raw --output /tmp/ace-original.json
python3 scripts/extract_questions.py /absolute/path/ACE_Practice_Exam.pdf
npm run validate:questions
npm run test:importer
npm test
npm run test:e2e
```

The importer accepts four or five sequential options, restores E separately from D in questions 52 and 73, checks all 81 question numbers and never creates keys from highlights. Public seed validation requires all records to remain ungraded. Public quiz and session APIs strip keys, explanations and references; only the submitting user receives completed-attempt review fields. Synthetic regression keys are unrelated to the protected bank.
