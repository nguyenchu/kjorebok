package expo.modules.motionactivity

import android.Manifest
import android.os.Build
import android.os.Bundle
import expo.modules.interfaces.permissions.Permissions
import expo.modules.interfaces.taskManager.TaskManagerInterface
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android side of motion detection: activity transitions from Google Play
 * services, delivered through expo-task-manager so they reach JS even when the
 * app is not running. There is no history to query on Android, so
 * `queryRecentAsync` always returns an empty list.
 */
class MotionActivityModule : Module() {
  private val taskManager: TaskManagerInterface by lazy {
    appContext.legacyModule<TaskManagerInterface>()
      ?: throw IllegalStateException("expo-task-manager is not linked")
  }

  override fun definition() = ModuleDefinition {
    Name("MotionActivity")

    // Only iOS emits live changes; declared so the shared JS API can subscribe.
    Events("onActivityChange")

    Function("isAvailable") {
      true
    }

    AsyncFunction("getPermissionsAsync") { promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
        promise.resolve(grantedBundle())
        return@AsyncFunction
      }
      Permissions.getPermissionsWithPermissionsManager(
        appContext.permissions,
        promise,
        Manifest.permission.ACTIVITY_RECOGNITION
      )
    }

    AsyncFunction("requestPermissionsAsync") { promise: Promise ->
      // Install-time permission before Android 10.
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
        promise.resolve(grantedBundle())
        return@AsyncFunction
      }
      Permissions.askForPermissionsWithPermissionsManager(
        appContext.permissions,
        promise,
        Manifest.permission.ACTIVITY_RECOGNITION
      )
    }

    AsyncFunction("startTransitionsAsync") { taskName: String ->
      taskManager.registerTask(taskName, MotionTransitionTaskConsumer::class.java, mutableMapOf<String, Any>())
    }

    AsyncFunction("stopTransitionsAsync") { taskName: String ->
      if (taskManager.taskHasConsumerOfClass(taskName, MotionTransitionTaskConsumer::class.java)) {
        taskManager.unregisterTask(taskName, MotionTransitionTaskConsumer::class.java)
      }
    }

    AsyncFunction("hasStartedTransitionsAsync") { taskName: String ->
      taskManager.taskHasConsumerOfClass(taskName, MotionTransitionTaskConsumer::class.java)
    }

    AsyncFunction("queryRecentAsync") { _: Double ->
      emptyList<Map<String, Any>>()
    }
  }

  private fun grantedBundle() = Bundle().apply {
    putString("status", "granted")
    putBoolean("granted", true)
    putBoolean("canAskAgain", true)
    putString("expires", "never")
  }
}
