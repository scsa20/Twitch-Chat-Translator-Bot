import { existsSync, readFileSync, writeFileSync } from 'fs';
import { IGNORE_USERS_PATH, CONFIG_DIR, ensureConfigDir } from './config.js';
import { normalizeUsername } from './utils.js';
import { join } from 'path';

function getPerChannelIgnorePath(channel: string): string {
  return join(CONFIG_DIR, `ignore-users-${channel.toLowerCase()}.json`);
}

export function loadIgnoreListFromFile(channel?: string): string[] {
  try {
    const ignorePath = channel ? getPerChannelIgnorePath(channel) : IGNORE_USERS_PATH;
    if (!existsSync(ignorePath)) return [];
    const raw = readFileSync(ignorePath, 'utf-8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .map((x: unknown) => (typeof x === 'string' ? normalizeUsername(x) : null))
      .filter((x): x is string => !!x);
  } catch (err) {
    console.warn('Failed to load ignore list:', err);
    return [];
  }
}

export function parseEnvIgnoreUsers(): string[] {
  const v = process.env.IGNORE_USERS;
  if (!v) return [];
  return v
    .split(',')
    .map((s) => normalizeUsername(s || ''))
    .filter((x): x is string => !!x);
}

export function saveIgnoreList(set: Set<string>, channel?: string) {
  try {
    ensureConfigDir();
    const ignorePath = channel ? getPerChannelIgnorePath(channel) : IGNORE_USERS_PATH;
    const arr = Array.from(set.values()).sort();
    writeFileSync(ignorePath, JSON.stringify(arr, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Failed to save ignore list:', err);
  }
}

