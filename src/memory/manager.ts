import type { Message } from '../types.js';
import { countMessagesTokens, countTokens } from '../utils/tokens.js';
import type {
  MemoryIgnoreInput,
  MemoryKind,
  MemoryRecord,
  MemoryScope,
  MemoryScopeInput,
  MemoryStatus,
  MemoryUpsertInput,
} from './types.js';

const DEFAULT_MEMORY_TOKEN_LIMIT = 600;
const MEMORY_TOKEN_RATIO = 0.15;
const PROMPT_SAFETY_RATIO = 0.9;
const MAX_MEMORY_LINE_LENGTH = 240;
const AUTO_MEMORY_REPEAT_THRESHOLD = 2;
const AUTO_MEMORY_MAX_SENTENCE_LENGTH = 160;
const AUTO_MEMORY_MAX_CANDIDATES_PER_TURN = 4;
const AUTO_MEMORY_DIRECT_TRIGGER_RE = /(以后|默认|记住|不要再|别再|始终|请一直)/;
const AUTO_MEMORY_SECRET_RE = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|secret|authorization|密码|口令|令牌|密钥|token)|(?:sk-[a-z0-9]{12,}|ghp_[a-z0-9]{20,}|AKIA[0-9A-Z]{16}|eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/i;
const AUTO_MEMORY_ACCOUNT_RE = /(?:邮箱|email|账号|account|手机号|phone|用户名|username)\s*[:：=]/i;
const AUTO_MEMORY_TICKET_RE = /(?:\b[A-Z]{2,10}-\d{1,8}\b|\bTT\d{4,}\b|\bBUG[- ]?\d{3,}\b|工单|ticket|单号|case id|issue\s*#?\d+)/i;

export interface MemoryStoreReader {
  list(
    scope: MemoryScopeInput,
    options?: { status?: MemoryStatus | MemoryStatus[] },
  ): Promise<MemoryRecord[]>;
}

export interface MemoryStoreWriter {
  get(scope: MemoryScopeInput, selector: { id: string } | { key: string; kind?: MemoryKind }): Promise<MemoryRecord | null>;
  resolveScope(scope: MemoryScopeInput): Promise<MemoryScope>;
  set(input: MemoryUpsertInput): Promise<MemoryRecord>;
  delete(scope: MemoryScopeInput, selector: { id: string } | { key: string; kind?: MemoryKind }): Promise<MemoryRecord | null>;
  disable(scope: MemoryScopeInput, selector: { id: string } | { key: string; kind?: MemoryKind }): Promise<MemoryRecord | null>;
  ignore(
    scope: MemoryScopeInput,
    selector: { id: string } | { key: string; kind?: MemoryKind },
    input?: MemoryIgnoreInput,
  ): Promise<MemoryRecord | null>;
}

export interface MemorySnapshot {
  global: MemoryRecord[];
  project: MemoryRecord[];
}

export type MemoryPromptFallbackMode = 'none' | 'full' | 'trimmed' | 'manual_only' | 'omitted';

export interface BuildMemoryPromptParams {
  baseSystemPrompt: string;
  messages: Message[];
  tokenBudget?: number;
  currentTurn?: number;
}

export interface BuildMemoryPromptResult {
  snapshot: MemorySnapshot;
  memorySection: string | null;
  memoryTokens: number;
  memoryTokenLimit: number;
  fallbackMode: MemoryPromptFallbackMode;
}

export interface MemoryManagerOptions {
  getCurrentTurn?: () => number;
}

export interface AutoMemoryCaptureInput {
  userInput: string;
  turn: number;
  scope?: MemoryScopeInput;
}

export interface AutoMemoryCaptureResult {
  observed: number;
  stored: MemoryRecord[];
  promoted: MemoryRecord[];
  protectedManual: MemoryRecord[];
}

interface AutoMemoryObservation {
  kind: MemoryKind;
  key: string;
  value: string;
  priority: number;
  direct: boolean;
}

export class MemoryManager {
  private currentTurn = 0;

  constructor(
    private readonly store: MemoryStoreReader & Partial<MemoryStoreWriter>,
    private readonly options: MemoryManagerOptions = {},
  ) {}

  getCurrentTurn(): number {
    return this.options.getCurrentTurn?.() ?? this.currentTurn;
  }

  advanceTurn(): number {
    this.currentTurn += 1;
    return this.currentTurn;
  }

  async list(
    scope: MemoryScopeInput,
    options?: { status?: MemoryStatus | MemoryStatus[] },
  ): Promise<MemoryRecord[]> {
    return this.store.list(scope, options);
  }

  async get(
    scope: MemoryScopeInput,
    selector: { id: string } | { key: string; kind?: MemoryKind },
  ): Promise<MemoryRecord | null> {
    return this.requireWritableStore('get').get(scope, selector);
  }

  async resolveScope(scope: MemoryScopeInput): Promise<MemoryScope> {
    return this.requireWritableStore('resolveScope').resolveScope(scope);
  }

  async set(input: MemoryUpsertInput): Promise<MemoryRecord> {
    return this.requireWritableStore('set').set(input);
  }

  async delete(
    scope: MemoryScopeInput,
    selector: { id: string } | { key: string; kind?: MemoryKind },
  ): Promise<MemoryRecord | null> {
    return this.requireWritableStore('delete').delete(scope, selector);
  }

  async disable(
    scope: MemoryScopeInput,
    selector: { id: string } | { key: string; kind?: MemoryKind },
  ): Promise<MemoryRecord | null> {
    return this.requireWritableStore('disable').disable(scope, selector);
  }

  async ignore(
    scope: MemoryScopeInput,
    selector: { id: string } | { key: string; kind?: MemoryKind },
    input?: MemoryIgnoreInput,
  ): Promise<MemoryRecord | null> {
    return this.requireWritableStore('ignore').ignore(scope, selector, input);
  }

  async captureAutoMemory(input: AutoMemoryCaptureInput): Promise<AutoMemoryCaptureResult> {
    const scope = input.scope ?? 'project';
    const observations = extractAutoMemoryObservations(input.userInput);
    const stored: MemoryRecord[] = [];
    const promoted: MemoryRecord[] = [];
    const protectedManual: MemoryRecord[] = [];

    for (const observation of observations) {
      const manualRecord = await this.findManualRecord(observation.key, observation.kind);
      if (manualRecord) {
        if (sameObservationValue(manualRecord, observation.value)) {
          protectedManual.push(await this.bumpEvidence(manualRecord, input.turn));
        } else {
          protectedManual.push(manualRecord);
        }
        continue;
      }

      const existing = await this.get(scope, { key: observation.key, kind: observation.kind });
      if (existing?.source === 'manual' && existing.status !== 'deleted') {
        if (sameObservationValue(existing, observation.value)) {
          protectedManual.push(await this.bumpEvidence(existing, input.turn));
        } else {
          protectedManual.push(existing);
        }
        continue;
      }

      const baseRecord = existing?.source === 'auto' && existing.value === observation.value
        ? existing
        : null;
      const evidenceTurns = mergeEvidenceTurns(baseRecord?.evidenceTurns, input.turn);
      const evidenceCount = Math.max(baseRecord?.evidenceCount ?? 0, evidenceTurns.length);
      const shouldPromote = observation.direct || evidenceCount >= AUTO_MEMORY_REPEAT_THRESHOLD;
      const nextStatus = resolveAutoMemoryStatus(baseRecord?.status, shouldPromote);
      const record = await this.set({
        scope,
        source: 'auto',
        kind: observation.kind,
        key: observation.key,
        value: observation.value,
        priority: observation.priority,
        status: nextStatus,
        evidenceCount,
        evidenceTurns,
      });

      stored.push(record);
      if (record.status === 'active') {
        promoted.push(record);
      }
    }

    return {
      observed: observations.length,
      stored,
      promoted,
      protectedManual,
    };
  }

  async getSnapshot(): Promise<MemorySnapshot> {
    const [global, project] = await Promise.all([
      this.store.list('global', { status: ['active', 'disabled', 'ignored'] }),
      this.store.list('project', { status: ['active', 'disabled', 'ignored'] }),
    ]);

    return { global, project };
  }

  async buildPromptSection(params: BuildMemoryPromptParams): Promise<BuildMemoryPromptResult> {
    const snapshot = await this.getSnapshot();
    const currentTurn = params.currentTurn ?? this.getCurrentTurn();
    const promptRecords = preparePromptRecords(snapshot, currentTurn);
    const memoryTokenLimit = resolveMemoryTokenLimit({
      tokenBudget: params.tokenBudget,
      baseSystemPrompt: params.baseSystemPrompt,
      messages: params.messages,
    });

    if (promptRecords.length === 0) {
      return {
        snapshot,
        memorySection: null,
        memoryTokens: 0,
        memoryTokenLimit,
        fallbackMode: 'none',
      };
    }

    if (memoryTokenLimit <= 0) {
      return {
        snapshot,
        memorySection: null,
        memoryTokens: 0,
        memoryTokenLimit,
        fallbackMode: 'omitted',
      };
    }

    const trimmedAttempt = fitRecordsWithinBudget(promptRecords, memoryTokenLimit);
    if (trimmedAttempt.memorySection) {
      return {
        snapshot,
        memorySection: trimmedAttempt.memorySection,
        memoryTokens: trimmedAttempt.memoryTokens,
        memoryTokenLimit,
        fallbackMode: trimmedAttempt.trimmed ? 'trimmed' : 'full',
      };
    }

    const fallbackAttempt = buildFallbackSection(promptRecords, memoryTokenLimit);
    if (fallbackAttempt.memorySection) {
      return {
        snapshot,
        memorySection: fallbackAttempt.memorySection,
        memoryTokens: fallbackAttempt.memoryTokens,
        memoryTokenLimit,
        fallbackMode: 'manual_only',
      };
    }

    return {
      snapshot,
      memorySection: null,
      memoryTokens: 0,
      memoryTokenLimit,
      fallbackMode: 'omitted',
    };
  }

  private requireWritableStore<K extends keyof MemoryStoreWriter>(method: K): Pick<MemoryStoreWriter, K> {
    const candidate = this.store[method];
    if (typeof candidate !== 'function') {
      throw new Error(`Memory store does not support ${String(method)}().`);
    }

    return { [method]: candidate.bind(this.store) } as Pick<MemoryStoreWriter, K>;
  }

  private async findManualRecord(key: string, kind: MemoryKind): Promise<MemoryRecord | null> {
    const [projectRecord, globalRecord] = await Promise.all([
      this.get('project', { key, kind }),
      this.get('global', { key, kind }),
    ]);

    if (projectRecord?.source === 'manual' && projectRecord.status !== 'deleted') {
      return projectRecord;
    }
    if (globalRecord?.source === 'manual' && globalRecord.status !== 'deleted') {
      return globalRecord;
    }

    return null;
  }

  private async bumpEvidence(record: MemoryRecord, turn: number): Promise<MemoryRecord> {
    const evidenceTurns = mergeEvidenceTurns(record.evidenceTurns, turn);
    const evidenceCount = Math.max(record.evidenceCount, evidenceTurns.length);

    return this.set({
      scope: record.scope,
      source: record.source,
      kind: record.kind,
      key: record.key,
      value: record.value,
      content: record.content,
      priority: record.priority,
      status: record.status === 'deleted' ? 'active' : record.status,
      evidenceCount,
      evidenceTurns,
      ignoreUntilTurn: record.ignoreUntilTurn,
    });
  }
}

function resolveMemoryTokenLimit(params: {
  tokenBudget?: number;
  baseSystemPrompt: string;
  messages: Message[];
}): number {
  if (!params.tokenBudget) {
    return DEFAULT_MEMORY_TOKEN_LIMIT;
  }

  const proportionalLimit = Math.floor(params.tokenBudget * MEMORY_TOKEN_RATIO);
  const configuredLimit = Math.min(DEFAULT_MEMORY_TOKEN_LIMIT, proportionalLimit);
  const reservedPromptBudget = Math.floor(params.tokenBudget * PROMPT_SAFETY_RATIO);
  const remainingBudget = reservedPromptBudget
    - countTokens(params.baseSystemPrompt)
    - countMessagesTokens(params.messages);

  return Math.max(0, Math.min(configuredLimit, remainingBudget));
}

function extractAutoMemoryObservations(userInput: string): AutoMemoryObservation[] {
  const candidates = splitIntoCandidateSentences(userInput)
    .flatMap((sentence) => detectAutoMemoryObservation(sentence) ?? [])
    .slice(0, AUTO_MEMORY_MAX_CANDIDATES_PER_TURN);

  const deduped = new Map<string, AutoMemoryObservation>();
  for (const candidate of candidates) {
    const key = [candidate.kind, candidate.key, candidate.value].join('::');
    const existing = deduped.get(key);
    if (!existing || candidate.direct) {
      deduped.set(key, candidate);
    }
  }

  return [...deduped.values()];
}

function splitIntoCandidateSentences(userInput: string): string[] {
  return userInput
    .replace(/\r\n/g, '\n')
    .split(/[\n。！？!?；;]+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
    .filter((sentence) => sentence.length <= AUTO_MEMORY_MAX_SENTENCE_LENGTH)
    .filter((sentence) => !shouldRejectAutoMemorySentence(sentence));
}

function shouldRejectAutoMemorySentence(sentence: string): boolean {
  return looksSensitive(sentence)
    || looksTransient(sentence)
    || looksLikeCodeSnippet(sentence)
    || sentence.includes('```')
    || sentence.includes('`');
}

function looksSensitive(sentence: string): boolean {
  return AUTO_MEMORY_SECRET_RE.test(sentence) || AUTO_MEMORY_ACCOUNT_RE.test(sentence);
}

function looksTransient(sentence: string): boolean {
  return AUTO_MEMORY_TICKET_RE.test(sentence);
}

function looksLikeCodeSnippet(sentence: string): boolean {
  if ((sentence.includes('{') || sentence.includes('}') || sentence.includes(';')) && /(const|let|var|function|class|return|import|export|=>)/.test(sentence)) {
    return true;
  }

  if (/[<>]/.test(sentence) && /\/(src|app|tmp|users|api)\//i.test(sentence)) {
    return true;
  }

  if (/^[\[{].*[\]}]$/.test(sentence)) {
    return true;
  }

  return false;
}

function detectAutoMemoryObservation(sentence: string): AutoMemoryObservation | null {
  const direct = AUTO_MEMORY_DIRECT_TRIGGER_RE.test(sentence);

  const matchers: Array<() => AutoMemoryObservation | null> = [
    () => detectLanguagePreference(sentence, direct),
    () => detectTablePreference(sentence, direct),
    () => detectEmojiPreference(sentence, direct),
    () => detectVerbosityPreference(sentence, direct),
    () => detectConclusionFirstPreference(sentence, direct),
    () => detectMinimalDiffPreference(sentence, direct),
  ];

  for (const matcher of matchers) {
    const match = matcher();
    if (match) {
      return match;
    }
  }

  return null;
}

function detectLanguagePreference(sentence: string, direct: boolean): AutoMemoryObservation | null {
  if (/(?:请|以后|默认|记住)?(?:都)?(?:用|使用)?中文(?:回复|回答|输出|交流|沟通)?/.test(sentence) || /回复(?:请)?用中文/.test(sentence)) {
    return {
      kind: 'preference',
      key: 'language',
      value: 'zh-CN',
      priority: 60,
      direct,
    };
  }

  if (/(?:请|以后|默认|记住)?(?:都)?(?:用|使用)?英文(?:回复|回答|输出|交流|沟通)?/.test(sentence) || /回复(?:请)?用英文/.test(sentence)) {
    return {
      kind: 'preference',
      key: 'language',
      value: 'en-US',
      priority: 60,
      direct,
    };
  }

  return null;
}

function detectTablePreference(sentence: string, direct: boolean): AutoMemoryObservation | null {
  if (/(?:不要|别|勿|避免|禁止|不用).*(?:markdown\s*表格|表格|tables?)/i.test(sentence)) {
    return {
      kind: 'instruction',
      key: 'format.table',
      value: 'Avoid tables unless the user explicitly asks for them.',
      priority: 80,
      direct,
    };
  }

  return null;
}

function detectEmojiPreference(sentence: string, direct: boolean): AutoMemoryObservation | null {
  if (/(?:不要|别|勿|避免|禁止|不用).*(?:emoji|表情|颜文字|emojis?)/i.test(sentence)) {
    return {
      kind: 'instruction',
      key: 'style.emoji',
      value: 'Do not add emoji unless the user explicitly asks for them.',
      priority: 80,
      direct,
    };
  }

  return null;
}

function detectVerbosityPreference(sentence: string, direct: boolean): AutoMemoryObservation | null {
  if (/(?:简洁|简短|简明|精炼|精简|别太啰嗦|少一点废话)/.test(sentence)) {
    return {
      kind: 'preference',
      key: 'verbosity',
      value: 'concise',
      priority: 60,
      direct,
    };
  }

  if (/(?:详细|展开|具体|多解释|别太简略|多一点细节)/.test(sentence)) {
    return {
      kind: 'preference',
      key: 'verbosity',
      value: 'detailed',
      priority: 60,
      direct,
    };
  }

  return null;
}

function detectConclusionFirstPreference(sentence: string, direct: boolean): AutoMemoryObservation | null {
  if (/(?:先给结论|先说结论|直接给结论|结论先行|先告诉我结论)/.test(sentence)) {
    return {
      kind: 'instruction',
      key: 'response.order',
      value: 'Lead with the conclusion before details.',
      priority: 80,
      direct,
    };
  }

  return null;
}

function detectMinimalDiffPreference(sentence: string, direct: boolean): AutoMemoryObservation | null {
  if (/(?:最小改动|少改|只改必要|改动尽量小|diff.*尽量小|patch.*尽量小)/i.test(sentence)) {
    return {
      kind: 'instruction',
      key: 'patching.style',
      value: 'Keep diffs minimal and targeted.',
      priority: 80,
      direct,
    };
  }

  return null;
}

function mergeEvidenceTurns(turns: number[] | undefined, turn: number): number[] {
  return [...new Set([...(turns ?? []), turn])].sort((left, right) => left - right);
}

function resolveAutoMemoryStatus(
  existingStatus: MemoryStatus | undefined,
  shouldPromote: boolean,
): Extract<MemoryStatus, 'active' | 'disabled' | 'ignored' | 'candidate'> {
  if (existingStatus === 'disabled') {
    return 'disabled';
  }
  if (!shouldPromote) {
    return 'candidate';
  }
  if (existingStatus === 'ignored') {
    return 'ignored';
  }
  return 'active';
}

function preparePromptRecords(snapshot: MemorySnapshot, currentTurn: number): MemoryRecord[] {
  const filtered = [...snapshot.global, ...snapshot.project].filter(
    (record) => !isRecordSkipped(record, currentTurn),
  );

  const deduped = new Map<string, MemoryRecord>();
  for (const record of filtered.sort(compareForDedup)) {
    const dedupeKey = buildDedupeKey(record);
    if (!deduped.has(dedupeKey)) {
      deduped.set(dedupeKey, record);
    }
  }

  return [...deduped.values()].sort(compareForRender);
}

function isRecordSkipped(record: MemoryRecord, currentTurn: number): boolean {
  if (record.status === 'disabled') {
    return true;
  }

  if (record.status !== 'ignored') {
    return false;
  }

  if (record.ignoreUntilTurn == null) {
    return true;
  }

  return record.ignoreUntilTurn >= currentTurn;
}

function buildDedupeKey(record: MemoryRecord): string {
  return [
    record.kind,
    normalizeWhitespace(record.key).toLowerCase(),
    getPromptValue(record).toLowerCase(),
  ].join('::');
}

function compareForDedup(left: MemoryRecord, right: MemoryRecord): number {
  return compareRecords(left, right, {
    sourceRank: { manual: 0, auto: 1 },
    scopeRank: { project: 0, global: 1 },
  });
}

function compareForRender(left: MemoryRecord, right: MemoryRecord): number {
  const leftPersona = isPersonaSummary(left) ? 0 : 1;
  const rightPersona = isPersonaSummary(right) ? 0 : 1;
  if (leftPersona !== rightPersona) {
    return leftPersona - rightPersona;
  }

  return compareRecords(left, right, {
    sourceRank: { manual: 0, auto: 1 },
    scopeRank: { project: 0, global: 1 },
  });
}

function compareForRemoval(left: MemoryRecord, right: MemoryRecord): number {
  return compareRecords(left, right, {
    sourceRank: { auto: 0, manual: 1 },
    scopeRank: { global: 0, project: 1 },
    priorityDirection: 'asc',
    updatedDirection: 'asc',
    evidenceDirection: 'asc',
  });
}

function compareRecords(
  left: MemoryRecord,
  right: MemoryRecord,
  options: {
    sourceRank: Record<'manual' | 'auto', number>;
    scopeRank: Record<'global' | 'project', number>;
    priorityDirection?: 'asc' | 'desc';
    evidenceDirection?: 'asc' | 'desc';
    updatedDirection?: 'asc' | 'desc';
  },
): number {
  const sourceDiff = options.sourceRank[left.source] - options.sourceRank[right.source];
  if (sourceDiff !== 0) {
    return sourceDiff;
  }

  const scopeDiff = options.scopeRank[left.scope.level] - options.scopeRank[right.scope.level];
  if (scopeDiff !== 0) {
    return scopeDiff;
  }

  const priorityDiff = compareNumber(left.priority, right.priority, options.priorityDirection ?? 'desc');
  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  const evidenceDiff = compareNumber(
    left.evidenceCount,
    right.evidenceCount,
    options.evidenceDirection ?? 'desc',
  );
  if (evidenceDiff !== 0) {
    return evidenceDiff;
  }

  return compareDate(left.updatedAt, right.updatedAt, options.updatedDirection ?? 'desc');
}

function compareNumber(left: number, right: number, direction: 'asc' | 'desc'): number {
  return direction === 'asc' ? left - right : right - left;
}

function compareDate(left: string, right: string, direction: 'asc' | 'desc'): number {
  const leftValue = Date.parse(left);
  const rightValue = Date.parse(right);

  if (Number.isNaN(leftValue) || Number.isNaN(rightValue)) {
    return direction === 'asc' ? left.localeCompare(right) : right.localeCompare(left);
  }

  return direction === 'asc' ? leftValue - rightValue : rightValue - leftValue;
}

function fitRecordsWithinBudget(
  records: MemoryRecord[],
  tokenLimit: number,
): { memorySection: string | null; memoryTokens: number; trimmed: boolean } {
  const selected = [...records];
  let trimmed = false;

  while (selected.length > 0) {
    const rendered = renderMemorySection(selected);
    if (!rendered) {
      return { memorySection: null, memoryTokens: 0, trimmed };
    }

    const renderedTokens = countTokens(rendered);
    if (renderedTokens <= tokenLimit) {
      return {
        memorySection: rendered,
        memoryTokens: renderedTokens,
        trimmed,
      };
    }

    const removed = removeNextRecord(selected);
    if (!removed) {
      break;
    }
    trimmed = true;
  }

  return { memorySection: null, memoryTokens: 0, trimmed: true };
}

function removeNextRecord(records: MemoryRecord[]): boolean {
  const candidateGroups: Array<(record: MemoryRecord) => boolean> = [
    (record) => record.source === 'auto',
    (record) => record.scope.level === 'global',
    (record) => record.scope.level === 'project',
  ];

  for (const isCandidate of candidateGroups) {
    const candidates = records
      .map((record, index) => ({ record, index }))
      .filter(({ record }) => isCandidate(record))
      .sort((left, right) => compareForRemoval(left.record, right.record));

    const candidate = candidates[0];
    if (!candidate) {
      continue;
    }

    records.splice(candidate.index, 1);
    return true;
  }

  return false;
}

function buildFallbackSection(
  records: MemoryRecord[],
  tokenLimit: number,
): { memorySection: string | null; memoryTokens: number } {
  const personaRecords = records.filter(isPersonaSummary);
  const manualRecords = records.filter((record) => record.source === 'manual' && !isPersonaSummary(record));

  const selected = [...personaRecords];
  const personaSection = renderMemorySection(selected);
  if (selected.length > 0) {
    if (!personaSection) {
      return { memorySection: null, memoryTokens: 0 };
    }

    const personaTokens = countTokens(personaSection);
    if (personaTokens > tokenLimit) {
      return { memorySection: null, memoryTokens: 0 };
    }
  }

  for (const record of manualRecords) {
    const nextSelection = [...selected, record].sort(compareForRender);
    const rendered = renderMemorySection(nextSelection);
    if (!rendered) {
      continue;
    }

    const renderedTokens = countTokens(rendered);
    if (renderedTokens > tokenLimit) {
      continue;
    }

    selected.splice(0, selected.length, ...nextSelection);
  }

  const memorySection = renderMemorySection(selected);
  if (!memorySection) {
    return { memorySection: null, memoryTokens: 0 };
  }

  const memoryTokens = countTokens(memorySection);
  if (memoryTokens > tokenLimit) {
    return { memorySection: null, memoryTokens: 0 };
  }

  return { memorySection, memoryTokens };
}

function renderMemorySection(records: MemoryRecord[]): string | null {
  if (records.length === 0) {
    return null;
  }

  const personaRecords = records.filter(isPersonaSummary);
  const manualRecords = records.filter((record) => record.source === 'manual' && !isPersonaSummary(record));
  const autoRecords = records.filter((record) => record.source === 'auto' && !isPersonaSummary(record));

  const lines = [
    '## Long-term Memory',
    'Use these compact notes as soft context. Follow current user instructions first if they conflict.',
  ];

  if (personaRecords.length > 0) {
    lines.push('', '### Persona Summary');
    for (const record of personaRecords) {
      lines.push(`- ${getPromptValue(record)}`);
    }
  }

  if (manualRecords.length > 0) {
    lines.push('', '### Manual Memory');
    for (const record of manualRecords) {
      lines.push(formatMemoryBullet(record));
    }
  }

  if (autoRecords.length > 0) {
    lines.push('', '### Auto Memory');
    for (const record of autoRecords) {
      lines.push(formatMemoryBullet(record));
    }
  }

  return lines.join('\n');
}

function isPersonaSummary(record: MemoryRecord): boolean {
  return record.kind === 'summary';
}

function formatMemoryBullet(record: MemoryRecord): string {
  const scopeLabel = record.scope.level === 'project' ? 'Project' : 'Global';
  const kindLabel = capitalize(record.kind);
  const keyLabel = normalizeWhitespace(record.key);
  const value = getPromptValue(record);
  return `- ${scopeLabel} ${kindLabel} — ${keyLabel}: ${value}`;
}

function getPromptValue(record: MemoryRecord): string {
  const rawValue = normalizeWhitespace(record.content?.trim() ? record.content : record.value);
  if (rawValue.length <= MAX_MEMORY_LINE_LENGTH) {
    return rawValue;
  }

  return `${rawValue.slice(0, MAX_MEMORY_LINE_LENGTH - 1)}…`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function sameObservationValue(record: MemoryRecord, nextValue: string): boolean {
  return normalizeWhitespace(record.value).toLowerCase() === normalizeWhitespace(nextValue).toLowerCase();
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
