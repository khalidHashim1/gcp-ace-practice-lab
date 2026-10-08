# Cost optimization and cleanup

## Design controls

Cloud Run uses zero minimum instances, request-based CPU, 512 MiB memory, one vCPU, concurrency 40 and a maximum of two instances. No external load balancer, NAT gateway, GKE cluster or always-on VM is created. Cold starts are an accepted tradeoff.

Firestore regional placement colocates the app and database. History is capped to 100 attempts. The health endpoint avoids a Firestore read. Artifact Registry keeps ten recent versions and removes older eligible versions after 30 days. Build source objects expire after seven days. Old images must remain available for rollback until the rollout is accepted.

## Actual cost drivers

| Service              | What drives cost                                                          |
| -------------------- | ------------------------------------------------------------------------- |
| Cloud Run            | Requests, CPU/memory active time, networking and cold starts              |
| Firestore            | Document reads/writes/deletes, retained snapshots, indexes and networking |
| Artifact Registry    | Container storage and applicable transfer                                 |
| Cloud Build          | Build minutes and machine type; repeated full dependency installs         |
| Logging / Monitoring | Log ingestion/retention, metrics and any added uptime checks              |
| Cloud Storage        | State versions and build source storage/operations                        |
| Authentication       | Product edition, active users, enabled providers and applicable pricing   |

Free allowances depend on region, billing account, service and current pricing. A personal low-traffic project can be inexpensive but is not guaranteed free. No exact monthly estimate is asserted without usage assumptions and a checked pricing calculator. Build minutes, large images and retained session snapshots can dominate an otherwise idle app.

## Budget alerts

In Billing > Budgets & alerts, create a budget scoped to the dedicated project (for example an amount you are comfortable spending in SAR or your billing currency). Add actual spend alerts at 50%, 80% and 100%, and a forecast threshold. Add your notification email and test delivery. Enable billing export for detailed analysis if needed; consider its storage/query costs.

Budget alerts **do not stop spending**. Review daily during the first week, especially Cloud Build, Firestore and logs. Keep deploy workflows manual, avoid repeated builds on trivial changes and adjust log retention deliberately.

## Cleanup

1. Export any study history you want to retain before removing data. The admin JSON editor can copy/download the question bank; attempt history currently has no export UI.
2. Disable GitHub deploy workflows and remove federation access so resources cannot be recreated by CI.
3. Set `enable_service=false`, apply a reviewed plan and confirm Cloud Run removal. For prod, first disable its resource deletion protection with a separate reviewed apply.
4. Remove stored attempts/sessions or delete the dedicated project when data is no longer needed.
5. To use `terraform destroy`, consciously remove Firestore `prevent_destroy` and set its delete protection to disabled, apply that change, then review destruction. Nonempty source buckets require deleting objects before destruction. Do not casually disable these protections.
6. Preserve the protected state bucket until all managed resources are removed. Export state and decide how to delete old versions separately; its protection is deliberate.
7. Check for Firebase/Identity Platform configuration, Artifact Registry images, source buckets, state versions and any manually created resources. A stopped app alone does not erase storage charges.
8. For this isolated lab, deleting the dedicated Google Cloud project is the broadest cleanup option after data export and review. It is irreversible after Google's recovery window and must never be done to a shared project.

Current prices: https://cloud.google.com/products/calculator
Cloud Run pricing: https://cloud.google.com/run/pricing
Firestore pricing: https://cloud.google.com/firestore/pricing
Budget behavior: https://docs.cloud.google.com/billing/docs/how-to/budgets
