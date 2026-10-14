'use client';

import { useEffect, useRef, useState } from 'react';
import { clearLog, formatClock, useLogEntries } from '@/lib/eventLog';

const LEVELS = ['debug', 'info', 'signal', 'good', 'warn', 'error'] as const;

export default function EventLog() {
  const [verbose, setVerbose] = useState(false);
  const entries = useLogEntries(verbose);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const node = bodyRef.current;
    if (node && pinned.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [entries]);

  return (
    <section className="panel sticky-log">
      <header>
        <h2>Event log</h2>
        <span className="spacer" />
        <span className="badge">{entries.length}</span>
      </header>
      <div className="log-toolbar">
        <button
          type="button"
          className="ghost small"
          aria-pressed={verbose}
          onClick={() => setVerbose((value) => !value)}
        >
          {verbose ? 'Hide poll noise' : 'Show poll noise'}
        </button>
        <button
          type="button"
          className="ghost small"
          onClick={() => {
            pinned.current = true;
            if (bodyRef.current) {
              bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
            }
          }}
        >
          Jump to latest
        </button>
        <button type="button" className="ghost small" onClick={clearLog}>
          Clear
        </button>
        <span className="hint" style={{ margin: 0 }}>
          levels: {LEVELS.join(' / ')}
        </span>
      </div>
      <div
        className="log-body"
        ref={bodyRef}
        onScroll={(event) => {
          const node = event.currentTarget;
          pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
        }}
      >
        {entries.length === 0 ? (
          <p className="empty">Nothing logged yet.</p>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className={`log-row ${entry.level}`}>
              <span className="log-time">{formatClock(entry.at)}</span>
              <span className="log-tag">[{entry.level}]</span>
              <span className="log-tag">{entry.tag}</span>
              <span className="log-msg">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
