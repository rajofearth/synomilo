'use client';

import { useState } from 'react';

type AvatarProps = {
  name: string;
  url?: string | null;
  size?: number;
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/** Real avatar URL when there is one, deterministic initials when there is not. */
export default function Avatar({ name, url, size = 44 }: AvatarProps) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size / 2.6) };

  if (!url || broken) {
    return (
      <span className="avatar" style={style} aria-label={name}>
        {initialsOf(name)}
      </span>
    );
  }
  return (
    <span className="avatar" style={style}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={name} onError={() => setBroken(true)} />
    </span>
  );
}
