import {createNavigationContainerRef} from '@react-navigation/native';
import {RootStackParamList} from './types';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

interface PendingNavigation {
  name: keyof RootStackParamList;
  params?: any;
}

/**
 * A QUEUE, not a slot.
 *
 * This was a single `PendingNavigation | null`, so a second navigate() before the container
 * was ready overwrote the first. Deep-linking a thread notification issues two in a row
 * (Messages, then ThreadView) and the conversation underneath was being erased, leaving
 * ThreadView with nothing to go back to (or, when both were queued and only one survived,
 * nothing at all).
 */
let pendingNavigations: PendingNavigation[] = [];

/**
 * A reset is ABSOLUTE: it replaces the entire stack, so it is a slot, not a queue.
 *
 * Sign-out can fire before the container is ready, because SessionProvider sits ABOVE
 * NavigationContainer in the tree. Without this the reset was simply dropped, which is
 * exactly how logout became a one-way door: `navigate()` had a queue to fall back on, the
 * reset had nowhere to go, and the user stayed in authenticated UI with no session.
 */
let pendingReset: {name: keyof RootStackParamList; params?: any} | null = null;

export function navigate<RouteName extends keyof RootStackParamList>(
  name: RouteName,
  params?: RootStackParamList[RouteName] extends undefined
    ? undefined
    : RootStackParamList[RouteName],
) {
  if (navigationRef.isReady()) {
    // The container ref's `navigate` is typed `(name: never, params: never)`; the
    // generic signature above is the real contract and is checked at every call site.
    navigationRef.navigate(name as never as any, params as never as any);
  } else {
    // Save the navigation intent for later processing, PRESERVING order.
    pendingNavigations.push({name, params});
  }
}

/**
 * Reset the root stack to a single route.
 *
 * This is the ONLY correct way to leave an authenticated screen: `navigate()` would leave
 * every intermediate screen on the back stack, so the hardware back button would walk the
 * user straight back into a UI that no longer has a session.
 *
 * Returns whether the reset was applied immediately. Never rejects, because a navigation
 * failure during sign-out must not surface as a failed logout.
 */
export function resetTo<RouteName extends keyof RootStackParamList>(
  name: RouteName,
  params?: RootStackParamList[RouteName] extends undefined
    ? undefined
    : RootStackParamList[RouteName],
): Promise<boolean> {
  const target = {name, params};
  if (!navigationRef.isReady()) {
    pendingReset = target;
    return Promise.resolve(false);
  }
  pendingReset = null;
  // Anything queued was resolved against the stack we are about to discard. Replaying it
  // on top of the new stack is what used to put a duplicate screen behind the back button.
  pendingNavigations = [];
  return Promise.resolve(
    navigationRef.reset({index: 0, routes: [target]} as never),
  )
    .then(() => true)
    .catch(() => false);
}

/**
 * Sign out of the authenticated UI. This is the single logout destination: every logout
 * entry point (Profile, Settings, the legacy Conversations tooltip, a server-side
 * revocation, an expired session) funnels through here.
 */
export function resetToLogin(): Promise<boolean> {
  return resetTo('Login');
}

export function processPendingNavigation() {
  if (!navigationRef.isReady()) {
    return;
  }
  // A pending reset wins over queued navigates: it is absolute, and the queued navigates
  // were computed against the stack it replaces.
  if (pendingReset) {
    const reset = pendingReset;
    pendingReset = null;
    pendingNavigations = [];
    Promise.resolve(
      navigationRef.reset({index: 0, routes: [reset]} as never),
    ).catch(() => {});
    return;
  }
  if (pendingNavigations.length === 0) {
    return;
  }
  // Drain in the order they were requested, so the back stack ends up the way the caller
  // intended: conversation first, then the thread on top of it.
  const queued = pendingNavigations;
  pendingNavigations = [];
  for (const {name, params} of queued) {
    navigationRef.navigate(name as never as any, params as never as any);
  }
}