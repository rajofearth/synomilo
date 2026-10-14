/**
 * Canonical avatar resolution, shared by mobile and the upcoming web app.
 *
 * The bug this replaces: 28 of the 33 avatar render sites in the app fell back
 * to initials, because avatar data was arriving from more than one shape and
 * there was no single function to ask.
 *
 * Rules:
 *   1. Prefer an explicitly passed override (the caller already has the URL).
 *   2. Otherwise prefer the Convex `avatarUrl` - it is the source of truth and
 *      is the one the profile editor writes.
 *   3. Fall back to a bare `avatar` field when a caller happens to carry one.
 *   4. Anything missing, blank, whitespace-only, non-http(s) or `data:` is
 *      rejected so a malformed value cannot render as a broken image.
 *   5. No URL -> initials. Callers must also attach an `onError` so a URL that
 *      404s degrades to initials instead of an empty box (none of the 33 sites
 *      did this before).
 */

export type AvatarEntity =
  | {
      /** Convex users row (or the projection from `publicUser`). */
      avatarUrl?: string | null;
      /** Secondary avatar field, for callers holding a differently-shaped entity. */
      avatar?: string | null;
    }
  | null
  | undefined;

export type ResolvedAvatar =
  | { kind: 'url'; uri: string }
  | { kind: 'initials'; initials: string };

/** Usable remote avatar URLs only. Rejects empty, relative and data: URIs. */
export function isUsableAvatarUrl(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (trimmed.startsWith('data:')) {
    // Inline data URIs were used for base64 avatars in the old sample data.
    // They bloat the bundle and break in <Image>; treat them as absent.
    return false;
  }
  return /^https?:\/\/\S+$/i.test(trimmed);
}

/** Up to two initials from a display name or username. */
export function initialsFor(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (trimmed.length === 0) {
    return '?';
  }
  const words = trimmed.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) {
    return trimmed.slice(0, 2).toUpperCase();
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

/**
 * Resolve what an avatar should render.
 *
 * @param entity   The user projection (or any object carrying an avatar field).
 * @param name     Fallback label for initials.
 * @param override A URL the caller already resolved and wants to force.
 */
export function resolveAvatar(
  entity: AvatarEntity,
  name?: string | null,
  override?: string | null,
): ResolvedAvatar {
  const label =
    name ??
    (entity && 'displayName' in entity
      ? ((entity as { displayName?: string }).displayName ?? null)
      : null) ??
    (entity && 'name' in entity
      ? ((entity as { name?: string }).name ?? null)
      : null);

  if (isUsableAvatarUrl(override)) {
    return { kind: 'url', uri: override.trim() };
  }

  if (entity) {
    const convex = (entity as { avatarUrl?: string | null }).avatarUrl;
    if (isUsableAvatarUrl(convex)) {
      return { kind: 'url', uri: convex.trim() };
    }
    const secondary = (entity as { avatar?: string | null }).avatar;
    if (isUsableAvatarUrl(secondary)) {
      return { kind: 'url', uri: secondary.trim() };
    }
  }

  return { kind: 'initials', initials: initialsFor(label) };
}

/**
 * Convenience for call screens, which pass a bare peer name and no user object
 * on some paths. Keeps those sites from re-implementing the fallback.
 */
export function resolveAvatarForName(name: string | null | undefined): ResolvedAvatar {
  return resolveAvatar(null, name);
}
