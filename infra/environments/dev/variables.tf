variable "project_id" { type = string }
variable "region" {
  type    = string
  default = "me-central1"
}
variable "firestore_location" {
  type    = string
  default = "me-central1"
}
variable "github_repository" { type = string }
variable "github_owner_id" { type = string }
variable "github_repository_id" { type = string }
variable "image" {
  type    = string
  default = ""
}
variable "firebase_api_key" {
  type    = string
  default = ""
}
variable "firebase_app_id" {
  type    = string
  default = ""
}
variable "enable_service" {
  type    = bool
  default = false
}
variable "public_access" {
  type    = bool
  default = false
}
variable "authorized_domains" {
  type    = list(string)
  default = ["localhost"]
}
