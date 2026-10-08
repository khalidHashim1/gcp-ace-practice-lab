locals {
  name = "ace-${var.environment}"
  apis = toset(["run.googleapis.com", "firestore.googleapis.com", "artifactregistry.googleapis.com", "cloudbuild.googleapis.com", "iam.googleapis.com", "iamcredentials.googleapis.com", "sts.googleapis.com", "identitytoolkit.googleapis.com", "firebase.googleapis.com", "logging.googleapis.com", "monitoring.googleapis.com"])
}
resource "google_project_service" "apis" {
  for_each           = local.apis
  project            = var.project_id
  service            = each.key
  disable_on_destroy = false
}
resource "google_service_account" "runtime" {
  project    = var.project_id
  account_id = "${local.name}-runtime"
  depends_on = [google_project_service.apis]
}
resource "google_service_account" "build" {
  project    = var.project_id
  account_id = "${local.name}-build"
  depends_on = [google_project_service.apis]
}
resource "google_service_account" "deploy" {
  project    = var.project_id
  account_id = "${local.name}-deploy"
  depends_on = [google_project_service.apis]
}
resource "google_project_iam_member" "runtime" {
  for_each = toset(["roles/datastore.user", "roles/firebaseauth.viewer"])
  project  = var.project_id
  role     = each.key
  member   = "serviceAccount:${google_service_account.runtime.email}"
}
resource "google_project_iam_member" "build_logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.build.email}"
}
resource "google_project_iam_member" "deploy" {
  for_each = toset(["roles/cloudbuild.builds.editor", "roles/serviceusage.serviceUsageConsumer"])
  project  = var.project_id
  role     = each.key
  member   = "serviceAccount:${google_service_account.deploy.email}"
}
resource "google_service_account_iam_member" "act_as" {
  for_each           = { runtime = google_service_account.runtime.name, build = google_service_account.build.name }
  service_account_id = each.value
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deploy.email}"
}
resource "google_artifact_registry_repository" "images" {
  project                = var.project_id
  location               = var.region
  repository_id          = local.name
  format                 = "DOCKER"
  cleanup_policy_dry_run = false
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions { keep_count = 10 }
  }
  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition { older_than = "2592000s" }
  }
  depends_on = [google_project_service.apis]
}
resource "google_artifact_registry_repository_iam_member" "build" {
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.images.repository_id
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.build.email}"
}
resource "google_artifact_registry_repository_iam_member" "deploy" {
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.images.repository_id
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.deploy.email}"
}
resource "google_storage_bucket" "source" {
  project                     = var.project_id
  name                        = "${var.project_id}-${local.name}-build-source"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  lifecycle_rule {
    condition { age = 7 }
    action { type = "Delete" }
  }
}
resource "google_storage_bucket_iam_member" "source_build" {
  bucket = google_storage_bucket.source.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.build.email}"
}
resource "google_storage_bucket_iam_member" "source_deploy" {
  bucket = google_storage_bucket.source.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.deploy.email}"
}
resource "google_firestore_database" "database" {
  project                 = var.project_id
  name                    = "(default)"
  location_id             = var.firestore_location
  type                    = "FIRESTORE_NATIVE"
  delete_protection_state = "DELETE_PROTECTION_ENABLED"
  depends_on              = [google_project_service.apis]
  lifecycle { prevent_destroy = true }
}
resource "google_identity_platform_config" "auth" {
  project            = var.project_id
  authorized_domains = var.authorized_domains
  depends_on         = [google_project_service.apis]
}
resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "${local.name}-github"
  depends_on                = [google_project_service.apis]
}
resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  attribute_mapping = {
    "google.subject"          = "assertion.sub"
    "attribute.repository"    = "assertion.repository"
    "attribute.repository_id" = "assertion.repository_id"
  }
  attribute_condition = "assertion.repository_owner_id == '${var.github_owner_id}' && assertion.repository_id == '${var.github_repository_id}' && assertion.ref == 'refs/heads/main' && assertion.sub == 'repo:${var.github_repository}:environment:${var.environment}'"
  oidc { issuer_uri = "https://token.actions.githubusercontent.com" }
}
resource "google_service_account_iam_member" "federation" {
  service_account_id = google_service_account.deploy.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository_id/${var.github_repository_id}"
}
resource "google_cloud_run_v2_service" "web" {
  count               = var.enable_service ? 1 : 0
  project             = var.project_id
  name                = local.name
  location            = var.region
  deletion_protection = var.environment == "prod"
  ingress             = "INGRESS_TRAFFIC_ALL"
  template {
    service_account                  = google_service_account.runtime.email
    timeout                          = "60s"
    max_instance_request_concurrency = 40
    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }
    containers {
      image = var.image
      ports { container_port = 8080 }
      resources {
        limits   = { cpu = "1", memory = "512Mi" }
        cpu_idle = true
      }
      env {
        name  = "DATA_MODE"
        value = "firestore"
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "FIREBASE_API_KEY"
        value = var.firebase_api_key
      }
      env {
        name  = "FIREBASE_AUTH_DOMAIN"
        value = "${var.project_id}.firebaseapp.com"
      }
      env {
        name  = "FIREBASE_APP_ID"
        value = var.firebase_app_id
      }
      startup_probe {
        http_get { path = "/api/health" }
        initial_delay_seconds = 5
        period_seconds        = 5
      }
    }
  }
  depends_on = [google_project_iam_member.runtime, google_project_service.apis]
  lifecycle { ignore_changes = [template[0].containers[0].image] }
}
resource "google_cloud_run_v2_service_iam_member" "deploy" {
  count    = var.enable_service ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.web[0].name
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.deploy.email}"
}
resource "google_cloud_run_v2_service_iam_member" "public" {
  count    = var.enable_service && var.public_access ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.web[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
resource "google_logging_metric" "api_errors" {
  project = var.project_id
  name    = "${local.name}-api-errors"
  filter  = "resource.type=cloud_run_revision AND resource.labels.service_name=${local.name} AND severity>=ERROR"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
  depends_on = [google_project_service.apis]
}
resource "google_monitoring_alert_policy" "errors" {
  project      = var.project_id
  display_name = "${local.name} API errors"
  combiner     = "OR"
  conditions {
    display_name = "Server errors observed"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.api_errors.name}\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "60s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }
}
