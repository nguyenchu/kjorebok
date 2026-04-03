import AsyncStorage from "@react-native-async-storage/async-storage";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3020";
let unauthorizedHandler: (() => Promise<void> | void) | null = null;

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem("token");
}

export async function setToken(token: string): Promise<void> {
  await AsyncStorage.setItem("token", token);
}

export async function clearToken(): Promise<void> {
  await AsyncStorage.removeItem("token");
}

export function setUnauthorizedHandler(
  handler: (() => Promise<void> | void) | null
): void {
  unauthorizedHandler = handler;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getToken();
  const url = `${BASE_URL}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown network error";
    throw new Error(`Network request failed for ${url}: ${message}`);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 401 && token && unauthorizedHandler) {
      await unauthorizedHandler();
    }
    const msg = typeof err.error === "string" ? err.error : JSON.stringify(err.error);
    throw new Error(msg ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
