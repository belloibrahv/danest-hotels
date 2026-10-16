import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Role } from '../../../shared/constants';
import { api } from './api';

export interface User {
  id: number;
  name: string;
  username: string;
  role: Role;
}

interface AuthState {
  user: User | null | undefined; // undefined = still checking
  login: (username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState>(null!);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    api<User>('/auth/me').then(setUser, () => setUser(null));
    const out = () => setUser(null);
    window.addEventListener('danest:signed-out', out);
    return () => window.removeEventListener('danest:signed-out', out);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const u = await api<User>('/auth/login', { body: { username, password } });
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { body: {} }).catch(() => {});
    setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, login, logout }}>{children}</Ctx.Provider>;
}

export const can = (user: User | null | undefined, ...roles: Role[]) => !!user && roles.includes(user.role);
export const homeFor = (role: Role) => (role === 'bar' ? '/staff/pos' : '/staff');
