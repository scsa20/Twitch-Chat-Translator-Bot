export function normalizeUsername(u: string): string | null {
  if (!u) return null;
  const v = u.replace(/^@+/, '').trim().toLowerCase();
  if (!/^[a-z0-9_]{1,30}$/.test(v)) return null;
  return v;
}

export function isPrivilegedUser(context: any): boolean {
  const badges = context?.badges ?? {};
  const hasBroadcasterBadge = Boolean(badges.broadcaster || badges.broadcaster === '1');
  const hasModBadge = Boolean(badges.moderator || badges.mod || badges.moderator === '1' || badges.mod === '1');
  const isModFlag = Boolean(context?.mod);
  const isUserTypeMod = context?.['user-type'] === 'mod';

  return hasBroadcasterBadge || hasModBadge || isModFlag || isUserTypeMod;
}
