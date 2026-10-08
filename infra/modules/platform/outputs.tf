output "url" { value = try(google_cloud_run_v2_service.web[0].uri, null) }
output "wif_provider" { value = google_iam_workload_identity_pool_provider.github.name }
output "deploy_service_account" { value = google_service_account.deploy.email }
output "build_service_account" { value = google_service_account.build.email }
output "source_bucket" { value = google_storage_bucket.source.name }
output "image_repository" { value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}" }
