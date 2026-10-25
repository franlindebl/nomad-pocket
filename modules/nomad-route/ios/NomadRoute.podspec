Pod::Spec.new do |s|
  s.name           = 'NomadRoute'
  s.version        = '0.1.0'
  s.summary        = 'Offline road routing (Valhalla) for Nomad Pocket'
  s.description    = 'Routes, isochrones and matrices over Valhalla routing tiles stored on the device.'
  s.license        = 'GPL-3.0-or-later'
  s.author         = 'Nomad Pocket'
  s.homepage       = 'https://github.com/franlindebl/nomad-pocket'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/franlindebl/nomad-pocket.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Prebuilt Valhalla + protobuf + absl (Rallista valhalla-mobile, fetched by
  # ../scripts/fetch-ios-libs.sh from the root package.json postinstall). Not committed.
  s.vendored_frameworks = 'Frameworks/ValhallaWrapper.xcframework'
  s.libraries = 'c++', 'z'
  # Valhalla's date library extracts tzdata.tar from the main bundle into Library/ on
  # first use (time-dependent restrictions, departure times).
  s.resources = 'Frameworks/tzdata.tar'

  s.source_files = '*.{h,mm,swift}'
  s.public_header_files = 'NRRouter.h'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20',
    'CLANG_CXX_LIBRARY' => 'libc++',
  }
end
