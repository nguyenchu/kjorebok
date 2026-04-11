// This file ensures that TaskManager.defineTask (in tripTracker.ts) is registered
// before Expo Router initialises the React tree. Background location tasks must be
// defined synchronously at module evaluation time, before any task handler is
// invoked by the OS — even when the app is woken from a killed state.
import "./src/lib/tripTracker";
import "expo-router/entry";
