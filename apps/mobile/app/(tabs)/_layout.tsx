import { Tabs } from "expo-router";
import { Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: "#2563eb",
        tabBarInactiveTintColor: "#94a3b8",
        tabBarStyle: {
          borderTopWidth: 0,
          elevation: 8,
          shadowColor: "#000",
          shadowOpacity: 0.06,
          shadowRadius: 12,
          height: 60 + insets.bottom,
          paddingBottom: Math.max(insets.bottom, 8),
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
        headerShadowVisible: false,
        headerStyle: { backgroundColor: "#f8fafc" },
        headerTitleStyle: { fontWeight: "700", fontSize: 18, color: "#0f172a" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Turer",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 22 }}>🚗</Text>,
        }}
      />
      <Tabs.Screen
        name="tracking"
        options={{
          title: "Sporing",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 22 }}>📍</Text>,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profil",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 22 }}>👤</Text>,
        }}
      />
    </Tabs>
  );
}
