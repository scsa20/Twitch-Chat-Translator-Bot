import { existsSync, readFileSync, renameSync, readdirSync } from 'fs';
import { join } from 'path';
import { CONFIG_DIR } from './config.js';
import { loadBotConfig, saveBotConfig } from './botConfigStore.js';

function migrateToken(config: any) {
  const tokenFile = join(CONFIG_DIR, 'oauth-token.json');
  if (!existsSync(tokenFile)) return;
  try {
    const encrypted = readFileSync(tokenFile, 'utf-8');
    config.oauth_token_encrypted = encrypted;
    saveBotConfig(config);
    renameSync(tokenFile, tokenFile + '.migrated');
    console.log('Migrated oauth-token.json into bot_config.json and renamed original.');
  } catch (err) {
    console.warn('Token migration failed:', err);
  }
}

function migrateIgnoreFiles(config: any) {
  const files = readdirSync(CONFIG_DIR);
  // only match raw ignore-users JSON files (not already migrated ones)
  const ignoreFiles = files.filter((f) => /^ignore-users(?:-.+)?\.json$/.test(f));
  if (!config.ignored_users) config.ignored_users = {};
  for (const fname of ignoreFiles) {
    const full = join(CONFIG_DIR, fname);
    try {
      const data = JSON.parse(readFileSync(full, 'utf-8') || '[]');
      if (fname === 'ignore-users.json') {
        config.ignored_users.global = Array.isArray(data) ? data : [];
      } else {
        const m = fname.match(/^ignore-users-(.+)\.json$/);
        const channel = m ? m[1] : fname;
        config.ignored_users[channel] = Array.isArray(data) ? data : [];
      }
      saveBotConfig(config);
      renameSync(full, full + '.migrated');
      console.log(`Migrated ${fname} into bot_config.json and renamed original.`);
    } catch (err) {
      console.warn('Skipping ignore file', fname, 'due to error', String(err));
    }
  }
}

function migrateChannelsFile(config: any) {
  const channelsFile = join(CONFIG_DIR, 'channels.json');
  if (!existsSync(channelsFile)) return;
  try {
    const data = JSON.parse(readFileSync(channelsFile, 'utf-8') || '{}');
    if (!config.channels) config.channels = {};
    for (const k of Object.keys(data)) {
      config.channels[k] = data[k];
    }
    saveBotConfig(config);
    renameSync(channelsFile, channelsFile + '.migrated');
    console.log('Migrated channels.json into bot_config.json and renamed original.');
  } catch (err) {
    console.warn('Skipping channels.json migration due to error:', err);
  }
}

function sanitizeBotConfig(config: any) {
  if (!config || !config.ignored_users) return;
  const keys = Object.keys(config.ignored_users);
  for (const k of keys) {
    if (k === 'global') continue;
    if (k.startsWith('ignore-users-') || k.includes('.migrated') || k.includes('.json')) {
      const m = k.match(/^ignore-users-(.+?)(?:\.json)?(?:\.migrated)*$/);
      const channel = m ? m[1] : null;
      if (channel) {
        const arr = config.ignored_users[k];
        if (!config.ignored_users[channel]) config.ignored_users[channel] = [];
        const set = new Set([...(config.ignored_users[channel] || []), ...(Array.isArray(arr) ? arr : [])]);
        config.ignored_users[channel] = Array.from(set);
        delete config.ignored_users[k];
      }
    }
  }
  saveBotConfig(config);
}

export async function migrateConfigIfNeeded(): Promise<void> {
  try {
    const config = loadBotConfig();
    const tokenFile = join(CONFIG_DIR, 'oauth-token.json');
    if (existsSync(tokenFile)) {
      migrateToken(config);
    }
    migrateIgnoreFiles(config);
    migrateChannelsFile(config);
    sanitizeBotConfig(loadBotConfig());
  } catch (err) {
    console.warn('Migration error:', err);
  }
}
