import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  MEMORY_SCHEMA_VERSION,
  type MemoryIgnoreInput,
  type MemoryRecord,
  type MemoryRecordSelector,
  type MemoryScope,
  type MemoryScopeInput,
  type MemoryStatus,
  type MemoryStoreFile,
  type MemoryUpsertInput,
  type ProjectMemoryScope,
  type ResolvedProjectScope,
} from './types.js';

const execFileAsync = promisify(execFile);
const GLOBAL_STORE_FILE = 'global.json';
const PROJECTS_DIR = 'projects';

export interface MemoryStoreOptions {
  cwd: string;
  baseDir?: string;
  now?: () => Date;
}

export interface MemoryListOptions {
  status?: MemoryStatus | MemoryStatus[];
}

export function resolveDefaultMemoryBaseDir(): string {
  return path.join(os.homedir(), '.rookie-code', 'memory');
}

export async function resolveProjectScope(cwd: string): Promise<ResolvedProjectScope> {
  const realCwd = await fs.realpath(cwd);
  const gitRoot = await getGitRoot(realCwd);

  if (gitRoot) {
    const scopePath = await fs.realpath(gitRoot);
    return {
      scope: {
        level: 'project',
        projectKey: `git-${hashKey(scopePath)}`,
      },
      resolver: 'git',
      scopePath,
    };
  }

  return {
    scope: {
      level: 'project',
      projectKey: `path-${hashKey(realCwd)}`,
    },
    resolver: 'path',
    scopePath: realCwd,
  };
}

export async function resolveMemoryFilePath(
  cwd: string,
  scope: MemoryScopeInput,
  baseDir: string = resolveDefaultMemoryBaseDir(),
): Promise<string> {
  const normalizedScope = await normalizeScopeInput(cwd, scope);
  if (normalizedScope.level === 'global') {
    return path.join(baseDir, GLOBAL_STORE_FILE);
  }
  return path.join(baseDir, PROJECTS_DIR, `${normalizedScope.projectKey}.json`);
}

export class MemoryStore {
  private readonly cwd: string;
  private readonly baseDir: string;
  private readonly now: () => Date;

  constructor(options: MemoryStoreOptions) {
    this.cwd = options.cwd;
    this.baseDir = options.baseDir ?? resolveDefaultMemoryBaseDir();
    this.now = options.now ?? (() => new Date());
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  async resolveScope(scope: MemoryScopeInput): Promise<MemoryScope> {
    return normalizeScopeInput(this.cwd, scope);
  }

  async resolveFilePath(scope: MemoryScopeInput): Promise<string> {
    return resolveMemoryFilePath(this.cwd, scope, this.baseDir);
  }

  async list(scope: MemoryScopeInput, options?: MemoryListOptions): Promise<MemoryRecord[]> {
    const { store } = await this.load(scope);
    const statuses = normalizeStatuses(options?.status);
    return store.records.filter((record) => !statuses || statuses.has(record.status));
  }

  async get(scope: MemoryScopeInput, selector: MemoryRecordSelector): Promise<MemoryRecord | null> {
    const records = await this.list(scope);
    return records.find((record) => matchesSelector(record, selector)) ?? null;
  }

  async set(input: MemoryUpsertInput): Promise<MemoryRecord> {
    return this.upsert(input);
  }

  async upsert(input: MemoryUpsertInput): Promise<MemoryRecord> {
    const scope = await this.resolveScope(input.scope);
    return this.updateStore(scope, (store) => {
      const now = this.now().toISOString();
      const existing = store.records.find(
        (record) => record.key === input.key && record.kind === input.kind,
      );

      const nextRecord: MemoryRecord = {
        id: existing?.id ?? randomUUID(),
        scope,
        source: input.source,
        kind: input.kind,
        key: input.key,
        value: input.value,
        content: input.content,
        status: input.status ?? 'active',
        priority: input.priority ?? existing?.priority ?? 0,
        evidenceCount: input.evidenceCount ?? existing?.evidenceCount ?? 0,
        evidenceTurns: normalizeEvidenceTurns(input.evidenceTurns ?? existing?.evidenceTurns),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        ignoreUntilTurn: normalizeIgnoreUntilTurn(input.status ?? 'active', input.ignoreUntilTurn),
      };

      if (existing) {
        const index = store.records.indexOf(existing);
        store.records[index] = nextRecord;
      } else {
        store.records.push(nextRecord);
      }

      return nextRecord;
    });
  }

  async delete(scope: MemoryScopeInput, selector: MemoryRecordSelector): Promise<MemoryRecord | null> {
    return this.updateStatus(scope, selector, 'deleted');
  }

  async disable(scope: MemoryScopeInput, selector: MemoryRecordSelector): Promise<MemoryRecord | null> {
    return this.updateStatus(scope, selector, 'disabled');
  }

  async ignore(
    scope: MemoryScopeInput,
    selector: MemoryRecordSelector,
    input: MemoryIgnoreInput = {},
  ): Promise<MemoryRecord | null> {
    return this.updateStatus(scope, selector, 'ignored', input.ignoreUntilTurn);
  }

  private async updateStatus(
    scopeInput: MemoryScopeInput,
    selector: MemoryRecordSelector,
    status: MemoryStatus,
    ignoreUntilTurn?: number | null,
  ): Promise<MemoryRecord | null> {
    const scope = await this.resolveScope(scopeInput);
    return this.updateStore(scope, (store) => {
      const existing = store.records.find((record) => matchesSelector(record, selector));
      if (!existing) {
        return null;
      }

      const nextRecord: MemoryRecord = {
        ...existing,
        status,
        updatedAt: this.now().toISOString(),
        ignoreUntilTurn: normalizeIgnoreUntilTurn(status, ignoreUntilTurn),
      };
      const index = store.records.indexOf(existing);
      store.records[index] = nextRecord;
      return nextRecord;
    });
  }

  private async updateStore<T>(
    scope: MemoryScope,
    updater: (store: MemoryStoreFile) => T,
  ): Promise<T> {
    const loaded = await this.load(scope);
    const result = updater(loaded.store);
    loaded.store.updatedAt = this.now().toISOString();
    await this.writeStore(loaded.filePath, loaded.store);
    return result;
  }

  private async load(scopeInput: MemoryScopeInput): Promise<{ filePath: string; store: MemoryStoreFile }> {
    const scope = await this.resolveScope(scopeInput);
    const filePath = await this.resolveFilePath(scope);

    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      return {
        filePath,
        store: validateStoreFile(parsed, scope),
      };
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return {
          filePath,
          store: createEmptyStore(scope, this.now().toISOString()),
        };
      }

      const recovered = createEmptyStore(scope, this.now().toISOString());
      await recoverCorruptedFile(filePath, error, rawErrorMessage(error));
      await this.writeStore(filePath, recovered);
      return {
        filePath,
        store: recovered,
      };
    }
  }

  private async writeStore(filePath: string, store: MemoryStoreFile): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
    await fs.rename(tempPath, filePath);
  }
}

