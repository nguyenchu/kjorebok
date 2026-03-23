import { Tabs } from "expo-router";
import { Text } from "react-native";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: "#2563eb",
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
