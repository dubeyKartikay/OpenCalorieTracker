require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name = 'OctSpeech'
  s.version = package['version']
  s.summary = package['description']
  s.description = package['description']
  s.license = { :type => 'Apache-2.0' }
  s.author = 'OpenCalorieTracker contributors'
  s.homepage = 'https://github.com/dubeyKartikay/OpenCalorieTracker'
  s.source = { :git => 'https://github.com/dubeyKartikay/OpenCalorieTracker.git', :tag => s.version.to_s }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Speech', 'AVFoundation'
  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
