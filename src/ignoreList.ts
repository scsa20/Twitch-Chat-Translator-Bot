import { existsSync, readFileSync, writeFileSync } from 'fs';
import { IGNORE_USERS_PATH, CONFIG_DIR, ensureConfigDir } from './config.js';
import { normalizeUsername } from './utils.js';
import { join } from 'path';
import { loadBotConfig, saveBotConfig } from './botConfigStore.js';

function getPerChannelIgnorePath(channel: string): string {
  return join(CONFIG_DIR, `ignore-users-${channel.toLowerCase()}.json`);
}

export function loadIgnoreListFromFile(channel?: string): string[] {
  try {
    // Prefer centralized bot_config.json if present
    const botCfg = loadBotConfig();
    if (botCfg && botCfg.ignored_users) {
      if (channel) {
        const arr = botCfg.ignored_users[channel] || [];
          return Array.isArray(arr) ? arr.map((x: unknown) => (typeof x === 'string' ? normalizeUsername(x) : null)).filter((x): x is string => !!x) : [];
      }
      const arr = botCfg.ignored_users.global || [];
      return Array.isArray(arr) ? arr.map((x: unknown) => (typeof x === 'string' ? normalizeUsername(x) : null)).filter((x): x is string => !!x) : [];
    }

    const ignorePath = channel ? getPerChannelIgnorePath(channel) : IGNORE_USERS_PATH;
    if (!existsSync(ignorePath)) return [];
    const raw = readFileSync(ignorePath, 'utf-8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.map((x: unknown) => (typeof x === 'string' ? normalizeUsername(x) : null)).filter((x): x is string => !!x);
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
    const arr = Array.from(set.values()).sort();
    // Persist into centralized bot_config.json only
    try {
      const botCfg = loadBotConfig();
      if (!botCfg.ignored_users) botCfg.ignored_users = {};
      if (channel) {
        botCfg.ignored_users[channel] = arr;
      } else {
        botCfg.ignored_users.global = arr;
      }
      saveBotConfig(botCfg);
    } catch (e) {
      // ignore
    }
  } catch (err) {
    console.warn('Failed to save ignore list:', err);
  }
}

