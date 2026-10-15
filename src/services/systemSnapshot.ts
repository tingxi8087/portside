import type { SystemSnapshot } from './system';
// Explicit user actions must update frozen views too. Match process identity,
// never PID alone, so a later process reusing that PID remains visible.
export function pruneExitedProcesses(snapshot: SystemSnapshot | undefined, exited: ReadonlySet<string>): SystemSnapshot | undefined {
  if (!snapshot || !exited.size) return snapshot;
  const removedPids = new Set(snapshot.processes.filter(process => exited.has(process.identity)).map(process => process.pid));
  if (!removedPids.size) return snapshot;
  return { ...snapshot, processes: snapshot.processes.filter(process => !exited.has(process.identity)), ports: snapshot.ports.filter(port => !removedPids.has(port.pid)) };
}
