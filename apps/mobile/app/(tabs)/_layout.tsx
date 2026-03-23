import { Tabs } from "expo-router";
import { Text, TouchableOpacity } from "react-native";
import { useAuth } from "@/lib/auth";

export default function TabsLayout() {
  const { logout } = useAuth();

  const logoutButton = (
    <TouchableOpacity onPress={logout} style={{ marginRight: 16 }}>
      <Text style={{ color: "#2563eb", fontWeight: "600" }}>Logg ut</Text>
    </TouchableOpacity>
  );

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: "#2563eb",
        headerRight: () => logoutButton,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Turer",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>🚗</Text>,
        }}
      />
      <Tabs.Screen
        name="tracking"
        options={{
          title: "Sporing",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>📍</Text>,
        }}
      />
      <Tabs.Screen
        name="vehicles"
        options={{
          title: "Kjøretøy",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>🚘</Text>,
        }}
      />
    </Tabs>
  );
}
