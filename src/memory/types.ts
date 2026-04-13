export const MEMORY_SCHEMA_VERSION = 1;

export type MemoryScope = GlobalMemoryScope | ProjectMemoryScope;

export interface GlobalMemoryScope {
  level: 'global';
}

export interface ProjectMemoryScope {
  level: 'project';
  projectKey: string;
}

export type MemorySource = 'manual' | 'auto';

export type MemoryKind = 'fact' | 'instruction' | 'preference' | 'summary' | 'note';

export type MemoryStatus = 'active' | 'disabled' | 'ignored' | 'deleted' | 'candidate';

export interface MemoryRecord {
  id: string;
  scope: MemoryScope;
  source: MemorySource;
  kind: MemoryKind;
  key: string;
  value: string;
  content?: string;
  status: MemoryStatus;
  priority: number;
  evidenceCount: number;
  evidenceTurns?: number[];
  createdAt: string;
  updatedAt: string;
  ignoreUntilTurn?: number | null;
}

export interface MemoryStoreFile {
  version: number;
  scope: MemoryScope;
  records: MemoryRecord[];
  updatedAt: string;
}

export type MemoryMutationAction = 'set' | 'delete' | 'disable' | 'ignore';

export type MemoryScopeInput = MemoryScope | 'global' | 'project';

export type MemoryRecordSelector =
  | { id: string }
  | { key: string; kind?: MemoryKind };

export interface MemoryUpsertInput {
  scope: MemoryScopeInput;
  source: MemorySource;
  kind: MemoryKind;
  key: string;
  value: string;
  content?: string;
  priority?: number;
  evidenceCount?: number;
  evidenceTurns?: number[];
  status?: Extract<MemoryStatus, 'active' | 'disabled' | 'ignored' | 'candidate'>;
  ignoreUntilTurn?: number | null;
}

export interface MemoryIgnoreInput {
  ignoreUntilTurn?: number | null;
}

export interface ResolvedProjectScope {
  scope: ProjectMemoryScope;
  resolver: 'git' | 'path';
  scopePath: string;
}
