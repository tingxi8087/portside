import { invoke, isTauri } from '@tauri-apps/api/core';
export { formatProcessMemory } from '@/utils/processMemory';
import type { FloatingStats } from './floating';
import type { Process } from '@/data/demo';
export type SystemProcess = Omit<Process, 'cpu' | 'memory' | 'disk' | 'network'> & {
  cpu: number | null; /** Physical footprint in decimal MB. */ memory: number | null; disk: number | null; network: number | null;
  networkIn: number | null; networkOut: number | null; parent: number; mine: boolean;
  identity: string; executable: string; started: string; metricsNote: string;
};
export type SystemPort = { id: string; port: number; pid: number; protocol: 'TCP' | 'UDP'; address: string; scope: 'local' | 'network' };
export type SystemOverview = { stats: FloatingStats; info: {model: string|null; chip: string|null; cores: number; os: string|null}; uptime: number; disk?: { total: number; used: number }|null };
export type SystemSnapshot = { processes: SystemProcess[]; ports: SystemPort[]; currentUser: string; warnings: string[]; overview?: SystemOverview|null };
export const systemAvailable = isTauri();
export const getSystemSnapshot = () => invoke<SystemSnapshot>('system_snapshot');
export const terminateProcess = (process: SystemProcess, force = false) => invoke<{ exited: boolean; signal: string }>('terminate_process', { pid: process.pid, identity: process.identity, force });
export const metric = (value: number | null | undefined, unit = '') => value == null ? '—' : `${value.toFixed(1)}${unit ? ` ${unit}` : ''}`;
// ProcessIcon only reads name/color. Avoid changing the shared demo model for unrelated views.
export const iconProcess = (process: SystemProcess): Process => ({ ...process, cpu: process.cpu ?? 0, memory: process.memory ?? 0, disk: process.disk ?? 0, network: process.network ?? 0 });
