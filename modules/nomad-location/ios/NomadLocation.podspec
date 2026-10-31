Pod::Spec.new do |s|
  s.name           = 'NomadLocation'
  s.version        = '0.1.0'
  s.summary        = 'Navigation location updates in the background for Nomad Pocket'
  s.description    = s.summary
  s.license        = 'GPL-3.0-or-later'
  s.author         = 'Nomad Pocket contributors'
  s.homepage       = 'https://github.com/franlindebl/nomad-pocket'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/franlindebl/nomad-pocket.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
