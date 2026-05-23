import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, supabaseConfigError } from "../lib/supabase";

type Workspace = "APP" | "WAIS";

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  workspace: Workspace | null;
  email: string | null;
  configError: string;
  signIn: (
    email: string,
    password: string
  ) => Promise<{ success: boolean; message: string }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  async function loadProfile(authUser: User | null) {
    if (!authUser || !supabase) {
      setWorkspace(null);
      setEmail(authUser?.email ?? null);
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("email, workspace")
      .eq("id", authUser.id)
      .single();

    if (error || !data) {
      setWorkspace(null);
      setEmail(authUser.email ?? null);
      return;
    }

    setWorkspace(data.workspace as Workspace);
    setEmail(data.email ?? authUser.email ?? null);
  }

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      if (!supabase) {
        setLoading(false);
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mounted) return;

      setSession(session);
      setUser(session?.user ?? null);
      await loadProfile(session?.user ?? null);
      setLoading(false);
    }

    void bootstrap();

    if (!supabase) {
      return () => {
        mounted = false;
      };
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void (async () => {
        setSession(session);
        setUser(session?.user ?? null);
        await loadProfile(session?.user ?? null);
        setLoading(false);
      })();
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function signIn(email: string, password: string) {
    if (!supabase) {
      return {
        success: false,
        message: supabaseConfigError,
      };
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return {
        success: false,
        message: error.message || "Login failed.",
      };
    }

    return {
      success: true,
      message: "Login successful.",
    };
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
  }

  const value = useMemo<AuthState>(
    () => ({
      user,
      session,
      loading,
      workspace,
      email,
      configError: supabaseConfigError,
      signIn,
      signOut,
    }),
    [user, session, loading, workspace, email]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }

  return context;
}