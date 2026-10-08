output "platform" { value = {
  url                    = module.platform.url
  wif_provider           = module.platform.wif_provider
  deploy_service_account = module.platform.deploy_service_account
  build_service_account  = module.platform.build_service_account
  source_bucket          = module.platform.source_bucket
  image_repository       = module.platform.image_repository
} }
