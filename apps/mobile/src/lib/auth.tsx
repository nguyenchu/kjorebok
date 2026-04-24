import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, setToken, clearToken, setUnauthorizedHandler } from "./api";
import { stopTracking } from "./tripTracker";
import type { User, LoginDto, RegisterDto } from "@kjorebok/shared";

interface AuthState {
  user: User | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (dto: LoginDto) => Promise<void>;
  register: (dto: RegisterDto) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const USER_KEY = "auth_user";
const TOKEN_KEY = "token";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  const clearSession = useCallback(async ({ stop = false } = {}) => {
    if (stop) {
      await stopTracking().catch(() => {});
    }
    await clearToken();
    await AsyncStorage.removeItem(USER_KEY);
    setState({ user: null, loading: false });
  }, []);

  // Rehydrate from storage on mount
  useEffect(() => {
    Promise.all([AsyncStorage.getItem(USER_KEY), AsyncStorage.getItem(TOKEN_KEY)])
      .then(([rawUser, token]) => {
        const user = rawUser ? (JSON.parse(rawUser) as User) : null;
        if (token) {
          void setToken(token);
        } else {
          void clearToken();
        }
        setState({ user, loading: false });
      })
      .catch(() => setState({ user: null, loading: false }));
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => clearSession());
    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

  const login = async (dto: LoginDto) => {
    const { user, token } = await api.post<{ user: User; token: string }>(
      "/auth/login",
      dto
    );
    await setToken(token);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
    setState({ user, loading: false });
  };

  const register = async (dto: RegisterDto) => {
    const { user, token } = await api.post<{ user: User; token: string }>(
      "/auth/register",
      dto
    );
    await setToken(token);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
    setState({ user, loading: false });
  };

  const logout = async () => {
    await clearSession({ stop: true });
  };

  const deleteAccount = async () => {
    await stopTracking().catch(() => {});
    await api.delete<void>("/auth/me");
    await clearSession();
  };

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout, deleteAccount }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
