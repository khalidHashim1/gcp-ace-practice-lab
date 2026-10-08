# Security model

## Implemented safeguards

- Firebase ID token verification includes revocation checking. UID and admin status come from verified claims, never a request body.
- User histories and sessions are scoped to the token UID. Admin endpoints separately enforce the admin claim on every call.
- Quiz APIs strip keys and explanations; scoring runs on a server snapshot. Only submitted attempt review exposes its verified keys.
- Production requests reject local development mode. Cloud Run stores data in Firestore rather than its ephemeral filesystem.
- Firestore browser rules deny all direct access. Server SDK access is governed by IAM and application checks.
- Workload Identity Federation restricts numeric owner/repository, main branch and exact dev/prod environment subject.
- Dedicated build, deploy and runtime service accounts; no static keys. ADC is supplied by Cloud Run's runtime identity.
- Zod validates imports, correct option counts, duplicate IDs and official reference domains. React escapes question/explanation text; no raw HTML rendering.
- Container runs as a non-root user. No environment files are copied into the build context.
- Security response headers prevent framing and MIME sniffing. Error logs exclude tokens and submitted answer bodies.
- Secrets, local attempt files, state and credential outputs are ignored by Git and Docker.

## Important operational boundaries

Local development intentionally has a single shared identity with admin rights. Bind the dev server to localhost on untrusted networks; never expose it publicly. The production guard rejects this mode.

A public GitHub repository cannot protect answer keys committed to it. Keep public seed questions ungraded; use the cloud admin interface to store keys in Firestore. Review responses expose answers after submission by design, appropriate for a study tool rather than a proctored exam.

The MVP does not implement application rate limiting, CAPTCHA, a CSP or resumable sessions. Avoid opening unrestricted registration at scale until abuse limits are added. Cloud Run's maximum instance count reduces compute exposure but is not a spending cap; a signed-in attacker can still create Firestore writes and Cloud Build costs are separate.

Cloud submission uses a Firestore transaction to preserve the first submitted attempt under concurrent requests. Local development supports sequential retries but does not provide transactional multi-process guarantees. Incoming JSON is capped at 700 KiB and malformed payloads are rejected before validation. Keep banks within Firestore document limits when expanding the import format.

Sessions and historical attempts contain question snapshots and are retained until explicitly removed. Add a TTL policy and account deletion/export procedures before storing many users' data. History is bounded to 100 records; it is not a lifetime analytics service.

Separate projects isolate Firestore because runtime `roles/datastore.user` is project-scoped. `roles/firebaseauth.viewer` supports revoked token checks. No attempt is made to enforce per-user restrictions with Firestore rules against the Admin SDK.

Enable GitHub branch protection, secret scanning and dependency alerts after publication. Review action updates; workflow actions use major version tags, so pin immutable action SHA values if required by your threat model. Dependency versions are resolved in the committed npm lockfile.

## Admin verification process

Do not mark a question verified from intuition alone. Check current Google documentation, preserve wording, record an accurate explanation and add supporting official references. Validate the bank, test scoring and review sample results. All original seed questions intentionally have no explanations or references.
