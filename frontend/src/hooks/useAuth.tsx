import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { api } from '@/lib/api';

// Listen for 401 interceptor force-logout events
const setupForceLogout = (signOut: () => void) => {
  const handler = () => {
    signOut();
  };
  window.addEventListener('force-logout', handler);
  return () => window.removeEventListener('force-logout', handler);
};

interface AuthUser {
  id: string;
  email: string;
  role: 'ADMIN' | 'USER';
}

interface AuthResponse {
  error: Error | null;
  data?: {
    user: AuthUser;
    token: string;
  };
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<AuthResponse>;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const normalizeRole = (role: unknown): AuthUser['role'] | null => {
  if (role === 'ADMIN' || role === 'USER') return role;
  if (role === 'admin') return 'ADMIN';
  if (role === 'user') return 'USER';
  return null;
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const isAuthenticated = !!user && !!token;

  useEffect(() => {
    const storedToken = localStorage.getItem('auth_token');
    const storedUser = localStorage.getItem('auth_user');

    if (storedToken && storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser) as { id?: unknown; email?: unknown; role?: unknown };
        const role = normalizeRole(parsedUser?.role);
        if (typeof parsedUser?.id === 'string' && typeof parsedUser?.email === 'string' && role) {
          setUser({ id: parsedUser.id, email: parsedUser.email, role });
          setToken(storedToken);
        } else {
          localStorage.removeItem('auth_token');
          localStorage.removeItem('auth_user');
        }
      } catch {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
      }
    }

    setLoading(false);
  }, []);

  const signIn = async (email: string, password: string): Promise<AuthResponse> => {
    try {
      const res = await api.post('/api/auth/login', { email, password });
      const data = res.data;
      const role = normalizeRole(data?.user?.role);
      if (!role) {
        throw new Error('Login failed: invalid user role');
      }
      const authUser: AuthUser = {
        id: data.user.id,
        email: data.user.email,
        role,
      };

      localStorage.setItem('auth_token', data.token);
      localStorage.setItem('auth_user', JSON.stringify(authUser));

      setUser(authUser);
      setToken(data.token);

      return { 
        error: null,
        data: {
          user: authUser,
          token: data.token
        }
      };
    } catch (err) {
      const e = err as any;
      const message =
        String(e?.response?.data?.message || '') ||
        String(e?.message || '') ||
        'Login failed';
      return { error: new Error(message) };
    }
  };

  const signUp = async (email: string, password: string) => {
    try {
      const res = await api.post('/api/auth/register', { email, password });
      const data = res.data;

      if (!data) {
        return { error: new Error('Registration failed') };
      }

      return { error: null };
    } catch (err) {
      const e = err as any;
      const message =
        String(e?.response?.data?.message || '') ||
        String(e?.message || '') ||
        'Registration failed';
      return { error: new Error(message) };
    }
  };

  const signOut = async () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    setUser(null);
    setToken(null);
  };

  // Setup force-logout listener for 401 interceptor
  useEffect(() => {
    return setupForceLogout(signOut);
  }, [signOut]);

  return (
    <AuthContext.Provider value={{ user, token, isAuthenticated, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
