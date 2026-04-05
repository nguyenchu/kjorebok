import { useEffect } from "react";
import { Stack, router, useSegments } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ensureTrackingConfigured } from "@/lib/tripTracker";

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

    const handle = setTimeout(() => {
      ensureTrackingConfigured().catch(() => {});
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
