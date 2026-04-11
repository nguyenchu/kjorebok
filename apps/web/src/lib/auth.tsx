"use client";
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import type { User, LoginDto, RegisterDto } from "@kjorebok/shared";
import { setUnauthorizedHandler } from "./api";
import { getApiBaseUrl } from "./config";

function getBaseUrl(): string {
  return getApiBaseUrl();
}

function getNetworkErrorMessage(): string {
  return `Kunne ikke kontakte API på ${getBaseUrl()}. Sjekk at endepunktet er tilgjengelig og prøv igjen.`;
}

interface AuthState {
  user: User | null;
  loading: boolean;
}
interface AuthContextValue extends AuthState {
  login: (dto: LoginDto) => Promise<void>;
  register: (dto: RegisterDto) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  const clearSession = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("auth_user");
    setState({ user: null, loading: false });
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem("auth_user");
      setState({ user: raw ? JSON.parse(raw) : null, loading: false });
    } catch {
      clearSession();
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => clearSession());
    return () => setUnauthorizedHandler(null);
  }, []);

  async function post<T>(path: string, body: unknown): Promise<T> {
    let res: Response;

    try {
      res = await fetch(`${getBaseUrl()}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error(getNetworkErrorMessage());
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(formatApiError(err.error, `HTTP ${res.status}`));
    }
    return res.json();
  }

  const login = async (dto: LoginDto) => {
    const { user, token } = await post<{ user: User; token: string }>("/auth/login", dto);
    localStorage.setItem("token", token);
    localStorage.setItem("auth_user", JSON.stringify(user));
    setState({ user, loading: false });
  };

  const register = async (dto: RegisterDto) => {
    const { user, token } = await post<{ user: User; token: string }>("/auth/register", dto);
    localStorage.setItem("token", token);
    localStorage.setItem("auth_user", JSON.stringify(user));
    setState({ user, loading: false });
  };

  const logout = () => {
    clearSession();
  };

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
