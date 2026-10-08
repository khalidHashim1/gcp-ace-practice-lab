# Architecture and engineering decisions

## Request and trust boundaries

The browser renders public questions and submits selected option IDs. It never decides a persisted score. The Next.js server verifies a Firebase ID token, derives the UID from that token, and scopes all session and attempt reads to `users/{uid}/...`. A caller cannot select a different UID in a payload.

A session contains a server snapshot of its question bank and a server-created deadline. Submission validates option IDs, per-question selection limits and flags. Expired timed submissions beyond a 15-second transport grace period are recorded with empty selections for scoring. Attempts are immutable after their first successful submission; retry returns the stored attempt. Cloud submissions finalize in a Firestore transaction; local development has weaker concurrency guarantees.

Firestore collections:

| Path                          | Data                                                                     |
| ----------------------------- | ------------------------------------------------------------------------ |
| `config/question-bank`        | Admin-managed bank, including verified answers                           |
| `users/{uid}/sessions/{uuid}` | Start time, deadline and frozen question snapshot                        |
| `users/{uid}/attempts/{uuid}` | Submission, selected answers, grading results, topic breakdown and flags |

The 81-question bank fits within Firestore's document limit. Splitting the bank into per-question documents is the next step for large imports; add payload/document limits before broadening the admin import. History returns the latest 100 attempts to bound reads. Study coverage is calculated from those attempts.

## Identity separation

| Identity           | Permissions                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime            | Firestore data access; Firebase Auth read access for revoked token checks                                                             |
| Cloud Build        | Write one Artifact Registry repository; read one source bucket; write build logs                                                      |
| GitHub deploy      | Submit builds; use only runtime and build identities; upload to one source bucket; read images; update the existing Cloud Run service |
| Bootstrap operator | Separately managed provisioning permissions; never used by application CI                                                             |

Federation requires numeric owner and repository IDs, main branch, and the exact GitHub environment subject. Terraform does not grant project Owner or Editor to application identities.

## Region and availability

Cloud Run, Artifact Registry, Cloud Build and regional Firestore are configured for `me-central1`. The default Firestore location cannot be changed after creation: use separate new dev/prod projects, and verify available regions and project policies first. Firebase Authentication is global. Remote state and build source buckets are regional.

Cloud Run handles HTTPS on its service URL. Adding a custom domain, Cloud Armor or a global load balancer is intentionally deferred. Cold starts are accepted for a low-traffic study project. Regional Firestore replicates across zones, but this architecture is not designed for regional outage failover.

## Observability

`/api/health` returns a lightweight liveness signal without making a billed Firestore read. Unexpected API exceptions emit structured ERROR logs without user tokens or response bodies. Terraform creates a log-based counter and an error alert. Attach an email notification channel in Monitoring after provisioning; an alert without a channel does not deliver notifications.

For a public deployment, add an uptime check on `/api/health`, a 5xx ratio policy, latency monitoring and a dashboard through Monitoring. An uptime check can prevent fully idle behavior and may create requests; consider that tradeoff before enabling it.

## Official documentation

- https://docs.cloud.google.com/run/docs/locations
- https://docs.cloud.google.com/firestore/native/docs/locations
- https://docs.cloud.google.com/build/docs/locations
- https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines
- https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/cloud_run_v2_service
