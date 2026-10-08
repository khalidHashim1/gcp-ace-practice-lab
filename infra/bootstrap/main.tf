terraform {
  required_version = ">= 1.9, < 2.0"
  required_providers { google = { source = "hashicorp/google", version = "~> 7.0" } }
}
variable "project_id" { type = string }
variable "state_bucket" { type = string }
variable "state_principal" { type = string }
variable "region" {
  type    = string
  default = "me-central1"
}
provider "google" { project = var.project_id }
resource "google_storage_bucket" "state" {
  project                     = var.project_id
  name                        = var.state_bucket
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  versioning { enabled = true }
  lifecycle { prevent_destroy = true }
}
resource "google_storage_bucket_iam_member" "operator" {
  bucket = google_storage_bucket.state.name
  role   = "roles/storage.objectAdmin"
  member = var.state_principal
}
