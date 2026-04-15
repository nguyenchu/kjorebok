import { useEffect } from "react";
import { Stack, router, useSegments } from "expo-router";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ensureTrackingConfigured, BACKGROUND_LOCATION_TASK } from "@/lib/tripTracker";

function NavigationGuard() {
  const { user, loading } = useAuth();
  const segments = useSegments();

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === "login";
    if (!user && !inAuthGroup) {
      router.replace("/login");
    } else if (user && inAuthGroup) {
      router.replace("/(tabs)");
    }
  }, [user, loading, segments]);

  return null;
}

function TrackingBootstrap() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading || !user) return;

    const handle = setTimeout(async () => {
      const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
      if (alreadyRunning) {
        ensureTrackingConfigured().catch(() => {});
        return;
      }

      const shown = await AsyncStorage.getItem("tracking_rationale_shown").catch(() => null);
      if (shown) {
        ensureTrackingConfigured().catch(() => {});
        return;
      }

      Alert.alert(
        "Automatisk turregistrering",
        "Kjørebok bruker GPS til å oppdage når du starter og avslutter en kjøretur — helt automatisk, uten at du trenger å gjøre noe.\n\nLokasjonen din brukes kun til å registrere turer og deles ikke med andre.",
        [
          {
            text: "Gi tillatelse",
            onPress: () => {
              AsyncStorage.setItem("tracking_rationale_shown", "1").catch(() => {});
              ensureTrackingConfigured().catch(() => {});
            },
          },
          {
            text: "Ikke nå",
            style: "cancel",
            onPress: () => AsyncStorage.setItem("tracking_rationale_shown", "1").catch(() => {}),
          },
        ]
      );
    }, 1200);

    return () => clearTimeout(handle);
  }, [user, loading]);

  return null;
}

function BootScreen() {
  return (
    <View style={styles.bootScreen}>
      <Text style={styles.bootLogo}>🚗</Text>
      <Text style={styles.bootTitle}>Kjørebok</Text>
      <ActivityIndicator size="small" color="#2563eb" style={styles.bootSpinner} />
    </View>
  );
}

function RootNavigator() {
  const { loading } = useAuth();

  if (loading) {
    return <BootScreen />;
  }

  return (
    <>
      <StatusBar style="dark" backgroundColor="#eef6ff" />
      <NavigationGuard />
      <TrackingBootstrap />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="login" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  bootScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#f8fafc",
  },
  bootLogo: {
    fontSize: 56,
    marginBottom: 12,
  },
  bootTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: "#0f172a",
  },
  bootSpinner: {
    marginTop: 24,
  },
});
