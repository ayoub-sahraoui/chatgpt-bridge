import type { BridgeErrorShape, BridgeFile } from '../../lib/protocol';

export interface SendTaskParams {
  message?: string;
  files?: BridgeFile[];
  stream?: boolean;
  newChat?: boolean;
  batchMs?: number;
  generationTimeoutMs?: number;
}

export interface DiagnosticsInfo {
  url: string;
  title: string;
  loggedIn: boolean;
  isGenerating: boolean;
  turnCount: number;
  assistantCount: number;
  /** selector group → css selector → number of matches */
  found: Record<string, Record<string, number>>;
  composerSnippet?: string;
}

export interface TaskEvent {
  event: 'task.started' | 'task.delta' | 'task.completed' | 'task.failed' | 'task.cancelled';
  payload: Record<string, unknown>;
}

export class ContentError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ContentError';
    this.code = code;
  }
  toShape(): BridgeErrorShape {
    return { code: this.code, message: this.message };
  }
}