async function normalizeScopeInput(cwd: string, scope: MemoryScopeInput): Promise<MemoryScope> {
  if (scope === 'global') {
    return { level: 'global' };
  }
  if (scope === 'project') {
    return (await resolveProjectScope(cwd)).scope;
  }
  if (scope.level === 'global') {
    return scope;
  }
  return normalizeProjectScope(scope);
}

async function getGitRoot(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd });
    const root = stdout.trim();
    return root || null;
  } catch {
    return null;
  }
}

function hashKey(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function normalizeProjectScope(scope: ProjectMemoryScope): ProjectMemoryScope {
  if (!scope.projectKey.trim()) {
    throw new Error('Project memory scope requires a non-empty projectKey.');
  }
  return {
    level: 'project',
    projectKey: scope.projectKey,
  };
}

function normalizeStatuses(status?: MemoryStatus | MemoryStatus[]): Set<MemoryStatus> | null {
  if (!status) {
    return null;
  }
  return new Set(Array.isArray(status) ? status : [status]);
}

function matchesSelector(record: MemoryRecord, selector: MemoryRecordSelector): boolean {
  if ('id' in selector) {
    return record.id === selector.id;
  }
  if (record.key !== selector.key) {
    return false;
  }
  return selector.kind ? record.kind === selector.kind : true;
}

function normalizeIgnoreUntilTurn(
  status: Extract<MemoryStatus, 'active' | 'disabled' | 'ignored' | 'deleted' | 'candidate'>,
  ignoreUntilTurn?: number | null,
): number | null | undefined {
  if (status !== 'ignored') {
    return null;
  }
  return ignoreUntilTurn ?? null;
}

function normalizeEvidenceTurns(value: number[] | undefined): number[] | undefined {
  if (!value || value.length === 0) {
    return undefined;
  }

  return [...new Set(value)].sort((left, right) => left - right);
}

function createEmptyStore(scope: MemoryScope, updatedAt: string): MemoryStoreFile {
  return {
    version: MEMORY_SCHEMA_VERSION,
    scope,
    records: [],
    updatedAt,
  };
}

function validateStoreFile(value: unknown, expectedScope: MemoryScope): MemoryStoreFile {
  if (!isObject(value)) {
    throw new Error('Memory store file must be an object.');
  }

  if (value.version !== MEMORY_SCHEMA_VERSION) {
    throw new Error(`Unsupported memory store schema version: ${String(value.version)}`);
  }

  const scope = validateScope(value.scope);
  if (!sameScope(scope, expectedScope)) {
    throw new Error('Memory store scope does not match requested scope.');
  }

  if (!Array.isArray(value.records)) {
    throw new Error('Memory store records must be an array.');
  }

  if (typeof value.updatedAt !== 'string') {
    throw new Error('Memory store updatedAt must be a string.');
  }

  return {
    version: MEMORY_SCHEMA_VERSION,
    scope,
    records: value.records.map(validateRecord),
    updatedAt: value.updatedAt,
  };
}

function validateRecord(value: unknown): MemoryRecord {
  if (!isObject(value)) {
    throw new Error('Memory record must be an object.');
  }

  const scope = validateScope(value.scope);
  const content = value.content;
  const evidenceTurns = value.evidenceTurns;
  const ignoreUntilTurn = value.ignoreUntilTurn;

  if (typeof value.id !== 'string' || !value.id) {
    throw new Error('Memory record id must be a non-empty string.');
  }
  if (typeof value.source !== 'string' || !['manual', 'auto'].includes(value.source)) {
    throw new Error('Memory record source is invalid.');
  }
  if (typeof value.kind !== 'string') {
    throw new Error('Memory record kind must be a string.');
  }
  if (typeof value.key !== 'string' || !value.key) {
    throw new Error('Memory record key must be a non-empty string.');
  }
  if (typeof value.value !== 'string') {
    throw new Error('Memory record value must be a string.');
  }
  if (content !== undefined && typeof content !== 'string') {
    throw new Error('Memory record content must be a string when provided.');
  }
  if (typeof value.status !== 'string' || !['active', 'disabled', 'ignored', 'deleted', 'candidate'].includes(value.status)) {
    throw new Error('Memory record status is invalid.');
  }
  if (typeof value.priority !== 'number' || Number.isNaN(value.priority)) {
    throw new Error('Memory record priority must be a number.');
  }
  if (typeof value.evidenceCount !== 'number' || Number.isNaN(value.evidenceCount)) {
    throw new Error('Memory record evidenceCount must be a number.');
  }
  if (evidenceTurns !== undefined && (!Array.isArray(evidenceTurns) || evidenceTurns.some((turn) => !Number.isInteger(turn) || turn < 0))) {
    throw new Error('Memory record evidenceTurns must be an array of non-negative integers when provided.');
  }
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') {
    throw new Error('Memory record timestamps must be strings.');
  }
  if (ignoreUntilTurn !== undefined && ignoreUntilTurn !== null && typeof ignoreUntilTurn !== 'number') {
    throw new Error('Memory record ignoreUntilTurn must be a number, null, or undefined.');
  }

  return {
    id: value.id,
    scope,
    source: value.source as MemoryRecord['source'],
    kind: value.kind as MemoryRecord['kind'],
    key: value.key,
    value: value.value,
    content,
    status: value.status as MemoryRecord['status'],
    priority: value.priority,
    evidenceCount: value.evidenceCount,
    evidenceTurns: normalizeEvidenceTurns(evidenceTurns),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ignoreUntilTurn,
  };
}

