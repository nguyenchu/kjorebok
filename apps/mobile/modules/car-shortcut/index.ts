import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";

export interface CarShortcutEvent {
  type: "connected" | "disconnected";
  /** The vehicle picked in the automation; absent when none was. */
  vehicleId?: string;
  /** Wall-clock milliseconds. */
  timestamp: number;
}

export interface ShortcutVehicle {
  id: string;
  label: string;
  registration: string;
}

interface NativeCarShortcut {
  isAvailable(): boolean;
  consumePending(): CarShortcutEvent[];
  setVehicles(vehicles: ShortcutVehicle[]): void;
  addListener(eventName: "onCarShortcut", listener: () => void): EventSubscription;
}

/**
 * iOS only. Null on Android, which watches Bluetooth directly instead, and on
 * binaries built before this module.
 */
const native = requireOptionalNativeModule<NativeCarShortcut>("CarShortcut");

/** True on iOS 16+, where the Shortcuts actions exist. */
export function isCarShortcutAvailable(): boolean {
  try {
    return native?.isAvailable() ?? false;
  } catch {
    return false;
  }
}

/** Returns the changes recorded by Shortcuts since the last call, and clears them. */
export function consumeCarShortcutEvents(): CarShortcutEvent[] {
  try {
    return native?.consumePending() ?? [];
  } catch {
    return [];
  }
}

/** The vehicles Shortcuts offers to pick from in "Sitter i bilen". */
export function setCarShortcutVehicles(vehicles: ShortcutVehicle[]): void {
  try {
    native?.setVehicles(vehicles);
  } catch {
    // Best-effort: the automation then falls back to the default vehicle.
  }
}

/** Called when a Shortcuts automation runs while JS is alive. */
export function addCarShortcutListener(listener: () => void): EventSubscription | null {
  return native?.addListener("onCarShortcut", listener) ?? null;
}
