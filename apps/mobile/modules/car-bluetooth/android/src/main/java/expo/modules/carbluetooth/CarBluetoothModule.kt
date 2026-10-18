package expo.modules.carbluetooth

import android.Manifest
import android.bluetooth.BluetoothManager
import android.content.Context
import android.os.Build
import android.os.Bundle
import expo.modules.interfaces.permissions.Permissions
import expo.modules.interfaces.taskManager.TaskManagerInterface
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Lets the app watch the Bluetooth devices of the user's cars. Connecting to
 * one wakes the tracker through an expo-task-manager task, also when the app
 * is not running. Android only: iOS gives apps no way to see classic
 * Bluetooth connections in the background.
 */
class CarBluetoothModule : Module() {
  private val taskManager: TaskManagerInterface by lazy {
    appContext.legacyModule<TaskManagerInterface>()
      ?: throw IllegalStateException("expo-task-manager is not linked")
  }

  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React context is not available")

  override fun definition() = ModuleDefinition {
    Name("CarBluetooth")

    Function("isAvailable") {
      bluetoothManager()?.adapter != null
    }

    AsyncFunction("getPermissionsAsync") { promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        promise.resolve(grantedBundle())
        return@AsyncFunction
      }
      Permissions.getPermissionsWithPermissionsManager(
        appContext.permissions,
        promise,
        Manifest.permission.BLUETOOTH_CONNECT
      )
    }

    AsyncFunction("requestPermissionsAsync") { promise: Promise ->
      // Install-time permission before Android 12.
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        promise.resolve(grantedBundle())
        return@AsyncFunction
      }
      Permissions.askForPermissionsWithPermissionsManager(
        appContext.permissions,
        promise,
        Manifest.permission.BLUETOOTH_CONNECT
      )
    }

    AsyncFunction("getPairedDevicesAsync") {
      val adapter = bluetoothManager()?.adapter ?: return@AsyncFunction emptyList<Map<String, String>>()
      try {
        adapter.bondedDevices
          .map { device ->
            mapOf(
              "address" to device.address.uppercase(),
              "name" to (device.name ?: device.address)
            )
          }
          .sortedBy { it["name"]?.lowercase() }
      } catch (error: SecurityException) {
        emptyList()
      }
    }

    // Registering again replaces the watched devices.
    AsyncFunction("startWatchingAsync") { taskName: String, addresses: List<String> ->
      val options = mutableMapOf<String, Any>("devices" to addresses.map { it.uppercase() })
      taskManager.registerTask(taskName, CarBluetoothTaskConsumer::class.java, options)
    }

    AsyncFunction("stopWatchingAsync") { taskName: String ->
      if (taskManager.taskHasConsumerOfClass(taskName, CarBluetoothTaskConsumer::class.java)) {
        taskManager.unregisterTask(taskName, CarBluetoothTaskConsumer::class.java)
      }
    }
  }

  private fun bluetoothManager(): BluetoothManager? =
    context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager

  private fun grantedBundle() = Bundle().apply {
    putString("status", "granted")
    putBoolean("granted", true)
    putBoolean("canAskAgain", true)
    putString("expires", "never")
  }
}
