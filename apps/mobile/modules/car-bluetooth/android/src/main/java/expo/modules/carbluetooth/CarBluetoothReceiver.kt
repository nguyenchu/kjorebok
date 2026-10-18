package expo.modules.carbluetooth

import android.bluetooth.BluetoothDevice
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Relays Bluetooth connection changes to expo-task-manager, whose own receiver
 * is not exported and so never sees them. The ACL actions are protected and
 * cannot be re-sent by an app, so they go out under actions of our own, which
 * `CarBluetoothTaskConsumer` claims as custom broadcasts.
 */
class CarBluetoothReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = when (intent.action) {
      BluetoothDevice.ACTION_ACL_CONNECTED -> ACTION_CONNECTED
      BluetoothDevice.ACTION_ACL_DISCONNECTED -> ACTION_DISCONNECTED
      else -> return
    }
    val device = deviceFrom(intent) ?: return

    val relay = Intent(action).apply {
      component = ComponentName(context.packageName, TASK_RECEIVER)
      putExtra(EXTRA_ADDRESS, device.address)
      putExtra(EXTRA_TIMESTAMP, System.currentTimeMillis().toDouble())
    }
    context.sendBroadcast(relay)
  }

  private fun deviceFrom(intent: Intent): BluetoothDevice? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
    } else {
      @Suppress("DEPRECATION")
      intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
    }

  companion object {
    const val ACTION_CONNECTED = "com.nguyenchu.kjorebok.CAR_BLUETOOTH_CONNECTED"
    const val ACTION_DISCONNECTED = "com.nguyenchu.kjorebok.CAR_BLUETOOTH_DISCONNECTED"
    const val EXTRA_ADDRESS = "address"
    const val EXTRA_TIMESTAMP = "timestamp"

    private const val TASK_RECEIVER = "expo.modules.taskManager.TaskBroadcastReceiver"
  }
}
