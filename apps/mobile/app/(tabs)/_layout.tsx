import { Tabs } from "expo-router";
import { Text, TouchableOpacity } from "react-native";
import { useAuth } from "@/lib/auth";

function LogoutButton() {
  const { logout } = useAuth();
  return (
    <TouchableOpacity onPress={logout} style={{ marginRight: 16 }}>
      <Text style={{ color: "#2563eb", fontWeight: "600" }}>Logg ut</Text>
    </TouchableOpacity>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: "#2563eb",
        headerRight: () => <LogoutButton />,
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
