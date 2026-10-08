# Deployment guide

No resources have been provisioned by this deliverable. The following commands create resources and may incur charges. Execute them only after deciding to approve the project deployment.

## 1. Prerequisites and project isolation

Install Node.js 22, Docker, gcloud, Terraform 1.9+ and Firebase CLI. Create separate dedicated dev and prod Google Cloud projects with billing enabled. Bootstrap with your operator identity, not the GitHub deploy service account. Project creation and billing attachment are outside the module.

```bash
gcloud auth login
gcloud auth application-default login
gcloud config set project YOUR_PROJECT_ID
```

Ensure your operator can enable APIs, provision Firestore, Artifact Registry, IAM and Cloud Run, and manage project IAM. Existing databases or Identity Platform configurations must be imported before Terraform is used; do not apply this module over an unrelated existing project.

## 2. Secure remote state bootstrap

```bash
cd infra/bootstrap
terraform init
terraform plan -var='project_id=YOUR_PROJECT_ID' -var='state_bucket=YOUR_GLOBALLY_UNIQUE_BUCKET' -var='state_principal=user:YOUR_EMAIL'
terraform apply -var='project_id=YOUR_PROJECT_ID' -var='state_bucket=YOUR_GLOBALLY_UNIQUE_BUCKET' -var='state_principal=user:YOUR_EMAIL'
```

The bootstrap starts with local state because the backend bucket does not yet exist. Migrate its state after creation:

1. Add `backend "gcs" {}` inside the bootstrap `terraform` block.
2. Run `terraform init -migrate-state -backend-config='bucket=YOUR_GLOBALLY_UNIQUE_BUCKET' -backend-config='prefix=bootstrap'`.
3. Keep the bucket protected, access-limited and versioned. Do not commit local state.

The GCS backend locks state. Use different prefixes for each environment, and separate projects and state buckets for stronger isolation. Access to state is sensitive: do not grant it to the application deploy identity.

## 3. Bootstrap the platform without deploying a service

```bash
cd ../environments/dev
cp terraform.tfvars.example terraform.tfvars
# Fill project ID, GitHub owner/repository and numeric IDs.
terraform init -backend-config='bucket=YOUR_STATE_BUCKET' -backend-config='prefix=ace/dev'
terraform fmt -check -recursive ../../
terraform validate
terraform plan -out=reviewed.tfplan
terraform apply reviewed.tfplan
terraform output -json platform
```

`enable_service=false` and `public_access=false` are the defaults. The first apply still creates billed-capable infrastructure, so it requires deployment approval. It provisions a default Firestore database with destruction protection. Do not choose a Firestore location casually; it is immutable.

Get numeric GitHub IDs using `gh api users/YOUR_OWNER --jq .id` and `gh api repos/YOUR_OWNER/gcp-ace-practice-lab --jq .id` (use `orgs/YOUR_OWNER` for an organization).

## 4. Configure Firebase and Google sign-in

In Firebase Console, add Firebase to this existing dedicated Google Cloud project. Register a web application and copy its `apiKey`, `appId` and project ID. Enable Google as an Authentication sign-in provider, set the support email, and configure consent/scope settings where required. Firebase web configuration identifies the project; it is not a service account key. Apply appropriate API restrictions without blocking Firebase Auth.

Set `firebase_api_key`, `firebase_app_id` and `authorized_domains` in your local Terraform variables. Include `${PROJECT_ID}.firebaseapp.com`, `localhost` for local cloud integration, and later the exact Cloud Run hostname. The Identity Platform resource owns the authorized-domain list; preserve all required domains in Terraform to avoid overwriting console changes.

Deploy the deny-all browser Firestore rules:

```bash
firebase deploy --only firestore:rules --project YOUR_PROJECT_ID
```

All Firestore access goes through the Admin SDK on the server; rules do not restrict that SDK, so server authorization remains mandatory. Local cloud integration uses `DATA_MODE=firestore` and ADC; ordinary local development continues to use `DATA_MODE=local`.

## 5. Build the first image using the operator identity

Use the output values for the build service account, image repository and source bucket:

```bash
gcloud builds submit . --project=YOUR_PROJECT_ID --region=me-central1 --config=cloudbuild.yaml --service-account=projects/YOUR_PROJECT_ID/serviceAccounts/YOUR_BUILD_SERVICE_ACCOUNT --gcs-source-staging-dir=gs://YOUR_SOURCE_BUCKET/source --substitutions=_IMAGE=YOUR_IMAGE_REPOSITORY/web:bootstrap
```

Run this from the repository root. Your operator needs permission to submit a build and act as the build identity. The service account builds and pushes the image; no credential is copied into the image.

Then set `enable_service=true` and `image` to the pushed image digest URI in `terraform.tfvars`. Set the Firebase config values. Review and apply a plan. This creates the Cloud Run service and scopes the CI deploy permission to that service.

`public_access=false` keeps Cloud Run private at the IAM layer. Validate with an authenticated operator or `gcloud run services proxy`. Only when public exposure is approved, set `public_access=true` and apply a reviewed plan. Protected API routes still require Firebase identity tokens.

Add the resulting Cloud Run hostname to `authorized_domains` and apply before trying Google sign-in. Validate health, login, token rejection, user separation, bank import, exam submission and Firestore persistence before calling cloud deployment successful.

## 6. Set an admin claim

After signing in once, locate your Firebase user UID. An authorized operator with Firebase Auth administration permissions can run:

```bash
GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID node --import tsx scripts/set-admin.ts YOUR_FIREBASE_UID
```

This uses ADC and sets `admin: true`, preserving existing custom claims. Sign out and back in to refresh the token. The UI displays the editor only for admins, and the server separately verifies the claim.

## 7. Configure GitHub environments

Create GitHub environments **dev** and **prod**. Restrict deployments to `main`. Configure required reviewers and disable self-review for `prod`. Verify your repository plan supports enforcement for public repositories. Keep the workflow manual until these settings are confirmed.

Add the following environment variables, using Terraform outputs:

| Variable                 | Value                                  |
| ------------------------ | -------------------------------------- |
| `GCP_PROJECT_ID`         | Dedicated environment project ID       |
| `GCP_REGION`             | `me-central1`                          |
| `WIF_PROVIDER`           | Full provider resource name            |
| `DEPLOY_SERVICE_ACCOUNT` | Deploy service account email           |
| `BUILD_SERVICE_ACCOUNT`  | Build service account email            |
| `IMAGE_REPOSITORY`       | Artifact Registry image repository URL |
| `SOURCE_BUCKET`          | Build-source bucket name               |

These identifiers are not credential secrets. Never upload service account JSON keys. The workflow uses GitHub OIDC to obtain short-lived credentials, reruns checks, triggers Cloud Build, resolves the image digest and updates the existing service. Terraform ignores the image field after initial creation so normal deliveries do not cause image drift.

## 8. Verify and roll back

Inspect Cloud Build logs and the Cloud Run revision. Validate `/api/health`, unauthenticated rejection of `/api/attempts`, Google login, two distinct users' histories and admin denial for non-admins. Confirm minimum instances remain zero. Roll back traffic to a previously healthy revision with `gcloud run services update-traffic`, or redeploy the previous immutable digest. Do not delete the prior image until the rollback window ends.

## Publish the repository

When GitHub access is connected, publish the committed repository. Manual alternative:

```bash
gh auth login
gh repo create gcp-ace-practice-lab --public --source=. --remote=origin --push
```

Do not run this against a repository of the same name until you inspect that repository and decide whether to reuse it.
