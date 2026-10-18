Pod::Spec.new do |s|
  s.name           = 'MotionActivity'
  s.version        = '1.0.0'
  s.summary        = 'Motion activity (driving, walking, still) for Kjørebok trip detection.'
  s.description    = s.summary
  s.license        = 'UNLICENSED'
  s.author         = 'Kjørebok'
  s.homepage       = 'https://github.com/nguyenchu/kjorebok'
  s.platforms      = {
    :ios => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CoreMotion'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,swift}"
end
