import { useCallback, useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { useLocation } from 'react-router-dom';
import { getSystemSnapshot, systemAvailable, type SystemSnapshot } from '@/services/system';
import { pruneExitedProcesses } from '@/services/systemSnapshot';
const useSamplingState = create<{ snapshot?: SystemSnapshot; error: string; loading: boolean; exited: ReadonlySet<string> }>(() => ({ error: '', loading: false, exited: new Set() }));
export function recordProcessExit(identity: string) {
  useSamplingState.setState(state => ({ exited: new Set([...state.exited, identity]) }));
}
let pending: Promise<void> | undefined;
// Shared single-flight sampling across the two mounted views; errors never fabricate an empty snapshot.
export function refreshSystem() {
  if (pending) return pending;
  if (!systemAvailable) { useSamplingState.setState({ error: '请在 Portside 桌面 App 中查看真实系统数据。', loading: false }); return Promise.resolve(); }
  useSamplingState.setState({ loading: true });
  pending = getSystemSnapshot().then(snapshot => useSamplingState.setState({ snapshot, error: '' })).catch(error => useSamplingState.setState({ error: String(error) })).finally(() => { pending = undefined; useSamplingState.setState({ loading: false }); });
  return pending;
}
export function useSystemMonitor(page: 'ports' | 'processes', paused = false) {
  const active = useLocation().pathname === `/${page}`;
  const state = useSamplingState();
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  useEffect(() => { const update = () => setVisible(document.visibilityState === 'visible'); document.addEventListener('visibilitychange', update); return () => document.removeEventListener('visibilitychange', update); }, []);
  useEffect(() => { if (paused || !visible || !active) return; void refreshSystem(); const timer = window.setInterval(() => void refreshSystem(), 2000); return () => clearInterval(timer); }, [paused, visible, active]);
  // Pausing freezes the view even when another mounted consumer refreshes the shared sampler.
  const [frozen, setFrozen] = useState(state.snapshot);
  useEffect(() => { if (!paused) setFrozen(state.snapshot); }, [paused, state.snapshot]);
  const source = paused ? frozen : state.snapshot;
  const snapshot = useMemo(() => pruneExitedProcesses(source, state.exited), [source, state.exited]);
  return { ...state, snapshot, refresh: useCallback(() => refreshSystem(), []) };
}
