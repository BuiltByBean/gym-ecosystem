import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Outputs } from '../api';

export type Me = Outputs['auth']['me'];

interface MeState {
  me: Me | undefined;
  loading: boolean;
  refresh: () => Promise<unknown>;
  isStaff: boolean;
  isAdminish: boolean; // owner | admin
  isTrainer: boolean;
  isFrontDesk: boolean;
  isMember: boolean;
  units: 'lb' | 'kg';
}

const MeContext = createContext<MeState | null>(null);

/** Readable text color for an arbitrary brand hex. */
function onColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#ffffff';
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 150 ? '#16181D' : '#ffffff';
}

export function MeProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['me'],
    queryFn: () => api.auth.me.query(),
    staleTime: 60_000,
    retry: 1,
  });
  const me = query.data;

  useEffect(() => {
    const brand = me?.gym?.brandPrimary ?? '#C8472B';
    document.documentElement.style.setProperty('--brand', brand);
    document.documentElement.style.setProperty('--brand-ink', onColor(brand));
  }, [me?.gym?.brandPrimary]);

  const roles = me?.roles ?? [];
  const value: MeState = {
    me,
    loading: query.isLoading,
    refresh: () => qc.invalidateQueries({ queryKey: ['me'] }),
    isStaff: roles.length > 0,
    isAdminish: roles.includes('owner') || roles.includes('admin'),
    isTrainer: roles.includes('trainer'),
    isFrontDesk: roles.includes('front_desk'),
    isMember: me?.memberId != null,
    units: me?.gym?.units ?? 'lb',
  };
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}

export function useMe(): MeState {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error('useMe outside MeProvider');
  return ctx;
}
