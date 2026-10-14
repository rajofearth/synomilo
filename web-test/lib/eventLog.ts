/**
 * A global, timestamped event log.
 *
 * This is the single most important part of a debug tool: when a browser call
 * fails, the question is always "what did the signalling layer actually do",
 * and the answer has to be readable on the page rather than buried in devtools
 * next to a dozen other tabs.
 *
 * The store is deliberately outside React. The WebRTC engine and the Convex
 * callbacks push into it directly, so no log line depends on a render being
 * scheduled.
 */
'use client';

import { useSyncExternalStore } from 'react';

export type LogLevel = 'debug' | 'info' | 'signal' | 'good' | 'warn' | 'error';

export type LogEntry = {
  id: number;
  at: number;
  level: LogLevel;
  tag: string;
  message: string;
};

const MAX_ENTRIES = 1500;

let entries: LogEntry[] = [];
let seq = 0;

const listeners = new Set<() => void>();

// Cached snapshots. `useSyncExternalStore` compares snapshots by identity, so
// filtering inside the getter would loop forever.
let snapshotAll: LogEntry[] = entries;
let snapshotNoDebug: LogEntry[] = entries;

function invalidate(): void {
  snapshotAll = entries;
  snapshotNoDebug = entries.filter((entry) => entry.level !== 'debug');
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function logEvent(level: LogLevel, tag: string, message: string): void {
  seq += 1;
  const entry: LogEntry = { id: seq, at: Date.now(), level, tag, message };
  if (entries.length >= MAX_ENTRIES) {
    const kept = entries.slice(entries.length - MAX_ENTRIES + 1);
    kept.push(entry);
    entries = kept;
  } else {
    const next = entries.slice();
    next.push(entry);
    entries = next;
  }
  invalidate();
}

export const log = {
  debug: (tag: string, message: string) => logEvent('debug', tag, message),
  info: (tag: string, message: string) => logEvent('info', tag, message),
  signal: (tag: string, message: string) => logEvent('signal', tag, message),
  good: (tag: string, message: string) => logEvent('good', tag, message),
  warn: (tag: string, message: string) => logEvent('warn', tag, message),
  error: (tag: string, message: string) => logEvent('error', tag, message),
};

export function clearLog(): void {
  entries = [];
  invalidate();
}

export function useLogEntries(includeDebug: boolean): LogEntry[] {
  return useSyncExternalStore(
    subscribe,
    () => (includeDebug ? snapshotAll : snapshotNoDebug),
    () => snapshotNoDebug,
  );
}

export function formatClock(at: number): string {
  const date = new Date(at);
  const pad = (value: number, size = 2) => value.toString().padStart(size, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(
    date.getMilliseconds(),
    3,
  )}`;
}
