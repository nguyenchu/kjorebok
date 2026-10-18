import { requireOptionalNativeModule } from "expo-modules-core";

export interface PairedDevice {
  address: string;
  name: string;
}

export interface CarBluetoothEvent {
  type: "connected" | "disconnected";
  address: string;
  /** Wall-clock milliseconds. */
  timestamp: number;
}

export interface BluetoothPermissionResponse {
  status: "granted" | "denied" | "undetermined";
  granted: boolean;
  canAskAgain: boolean;
}

interface NativeCarBluetooth {
  isAvailable(): boolean;
  getPermissionsAsync(): Promise<BluetoothPermissionResponse>;
  requestPermissionsAsync(): Promise<BluetoothPermissionResponse>;
  getPairedDevicesAsync(): Promise<PairedDevice[]>;
  startWatchingAsync(taskName: string, addresses: string[]): Promise<void>;
  stopWatchingAsync(taskName: string): Promise<void>;
}

/**
 * Android only. Null on iOS, which gives apps no way to see classic Bluetooth
 * connections in the background, and on binaries built before this module.
 */
const native = requireOptionalNativeModule<NativeCarBluetooth>("CarBluetooth");

export function isCarBluetoothAvailable(): boolean {
  try {
    return native?.isAvailable() ?? false;
  } catch {
    return false;
  }
}

const UNAVAILABLE: BluetoothPermissionResponse = { status: "denied", granted: false, canAskAgain: false };

export async function getCarBluetoothPermissionsAsync(): Promise<BluetoothPermissionResponse> {
  return native ? native.getPermissionsAsync() : UNAVAILABLE;
}

export async function requestCarBluetoothPermissionsAsync(): Promise<BluetoothPermissionResponse> {
  return native ? native.requestPermissionsAsync() : UNAVAILABLE;
}

export async function getPairedDevicesAsync(): Promise<PairedDevice[]> {
  return native ? native.getPairedDevicesAsync() : [];
}

/**
 * Connection changes of these devices reach the expo-task-manager task with
 * this name as `{ events: CarBluetoothEvent[] }`, also when the app is not
 * running. Calling it again replaces the list.
 */
export async function startWatchingCarBluetoothAsync(taskName: string, addresses: string[]): Promise<void> {
  await native?.startWatchingAsync(taskName, addresses);
}

export async function stopWatchingCarBluetoothAsync(taskName: string): Promise<void> {
  await native?.stopWatchingAsync(taskName);
}
