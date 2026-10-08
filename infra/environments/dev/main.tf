terraform {
  required_version = ">= 1.9, < 2.0"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 7.0" }
  }
  backend "gcs" {}
}
provider "google" {
  project = var.project_id
  region  = var.region
}
module "platform" {
  source               = "../../modules/platform"
  environment          = "dev"
  project_id           = var.project_id
  region               = var.region
  firestore_location   = var.firestore_location
  github_repository    = var.github_repository
  github_owner_id      = var.github_owner_id
  github_repository_id = var.github_repository_id
  image                = var.image
  firebase_api_key     = var.firebase_api_key
  firebase_app_id      = var.firebase_app_id
  enable_service       = var.enable_service
  public_access        = var.public_access
  authorized_domains   = var.authorized_domains
}
