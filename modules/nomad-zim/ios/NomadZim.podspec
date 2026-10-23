Pod::Spec.new do |s|
  s.name           = 'NomadZim'
  s.version        = '0.1.0'
  s.summary        = 'libkiwix/libzim bridge and ZIM WebView for Nomad Pocket'
  s.description    = 'Opens ZIM archives, searches them and renders their content through a zim:// scheme handler.'
  s.license        = 'GPL-3.0-or-later'
  s.author         = 'Nomad Pocket'
  s.homepage       = 'https://github.com/franlindebl/nomad-pocket'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/franlindebl/nomad-pocket.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Prebuilt libkiwix + libzim + xapian + ICU (fetched by ../scripts/fetch-ios-libs.sh,
  # run from the root package.json postinstall). Not committed: ~200 MB.
  s.vendored_frameworks = 'Frameworks/CoreKiwix.xcframework'
  s.libraries = 'c++', 'z'

  s.source_files = '*.{h,mm,swift}'
  s.public_header_files = 'NZArchive.h'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'CLANG_CXX_LIBRARY' => 'libc++',
    # Headers are identical in every slice; point at one so NZArchive.mm can include <zim/*.h>.
    'HEADER_SEARCH_PATHS' => '"${PODS_TARGET_SRCROOT}/Frameworks/CoreKiwix.xcframework/ios-arm64/Headers"',
  }
end
