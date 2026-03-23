import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, setToken, clearToken } from "./api";
import type { User, LoginDto, RegisterDto } from "@kjorebok/shared";

interface AuthState {
  user: User | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (dto: LoginDto) => Promise<void>;
  register: (dto: RegisterDto) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const USER_KEY = "auth_user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  // Rehydrate from storage on mount
  useEffect(() => {
    AsyncStorage.getItem(USER_KEY)
      .then((raw) => {
        const user = raw ? (JSON.parse(raw) as User) : null;
        setState({ user, loading: false });
      })
      .catch(() => setState({ user: null, loading: false }));
  }, []);

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
    await clearToken();
    await AsyncStorage.removeItem(USER_KEY);
    setState({ user: null, loading: false });
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
