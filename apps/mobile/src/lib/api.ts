import AsyncStorage from "@react-native-async-storage/async-storage";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "https://kjorebok.nguyenchu.com/api";

export function getApiBaseUrl(): string {
  return BASE_URL;
}

let unauthorizedHandler: (() => void | Promise<void>) | null = null;

function formatApiError(error: unknown, fallback: string): string {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return fallback;

  if ("message" in error && typeof error.message === "string") {
    return error.message;
  }

  if ("fieldErrors" in error && error.fieldErrors && typeof error.fieldErrors === "object") {
    const messages = Object.values(error.fieldErrors)
      .flat()
      .filter((message): message is string => typeof message === "string");

    if (messages.length > 0) return messages.join(" ");
  }

  if ("formErrors" in error && Array.isArray(error.formErrors)) {
    const messages = error.formErrors.filter((message): message is string => typeof message === "string");
    if (messages.length > 0) return messages.join(" ");
  }

  return fallback;
}

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
  handler: (() => void | Promise<void>) | null
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
    throw new Error(formatApiError(err.error, `HTTP ${res.status}`));
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
