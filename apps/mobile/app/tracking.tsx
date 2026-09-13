import { useEffect, useMemo, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView, Linking } from "react-native";
import { router, Stack } from "expo-router";
import Constants from "expo-constants";
import {
  ensureTrackingConfigured,
  getTrackerState,
  syncActiveTrip,
  type TrackerDiagnostics,
} from "@/lib/tripTracker";
import { assessTrackerHealth } from "@/lib/trackerHealth";
import { formatDistanceToNowStrict } from "date-fns";
import { nb } from "date-fns/locale";

function formatRelativeTime(timestamp: string | null): string {
  if (!timestamp) return "Ikke registrert ennå";

  try {
    return `${formatDistanceToNowStrict(new Date(timestamp), {
      addSuffix: true,
      locale: nb,
    })}`;
  } catch {
    return timestamp;
  }
}

export default function TrackingScreen() {
  const [tracker, setTracker] = useState<TrackerDiagnostics | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const refresh = async () => {
    setTracker(await getTrackerState());
  };

  useEffect(() => {
    refresh().catch(() => {});
    const interval = setInterval(() => {
      refresh().catch(() => {});
    }, 15000);

    return () => clearInterval(interval);
  }, []);

  const handleEnable = async () => {
    try {
      const enabled = await ensureTrackingConfigured();
      await refresh();
      if (!enabled) {
        Alert.alert("Tillatelser mangler", "Gi appen tilgang til bakgrunnslokasjon for at telefonen skal kunne registrere turer automatisk.");
      }
    } catch (error: any) {
      Alert.alert("Feil", error?.message ?? "Kunne ikke aktivere sporing.");
    }
  };

  const handleSync = async () => {
    try {
      await syncActiveTrip();
      await refresh();
    } catch (error: any) {
      Alert.alert("Sync feilet", error?.message ?? "Kunne ikke synkronisere turen.");
    }
  };

  const tracking = tracker?.trackingEnabled ?? false;
  const state = tracker?.state ?? "IDLE";
  const activeTripId = tracker?.activeTripId ?? null;
  const pendingPoints = tracker?.pendingPoints ?? 0;
  const hasToken = tracker?.hasToken ?? false;
  const notificationPermission = tracker?.notificationPermission ?? "undetermined";
  const locationServicesEnabled = tracker?.locationServicesEnabled ?? false;
  const foregroundPermission = tracker?.foregroundPermission ?? "undetermined";
  const backgroundPermission = tracker?.backgroundPermission ?? "undetermined";
  const lastPointTimestamp = tracker?.lastPointTimestamp ?? null;
  const lastTaskAt = tracker?.lastTaskAt ?? null;
  const lastSyncAt = tracker?.lastSyncAt ?? null;
  const lastSpeedKmh = tracker?.lastSpeedKmh ?? null;
  const lastAccuracyMeters = tracker?.lastAccuracyMeters ?? null;
  const startCandidateCount = tracker?.startCandidateCount ?? 0;
  const startReason = tracker?.startReason ?? "Telefonen venter på tydelig bevegelse.";
  const recentEvents = tracker?.recentEvents ?? [];

  const health = tracker ? assessTrackerHealth(tracker) : null;
  const needsAttention = health?.needsAttention ?? false;
  const needsPermission = health?.needsPermission ?? false;
  const taskSeemsStale = health?.taskSeemsStale ?? false;
  const headline = health?.headline ?? "Henter status…";
  const summary = health?.summary ?? "Leser av sporingsstatus fra telefonen.";

  const detailHint = useMemo(() => {
    if (pendingPoints > 0) return `${pendingPoints} punkt venter fortsatt på å bli sendt.`;
    if (activeTripId) return "Hvis bilen står stille en stund, avsluttes turen automatisk.";
    if (startCandidateCount > 0) return "Telefonen ser tegn til bevegelse og vurderer om en ny tur har startet.";
    if (needsAttention) return "Åpne feilsøking nedenfor hvis du vil se mer detaljert status.";
    return "Alt ser klart ut akkurat nå.";
  }, [activeTripId, needsAttention, pendingPoints, startCandidateCount]);

  const primaryAction = useMemo(() => {
    if (!hasToken) {
      return {
        label: "Gå til innlogging",
        onPress: () => {
          router.replace("/login");
        },
      };
    }

    if (!locationServicesEnabled || needsPermission) {
      return {
        label: "Åpne innstillinger",
        onPress: async () => {
          await Linking.openSettings();
        },
      };
    }

    if (!tracking) {
      return {
        label: "Aktiver sporing",
        onPress: handleEnable,
      };
    }

    if (taskSeemsStale) {
      return {
        label: "Start sporing på nytt",
        onPress: handleEnable,
      };
    }

    if (pendingPoints > 0 || activeTripId) {
      return {
        label: "Send ventende data",
        onPress: handleSync,
      };
    }

    return {
      label: "Oppdater nå",
      onPress: refresh,
    };
  }, [activeTripId, hasToken, locationServicesEnabled, needsPermission, pendingPoints, taskSeemsStale, tracking]);

  const stateLabel: Record<string, string> = {
    IDLE: "Venter på bevegelse",
    DETECTING_START: "Sjekker om ny tur har startet",
    RECORDING: "Registrerer tur",
    DETECTING_STOP: "Sjekker om turen er avsluttet",
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Sporing",
          headerBackTitle: "Profil",
          headerStyle: { backgroundColor: "#eef6ff" },
          headerShadowVisible: false,
          headerTintColor: "#0f172a",
          headerTitleStyle: { fontWeight: "700", fontSize: 18, color: "#0f172a" },
        }}
      />

      <View style={styles.stateCard}>
        <Text style={styles.stateLabel}>{headline}</Text>
        <Text style={styles.statusMeta}>{summary}</Text>
        <Text style={styles.stateSubLabel}>{stateLabel[state] ?? state}</Text>
        <View
          style={[
            styles.dot,
            needsAttention
              ? { backgroundColor: "#ef4444" }
              : tracking
                ? { backgroundColor: state === "RECORDING" ? "#22c55e" : "#f59e0b" }
                : undefined,
          ]}
        />
      </View>

      <View style={styles.helperCard}>
        <Text style={styles.helperText}>{detailHint}</Text>
      </View>

      <View style={styles.reasonCard}>
        <Text style={styles.sectionTitle}>Status for automatisk turstart</Text>
        <Text style={styles.reasonText}>{startReason}</Text>
        <Text style={styles.reasonMeta}>
          {lastSpeedKmh !== null ? `Siste fart ${lastSpeedKmh.toFixed(1)} km/t` : "Ingen fersk fart ennå"}
          {" · "}
          {lastAccuracyMeters !== null ? `GPS ±${Math.round(lastAccuracyMeters)} m` : "Ingen fersk GPS-nøyaktighet ennå"}
        </Text>
      </View>

      <TouchableOpacity style={[styles.button, needsAttention && styles.warningButton]} onPress={primaryAction.onPress} activeOpacity={0.85}>
        <Text style={styles.buttonText}>{primaryAction.label}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.secondaryButton} onPress={() => setShowDetails((value) => !value)} activeOpacity={0.85}>
        <Text style={styles.secondaryButtonText}>{showDetails ? "Skjul feilsøking" : "Åpne feilsøking"}</Text>
      </TouchableOpacity>

      {showDetails && (
        <>
          <View style={styles.metaCard}>
            <Text style={styles.sectionTitle}>Feilsøking</Text>
            <Text style={styles.metaRow}>App-versjon: {Constants.expoConfig?.version ?? "ukjent"}</Text>
            <Text style={styles.metaRow}>Status: {stateLabel[state] ?? state}</Text>
            <Text style={styles.metaRow}>Innlogget sesjon: {hasToken ? "Ja" : "Nei"}</Text>
            <Text style={styles.metaRow}>Posisjonstjenester: {locationServicesEnabled ? "På" : "Av"}</Text>
            <Text style={styles.metaRow}>Forgrunnslokasjon: {foregroundPermission}</Text>
            <Text style={styles.metaRow}>Bakgrunnslokasjon: {backgroundPermission}</Text>
            <Text style={styles.metaRow}>Notifikasjonstillatelse: {notificationPermission}</Text>
            <Text style={styles.metaRow}>Ventende punkter: {pendingPoints}</Text>
            <Text style={styles.metaRow}>Siste fart: {lastSpeedKmh !== null ? `${lastSpeedKmh.toFixed(1)} km/t` : "Ikke registrert"}</Text>
            <Text style={styles.metaRow}>Siste GPS-nøyaktighet: {lastAccuracyMeters !== null ? `${Math.round(lastAccuracyMeters)} m` : "Ikke registrert"}</Text>
            <Text style={styles.metaRow}>Sist bakgrunnsoppgave kjørte: {formatRelativeTime(lastTaskAt)}</Text>
            <Text style={styles.metaRow}>Siste GPS-punkt: {formatRelativeTime(lastPointTimestamp)}</Text>
            <Text style={styles.metaRow}>Siste vellykkede sync: {formatRelativeTime(lastSyncAt)}</Text>
          </View>

          <View style={styles.logCard}>
            <Text style={styles.sectionTitle}>Siste hendelser</Text>
            {recentEvents.length === 0 ? (
              <Text style={styles.logEmpty}>Ingen hendelser registrert ennå.</Text>
            ) : (
              recentEvents.map((event, index) => (
                <View key={`${event.timestamp}-${index}`} style={styles.logEntry}>
                  <Text
                    style={[
                      styles.logLevel,
                      event.level === "error" && styles.logLevelError,
                      event.level === "warn" && styles.logLevelWarn,
                    ]}
                  >
                    {event.level.toUpperCase()}
                  </Text>
                  <Text style={styles.logMessage}>{event.message}</Text>
                  <Text style={styles.logTime}>{formatRelativeTime(event.timestamp)}</Text>
                </View>
              ))
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  content: { padding: 20, paddingBottom: 32 },
  stateCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 24,
    alignItems: "center",
    marginBottom: 24,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  stateLabel: { fontSize: 18, fontWeight: "600", marginBottom: 8, textAlign: "center" },
  statusMeta: { fontSize: 13, color: "#64748b", marginBottom: 8, textAlign: "center", lineHeight: 19 },
  stateSubLabel: { fontSize: 13, color: "#334155", marginBottom: 8, textAlign: "center", fontWeight: "600" },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#cbd5e1",
  },
  metaCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  helperCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  reasonCard: {
    backgroundColor: "#eff6ff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#bfdbfe",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 10,
  },
  helperText: {
    color: "#475569",
    fontSize: 14,
    lineHeight: 20,
  },
  reasonText: {
    color: "#1e3a8a",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
  },
  reasonMeta: {
    color: "#475569",
    fontSize: 13,
    marginTop: 10,
  },
  metaRow: {
    color: "#334155",
    fontSize: 14,
    marginBottom: 8,
  },
  button: {
    backgroundColor: "#2563eb",
    borderRadius: 12,
    padding: 18,
    alignItems: "center",
    marginBottom: 12,
  },
  manualButton: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 18,
    alignItems: "center",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#cbd5e1",
  },
  warningButton: { backgroundColor: "#0f172a" },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  manualButtonText: { color: "#0f172a", fontSize: 16, fontWeight: "700" },
  secondaryButton: {
    alignItems: "center",
    paddingVertical: 10,
    marginBottom: 16,
  },
  secondaryButtonText: {
    color: "#2563eb",
    fontSize: 15,
    fontWeight: "600",
  },
  logCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  logEmpty: { color: "#64748b", fontSize: 14 },
  logEntry: {
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e2e8f0",
  },
  logLevel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#2563eb",
    marginBottom: 4,
  },
  logLevelWarn: {
    color: "#b45309",
  },
  logLevelError: {
    color: "#dc2626",
  },
  logMessage: {
    fontSize: 14,
    color: "#0f172a",
    marginBottom: 4,
  },
  logTime: {
    fontSize: 12,
    color: "#64748b",
  },
});
