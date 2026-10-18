import CoreMotion
import ExpoModulesCore

/**
 * iOS side of motion detection. CoreMotion cannot wake a suspended app, so
 * live changes are only emitted while iOS keeps the app running in the
 * background (it does while location updates are on); history queries cover
 * the rest, since the coprocessor records activity even while the app sleeps.
 */
public class MotionActivityModule: Module {
  private let manager = CMMotionActivityManager()
  private let queue: OperationQueue = {
    let queue = OperationQueue()
    queue.name = "MotionActivityModule"
    queue.maxConcurrentOperationCount = 1
    return queue
  }()
  private var updating = false
  private var lastActivity: String?

  public func definition() -> ModuleDefinition {
    Name("MotionActivity")

    Events("onActivityChange")

    Function("isAvailable") { () -> Bool in
      CMMotionActivityManager.isActivityAvailable()
    }

    AsyncFunction("getPermissionsAsync") { () -> [String: Any] in
      Self.permissionResponse()
    }

    AsyncFunction("requestPermissionsAsync") { (promise: Promise) in
      guard CMMotionActivityManager.isActivityAvailable(),
            CMMotionActivityManager.authorizationStatus() == .notDetermined else {
        promise.resolve(Self.permissionResponse())
        return
      }
      // There is no explicit request API: the first query shows the prompt
      // and completes once the user has answered.
      let now = Date()
      self.manager.queryActivityStarting(from: now.addingTimeInterval(-60), to: now, to: self.queue) { _, _ in
        promise.resolve(Self.permissionResponse())
      }
    }

    // The task name only matters on Android, where events go through
    // expo-task-manager; here they are emitted as `onActivityChange`.
    AsyncFunction("startTransitionsAsync") { (_: String) in
      self.startUpdates()
    }

    AsyncFunction("stopTransitionsAsync") { (_: String) in
      self.stopUpdates()
    }

    AsyncFunction("hasStartedTransitionsAsync") { (_: String) -> Bool in
      self.updating
    }

    AsyncFunction("queryRecentAsync") { (minutes: Double, promise: Promise) in
      guard CMMotionActivityManager.isActivityAvailable(),
            CMMotionActivityManager.authorizationStatus() == .authorized else {
        promise.resolve([] as [[String: Any]])
        return
      }
      let now = Date()
      self.manager.queryActivityStarting(from: now.addingTimeInterval(-minutes * 60), to: now, to: self.queue) { activities, _ in
        let samples = (activities ?? []).compactMap { activity -> [String: Any]? in
          guard let name = Self.activityName(activity) else { return nil }
          return [
            "activity": name,
            "confidence": Self.confidenceName(activity.confidence),
            "timestamp": activity.startDate.timeIntervalSince1970 * 1000,
          ]
        }
        promise.resolve(samples)
      }
    }

    OnDestroy {
      self.stopUpdates()
    }
  }

  private func startUpdates() {
    guard !updating, CMMotionActivityManager.isActivityAvailable() else { return }
    updating = true
    manager.startActivityUpdates(to: queue) { [weak self] activity in
      guard let self, let activity, activity.confidence != .low,
            let name = Self.activityName(activity), name != self.lastActivity else { return }

      let timestamp = activity.startDate.timeIntervalSince1970 * 1000
      var events: [[String: Any]] = []
      // Mirror Android's transitions: leaving the car is its own event.
      if self.lastActivity == "automotive" {
        events.append(["activity": "automotive", "transition": "exit", "timestamp": timestamp])
      }
      events.append(["activity": name, "transition": "enter", "timestamp": timestamp])
      self.lastActivity = name
      self.sendEvent("onActivityChange", ["events": events])
    }
  }

  private func stopUpdates() {
    guard updating else { return }
    manager.stopActivityUpdates()
    updating = false
    lastActivity = nil
  }

  private static func activityName(_ activity: CMMotionActivity) -> String? {
    if activity.automotive { return "automotive" }
    if activity.cycling { return "cycling" }
    if activity.running { return "running" }
    if activity.walking { return "walking" }
    if activity.stationary { return "stationary" }
    return nil
  }

  private static func confidenceName(_ confidence: CMMotionActivityConfidence) -> String {
    switch confidence {
    case .high: return "high"
    case .medium: return "medium"
    default: return "low"
    }
  }

  private static func permissionResponse() -> [String: Any] {
    let status: String
    var canAskAgain = false
    if !CMMotionActivityManager.isActivityAvailable() {
      status = "denied"
    } else {
      switch CMMotionActivityManager.authorizationStatus() {
      case .authorized:
        status = "granted"
      case .notDetermined:
        status = "undetermined"
        canAskAgain = true
      default:
        status = "denied"
      }
    }
    return [
      "status": status,
      "granted": status == "granted",
      "canAskAgain": canAskAgain,
      "expires": "never",
    ]
  }
}
