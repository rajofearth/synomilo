'use client';

import { useEffect, useRef } from 'react';
import { convexClient, type QueryRef } from './api';

/**
 * Subscribe to a Convex query. Used for the signalling query so a new offer or
 * ICE candidate is applied the instant it lands, rather than on the next tick of
 * an interval.
 */
export function useConvexSubscription<T>(
  query: QueryRef | null,
  args: Record<string, unknown> | null,
  onValue: (value: T) => void,
  onError?: (error: unknown) => void,
): void {
  const valueRef = useRef(onValue);
  const errorRef = useRef(onError);
  valueRef.current = onValue;
  errorRef.current = onError;

  const key = query && args ? JSON.stringify(args) : '';
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => {
    const ref = queryRef.current;
    if (!ref || !key) {
      return;
    }
    const watch = convexClient().watchQuery(ref, JSON.parse(key) as never);
    const emit = () => {
      try {
        const value = watch.localQueryResult();
        if (value !== undefined) {
          valueRef.current(value as T);
        }
      } catch (error) {
        errorRef.current?.(error);
      }
    };
    emit();
    const dispose = watch.onUpdate(emit);
    return () => {
      dispose();
    };
  }, [key]);
}

/**
 * Fire `fn` immediately and then on an interval. Used where the harness is
 * deliberately polling the server rather than holding a live subscription -
 * `calls:incoming` is the important one, because ringing must be detected even
 * if the live subscription has dropped.
 */
export function usePoller(
  fn: () => Promise<void> | void,
  ms: number | null,
  key: string,
  onError?: (error: unknown) => void,
): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const errorRef = useRef(onError);
  errorRef.current = onError;

  useEffect(() => {
    if (ms === null) {
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        await fnRef.current();
      } catch (error) {
        if (!cancelled) {
          errorRef.current?.(error);
        }
      }
    };
    void tick();
    const timer = setInterval(tick, ms);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [ms, key]);
}

/** Runs `fn` every time `tick` changes, skipping the first render. */
export function useWatchEffect(fn: () => void, tick: string): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    fnRef.current();
  }, [tick]);
}
