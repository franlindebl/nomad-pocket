Pod::Spec.new do |s|
  s.name           = 'NomadCarPlay'
  s.version        = '0.1.0'
  s.summary        = 'CarPlay navigation for Nomad Pocket'
  s.description    = 'The offline map, the route and turn-by-turn guidance on a CarPlay screen.'
  s.license        = 'GPL-3.0-or-later'
  s.author         = 'Nomad Pocket contributors'
  s.homepage       = 'https://github.com/franlindebl/nomad-pocket'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/franlindebl/nomad-pocket.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # ExpoAppDelegate and the React Native factory: the car can start the app before the phone does.
  s.dependency 'Expo'
  s.frameworks = 'CarPlay', 'MapKit'

  # The car's map: MapLibre Native, the same Swift package and version maplibre-react-native links
  # into the app (its podspec's $MLRN_NATIVE_VERSION; two versions of one package don't resolve).
  mlrn = File.read(File.join(__dir__, '../../../node_modules/@maplibre/maplibre-react-native/MapLibreReactNative.podspec'))
  maplibre = $MLRN_NATIVE_VERSION || mlrn[/\$MLRN_NATIVE_VERSION \|\|= "([^"]+)"/, 1]
  spm_dependency(s,
    url: 'https://github.com/maplibre/maplibre-gl-native-distribution',
    requirement: { kind: 'exactVersion', version: maplibre },
    products: ['MapLibre']
  )

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
