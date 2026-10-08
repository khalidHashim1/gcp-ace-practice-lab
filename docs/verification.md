# Verification report

This report distinguishes completed checks from prepared but untested deployment steps.

| Check                                         | Result                                                                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Original PDF extraction                       | 81 sequential questions; four options each; questions 52 and 73 require two selections                                  |
| Reproducible import                           | Regenerated all 81 question records and compared them successfully                                                      |
| Question validation                           | Pass; all 81 ungraded, zero fabricated keys                                                                             |
| ESLint                                        | Pass with zero warnings                                                                                                 |
| TypeScript application check                  | Pass                                                                                                                    |
| Vitest                                        | 18 tests pass across scoring, exam controls, local API integration and cloud authorization contracts                    |
| Production Next.js build                      | Pass without Google Cloud credentials                                                                                   |
| Production dependency audit                   | Zero known vulnerabilities reported by npm audit at verification time                                                   |
| Terraform formatting / parsing                | Pass for bootstrap, module, dev and prod                                                                                |
| Terraform initialization                      | Dev provider downloaded and dependency lock generated                                                                   |
| Terraform provider validation                 | Blocked: execution environment prohibits provider Unix sockets; CI includes validation for all environments             |
| Desktop / mobile browser tests                | Two Playwright cases defined and discovered; not executed successfully because the browser download is unavailable here |
| Screenshots / visual QA                       | Not available; no fabricated screenshots included                                                                       |
| Docker build and container health             | Not run: Docker is not installed here; CI includes both checks                                                          |
| Real Firebase sign-in / Firestore persistence | Not tested against Google Cloud; mocked SDK tests validate authorization contracts only                                 |
| Cloud Build / Cloud Run / WIF deployment      | Not attempted; requires project setup and approval                                                                      |
| GitHub connection                             | Public repository created under khalidHashim1 using the GitHub website; source publication verified separately              |

## Test scope

Scoring tests require exact unordered multi-answer selections, reject duplicates and partial answers, and keep ungraded questions outside the score denominator. Import tests cover duplicate IDs, incomplete verified keys and private-field stripping. Local API integration exercises session creation, timed expiry, payload validation, persistence, retry behavior, verified-key snapshots and production-mode rejection. Cloud contract tests mock Firebase SDK calls to check missing/invalid token rejection, revoked-token verification, user isolation and server-side admin authorization.

The Firebase client uses the App and Auth packages only; the unused browser Firestore SDK was removed to avoid bringing an unnecessary vulnerable transitive gRPC dependency into the install. Firestore server access uses the updated Firebase Admin SDK.

## Re-run on a normal development machine

```bash
npm ci
npm run validate:questions
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
npx playwright install --with-deps chromium
npm run test:e2e
docker build -t ace-practice-lab .
terraform fmt -check -recursive infra
terraform -chdir=infra/environments/dev init -backend=false
terraform -chdir=infra/environments/dev validate
```

Repeat Terraform init/validate for prod and bootstrap. For a container health smoke test, use `DATA_MODE=firestore` with a test project identifier and call `/api/health`; this does not verify Firestore access or Google sign-in. For normal credential-free use, run `npm run dev`, not the production container.

See [deployment guide](deployment.md) for the separately approved cloud integration validation.
