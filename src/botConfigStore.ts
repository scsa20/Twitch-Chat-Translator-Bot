import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { CONFIG_DIR } from './config.js';

const BOT_CONFIG_PATH = join(CONFIG_DIR, 'bot_config.json');

export function loadBotConfig(): any {
  try {
    if (!existsSync(BOT_CONFIG_PATH)) return {};
    const raw = readFileSync(BOT_CONFIG_PATH, 'utf-8') || '{}';
    return JSON.parse(raw);
  } catch (err) {
    console.warn('Failed to load bot config:', err);
    return {};
  }
}

export function saveBotConfig(obj: any): void {
  try {
    writeFileSync(BOT_CONFIG_PATH, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Failed to save bot config:', err);
  }
}

export const BOT_CONFIG_PATH_EXPORT = BOT_CONFIG_PATH;