function validateScope(value: unknown): MemoryScope {
  if (!isObject(value) || typeof value.level !== 'string') {
    throw new Error('Memory scope is invalid.');
  }

  if (value.level === 'global') {
    return { level: 'global' };
  }

  if (value.level === 'project' && typeof value.projectKey === 'string' && value.projectKey) {
    return {
      level: 'project',
      projectKey: value.projectKey,
    };
  }

  throw new Error('Project memory scope is invalid.');
}

function sameScope(left: MemoryScope, right: MemoryScope): boolean {
  if (left.level !== right.level) {
    return false;
  }
  if (left.level === 'global') {
    return true;
  }
  return right.level === 'project' && left.projectKey === right.projectKey;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function recoverCorruptedFile(filePath: string, error: unknown, details: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const suffix = new Date().toISOString().replace(/[.:]/g, '-');
  const backupPath = `${filePath}.corrupt-${suffix}.bak`;

  try {
    await fs.rename(filePath, backupPath);
    return;
  } catch {
    const markerPath = `${filePath}.corrupt-${suffix}.txt`;
    const message = [
      'Memory store recovery marker',
      `source: ${filePath}`,
      `error: ${details}`,
      `rawError: ${rawErrorMessage(error)}`,
    ].join('\n');
    await fs.writeFile(markerPath, `${message}\n`, 'utf8');
  }
}

function rawErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
