function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== "undefined") return `${window.location.origin}/api`;
  return "http://localhost:3020";
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

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

export function setUnauthorizedHandler(
  handler: (() => void | Promise<void>) | null
): void {
  unauthorizedHandler = handler;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${getBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
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
  getBlob: async (path: string): Promise<Blob> => {
    const token = getToken();
    const res = await fetch(`${getBaseUrl()}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  },
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
