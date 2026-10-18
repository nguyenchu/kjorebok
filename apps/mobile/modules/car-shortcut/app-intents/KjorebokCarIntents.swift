import AppIntents
import Foundation

// Compiled into the app target by plugin/withCarShortcut.js, not into the
// CarShortcut pod: Shortcuts only lists intents whose metadata Xcode extracts
// from the app target.
//
// iOS gives apps no way to see car Bluetooth connections, but a personal
// automation in Shortcuts ("When iPhone connects to <car>") can run these.
// They only record the change; CarShortcutModule hands it to the tracker.

private enum KjorebokCarShortcut {
  // Must match CarShortcutModule.swift.
  static let pendingKey = "kjorebok.carShortcut.pending"
  static let notification = Notification.Name("KjorebokCarShortcut")
  static let maxPending = 10

  static func record(connected: Bool) {
    let event: [String: Any] = [
      "type": connected ? "connected" : "disconnected",
      "timestamp": Date().timeIntervalSince1970 * 1000,
    ]
    var pending = UserDefaults.standard.array(forKey: pendingKey) as? [[String: Any]] ?? []
    pending.append(event)
    UserDefaults.standard.set(Array(pending.suffix(maxPending)), forKey: pendingKey)
    NotificationCenter.default.post(name: notification, object: nil)
  }
}

@available(iOS 16.0, *)
struct CarConnectedIntent: AppIntent {
  static var title: LocalizedStringResource = "Sitter i bilen"
  static var description = IntentDescription(
    "Forteller Kjørebok at telefonen er koblet til bilen, så sporingen starter med en gang."
  )
  static var openAppWhenRun = false

  func perform() async throws -> some IntentResult {
    KjorebokCarShortcut.record(connected: true)
    return .result()
  }
}

@available(iOS 16.0, *)
struct CarDisconnectedIntent: AppIntent {
  static var title: LocalizedStringResource = "Gått ut av bilen"
  static var description = IntentDescription(
    "Forteller Kjørebok at telefonen er koblet fra bilen, så turen kan avsluttes raskere."
  )
  static var openAppWhenRun = false

  func perform() async throws -> some IntentResult {
    KjorebokCarShortcut.record(connected: false)
    return .result()
  }
}

@available(iOS 16.0, *)
struct KjorebokCarShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(intent: CarConnectedIntent(), phrases: ["Sitter i bilen med \(.applicationName)"])
    AppShortcut(intent: CarDisconnectedIntent(), phrases: ["Gått ut av bilen med \(.applicationName)"])
  }
}
