import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";

export interface CarShortcutEvent {
  type: "connected" | "disconnected";
  /** Wall-clock milliseconds. */
  timestamp: number;
}

interface NativeCarShortcut {
  isAvailable(): boolean;
  consumePending(): CarShortcutEvent[];
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

/** Called when a Shortcuts automation runs while JS is alive. */
export function addCarShortcutListener(listener: () => void): EventSubscription | null {
  return native?.addListener("onCarShortcut", listener) ?? null;
}
