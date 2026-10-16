import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Role } from '../../../shared/constants';
import { api } from './api';

export interface User {
  id: number;
  name: string;
  username: string;
  role: Role;
  mfa: boolean;
}

export type LoginResult = { user: User } | { challenge: string };

interface AuthState {
  user: User | null | undefined; // undefined = still checking
  login: (username: string, password: string) => Promise<LoginResult>;
  verify: (challenge: string, code: string) => Promise<User & { recovery_codes_left?: number }>;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState>(null!);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    await api<User>('/auth/me').then(setUser, () => setUser(null));
  }, []);

  useEffect(() => {
    refresh();
    const out = () => setUser(null);
    window.addEventListener('danest:signed-out', out);
    return () => window.removeEventListener('danest:signed-out', out);
  }, [refresh]);

  const login = useCallback(async (username: string, password: string): Promise<LoginResult> => {
    const r = await api<User & { mfa_required?: boolean; challenge?: string }>('/auth/login', { body: { username, password } });
    if (r.mfa_required && r.challenge) return { challenge: r.challenge };
    setUser(r);
    return { user: r };
  }, []);

  const verify = useCallback(async (challenge: string, code: string) => {
    const u = await api<User & { recovery_codes_left?: number }>('/auth/login/2fa', { body: { challenge, code } });
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { body: {} }).catch(() => {});
    setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, login, verify, refresh, logout }}>{children}</Ctx.Provider>;
}

export const can = (user: User | null | undefined, ...roles: Role[]) => !!user && roles.includes(user.role);
export const homeFor = (role: Role) => (role === 'bar' ? '/staff/pos' : '/staff');
