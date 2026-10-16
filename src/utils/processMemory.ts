// Native sampler supplies physical footprint in decimal MB (not RSS / MiB).
export const formatProcessMemory = (mb: number | null | undefined): string =>
  mb == null || !Number.isFinite(mb) || mb < 0 ? '—' : mb >= 1000 ? `${(mb / 1000).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
