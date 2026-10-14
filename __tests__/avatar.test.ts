import {
  initialsFor,
  isUsableAvatarUrl,
  resolveAvatar,
  resolveAvatarForName,
} from '../src/utils/avatar';

describe('avatar resolution', () => {
  describe('isUsableAvatarUrl', () => {
    it('accepts http and https URLs', () => {
      expect(isUsableAvatarUrl('https://cdn.example.com/a.png')).toBe(true);
      expect(isUsableAvatarUrl('http://cdn.example.com/a.png')).toBe(true);
      expect(isUsableAvatarUrl('  https://cdn.example.com/a.png  ')).toBe(true);
    });

    it('rejects missing, blank and non-string values', () => {
      expect(isUsableAvatarUrl(undefined)).toBe(false);
      expect(isUsableAvatarUrl(null)).toBe(false);
      expect(isUsableAvatarUrl('')).toBe(false);
      expect(isUsableAvatarUrl('   ')).toBe(false);
      expect(isUsableAvatarUrl(42)).toBe(false);
      expect(isUsableAvatarUrl({})).toBe(false);
    });

    it('rejects data URIs and relative paths', () => {
      // The old sample data embedded base64 avatars; these belong in storage,
      // not in a style prop.
      expect(isUsableAvatarUrl('data:image/png;base64,AAAA')).toBe(false);
      expect(isUsableAvatarUrl('/local/path.png')).toBe(false);
      expect(isUsableAvatarUrl('file:///tmp/a.png')).toBe(false);
    });
  });

  describe('initialsFor', () => {
    it('takes the first letter of the first and last word', () => {
      expect(initialsFor('Ada Lovelace')).toBe('AL');
      expect(initialsFor('Grace Brewster Murray Hopper')).toBe('GH');
    });

    it('handles single names, separators and punctuation', () => {
      expect(initialsFor('Prince')).toBe('PR');
      expect(initialsFor('ada.lovelace')).toBe('AL');
      expect(initialsFor('ada_lovelace')).toBe('AL');
      expect(initialsFor('ada-lovelace')).toBe('AL');
    });

    it('never returns an empty string', () => {
      expect(initialsFor('')).toBe('?');
      expect(initialsFor('   ')).toBe('?');
      expect(initialsFor(null)).toBe('?');
      expect(initialsFor(undefined)).toBe('?');
    });
  });

  describe('resolveAvatar', () => {
    it('returns a URL when the Convex record has one', () => {
      const resolved = resolveAvatar({ avatarUrl: 'https://cdn/x.png' }, 'Ada');
      expect(resolved).toEqual({ kind: 'url', uri: 'https://cdn/x.png' });
    });

    it('prefers Convex over the CometChat avatar', () => {
      // Convex is the source of truth: it is what the profile editor writes.
      const resolved = resolveAvatar(
        {
          avatarUrl: 'https://cdn/convex.png',
          avatar: 'https://cdn/cometchat.png',
        },
        'Ada',
      );
      expect(resolved).toEqual({ kind: 'url', uri: 'https://cdn/convex.png' });
    });

    it('falls back to the CometChat avatar when Convex has none', () => {
      const resolved = resolveAvatar({ avatar: 'https://cdn/cometchat.png' }, 'Ada');
      expect(resolved).toEqual({ kind: 'url', uri: 'https://cdn/cometchat.png' });
    });

    it('falls back to initials when both are empty', () => {
      // This is the exact state CometChat-only sessions are stuck in, because
      // cometchatSession.ts creates the user with no avatar.
      const resolved = resolveAvatar({ avatarUrl: null, avatar: null }, 'Ada Lovelace');
      expect(resolved).toEqual({ kind: 'initials', initials: 'AL' });
    });

    it('falls back to initials for a null entity', () => {
      expect(resolveAvatar(null, 'Ada Lovelace')).toEqual({
        kind: 'initials',
        initials: 'AL',
      });
      expect(resolveAvatar(undefined, 'Ada Lovelace')).toEqual({
        kind: 'initials',
        initials: 'AL',
      });
    });

    it('lets an explicit override win over everything', () => {
      const resolved = resolveAvatar(
        { avatarUrl: 'https://cdn/convex.png' },
        'Ada',
        'https://cdn/override.png',
      );
      expect(resolved).toEqual({ kind: 'url', uri: 'https://cdn/override.png' });
    });

    it('ignores a malformed override rather than rendering it', () => {
      const resolved = resolveAvatar(
        { avatarUrl: 'https://cdn/convex.png' },
        'Ada',
        'data:image/png;base64,AAAA',
      );
      expect(resolved).toEqual({ kind: 'url', uri: 'https://cdn/convex.png' });
    });

    it('reads displayName off the entity when no name is passed', () => {
      const resolved = resolveAvatar({
        avatarUrl: null,
        displayName: 'Ada Lovelace',
      } as never);
      expect(resolved).toEqual({ kind: 'initials', initials: 'AL' });
    });

    it('reads a CometChat-style name off the entity', () => {
      const resolved = resolveAvatar({ name: 'Ada Lovelace' } as never);
      expect(resolved).toEqual({ kind: 'initials', initials: 'AL' });
    });
  });

  describe('resolveAvatarForName', () => {
    it('resolves call-screen peers that only have a name', () => {
      expect(resolveAvatarForName('Ada Lovelace')).toEqual({
        kind: 'initials',
        initials: 'AL',
      });
      expect(resolveAvatarForName(null)).toEqual({ kind: 'initials', initials: '?' });
    });
  });
});
