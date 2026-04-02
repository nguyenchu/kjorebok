import { Redirect } from "expo-router";
import { useAuth } from "@/lib/auth";

export default function IndexScreen() {
  const { user, loading } = useAuth();

  if (loading) {
    return null;
  }

  return <Redirect href={user ? "/(tabs)" : "/login"} />;
}
