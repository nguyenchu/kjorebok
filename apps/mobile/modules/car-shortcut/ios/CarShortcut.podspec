Pod::Spec.new do |s|
  s.name           = 'CarShortcut'
  s.version        = '1.0.0'
  s.summary        = 'Hands Kjørebok car Shortcuts automations to the trip tracker.'
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

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,swift}"
end
