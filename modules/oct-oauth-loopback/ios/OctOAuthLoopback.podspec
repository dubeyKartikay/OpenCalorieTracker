require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name             = 'OctOAuthLoopback'
  s.version          = package['version']
  s.summary          = package['description']
  s.description      = package['description']
  s.license          = package['license']
  s.author           = 'OpenCalorieTracker contributors'
  s.homepage         = 'https://github.com/dubeyKartikay/OpenCalorieTracker'
  s.source           = { :git => s.homepage, :tag => s.version.to_s }
  s.platforms        = { :ios => '16.4' }
  s.swift_version    = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks       = 'Network'
  s.source_files     = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
