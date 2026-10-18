import ExpoModulesCore

/**
 * Hands car connection changes recorded by the Shortcuts intents (see
 * app-intents/KjorebokCarIntents.swift) to JS. They are kept in UserDefaults
 * until consumed, because an intent can run before JS is up — or while the
 * app is not running at all.
 */
public class CarShortcutModule: Module {
  // Must match KjorebokCarIntents.swift.
  private static let pendingKey = "kjorebok.carShortcut.pending"
  private static let notification = Notification.Name("KjorebokCarShortcut")

  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("CarShortcut")

    Events("onCarShortcut")

    Function("isAvailable") { () -> Bool in
      if #available(iOS 16.0, *) {
        return true
      }
      return false
    }

    Function("consumePending") { () -> [[String: Any]] in
      let defaults = UserDefaults.standard
      let pending = defaults.array(forKey: Self.pendingKey) as? [[String: Any]] ?? []
      defaults.removeObject(forKey: Self.pendingKey)
      return pending
    }

    OnStartObserving {
      self.observer = NotificationCenter.default.addObserver(
        forName: Self.notification,
        object: nil,
        queue: nil
      ) { [weak self] _ in
        self?.sendEvent("onCarShortcut", [:])
      }
    }

    OnStopObserving {
      if let observer = self.observer {
        NotificationCenter.default.removeObserver(observer)
        self.observer = nil
      }
    }
  }
}
