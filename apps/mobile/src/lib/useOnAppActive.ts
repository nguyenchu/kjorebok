import { useEffect, useRef } from "react";
import { AppState } from "react-native";

/**
 * Runs `callback` whenever the app comes back to the foreground. Focus effects
 * do not fire then, so without this a screen kept showing what it read before
 * the user went to the system settings — permissions they had just granted
 * still showed as missing.
 */
export function useOnAppActive(callback: () => void): void {
  const latest = useRef(callback);
  latest.current = callback;

  useEffect(() => {
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && previous !== "active") latest.current();
      previous = next;
    });
    return () => subscription.remove();
  }, []);
}
