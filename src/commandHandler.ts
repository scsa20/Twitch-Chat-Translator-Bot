import type tmi from 'tmi.js';
import { normalizeUsername } from './utils.js';
import { loadIgnoreListFromFile, parseEnvIgnoreUsers, saveIgnoreList } from './ignoreList.js';
import type { ChannelConfig } from './channelConfig.js';
import { setPrimary, setSecondary, setTranslateEnabled } from './channelConfig.js';

export type IgnoreSet = Set<string>;

const GET_LANGS_ALIASES = new Set(['!getlangs', '!getlang', '!langs', '!languages']);
const SET_PRIMARY_ALIASES = new Set(['!setprimlang', '!setprim', '!setprimary']);
const SET_SECONDARY_ALIASES = new Set(['!setseclang', '!setsec', '!setsecondary']);
const TRANSLATE_ALIASES = new Set(['!translate', '!translations']);

export function initializeIgnoreSets(channels: string[]): Map<string, IgnoreSet> {
  const perChannelIgnoreSets = new Map<string, IgnoreSet>();
  for (const channel of channels) {
    const initialIgnore = new Set<string>(loadIgnoreListFromFile(channel));
    for (const u of parseEnvIgnoreUsers()) initialIgnore.add(u);
    perChannelIgnoreSets.set(channel, initialIgnore);
  }
  return perChannelIgnoreSets;
}

export function handleIgnoreCommand(
  client: tmi.Client,
  target: string,
  channelName: string,
  message: string,
  ignoreSet: IgnoreSet
): boolean {
  const parts = message.trim().split(/\s+/);
  const sub = (parts[1] || '').toLowerCase();

  if (sub === 'add' || sub === '+') {
    const raw = parts[2];
    if (!raw) {
      client.say(target, '/me Usage: !ignore add <username>');
      return true;
    }
    const normalized = normalizeUsername(raw);
    if (!normalized) {
      client.say(target, '/me Invalid username.');
      return true;
    }
    if (ignoreSet.has(normalized)) {
      client.say(target, `/me ${normalized} is already in ignore list.`);
      return true;
    }
    ignoreSet.add(normalized);
    saveIgnoreList(ignoreSet, channelName);
    client.say(target, `/me Added ${normalized} to ignore list.`);
    return true;
  }

  if (sub === 'remove' || sub === '-') {
    const raw = parts[2];
    if (!raw) {
      client.say(target, '/me Usage: !ignore remove <username>');
      return true;
    }
    const normalized = normalizeUsername(raw);
    if (!normalized) {
      client.say(target, '/me Invalid username.');
      return true;
    }
    if (!ignoreSet.has(normalized)) {
      client.say(target, `/me ${normalized} is not in ignore list.`);
      return true;
    }
    ignoreSet.delete(normalized);
    saveIgnoreList(ignoreSet, channelName);
    client.say(target, `/me Removed ${normalized} from ignore list.`);
    return true;
  }

  if (sub === 'list') {
    const list = Array.from(ignoreSet.values()).sort();
    const preview = list.slice(0, 20).join(', ') || '(empty)';
    const suffix = list.length > 20 ? ` ... and ${list.length - 20} more` : '';
    client.say(target, `/me Ignore list: ${preview}${suffix}`);
    return true;
  }

  client.say(target, '/me Commands: !ignore add <username> | !ignore remove <username> | !ignore list');
  return true;
}

export function isIgnoreMessage(message: string): boolean {
  return message.toLowerCase().startsWith('!ignore');
}

export function isGetLangsCommand(message: string): boolean {
  const cmd = (message.trim().split(/\s+/)[0] || '').toLowerCase();
  return GET_LANGS_ALIASES.has(cmd);
}

export function isLanguageCommand(message: string): boolean {
  const cmd = (message.trim().split(/\s+/)[0] || '').toLowerCase();
  return SET_PRIMARY_ALIASES.has(cmd)
    || SET_SECONDARY_ALIASES.has(cmd)
    || GET_LANGS_ALIASES.has(cmd)
    || TRANSLATE_ALIASES.has(cmd);
}

export function handleLanguageCommand(
  client: tmi.Client,
  target: string,
  channelName: string,
  message: string,
  perChannelLanguages: Map<string, ChannelConfig>,
  langConfig: ChannelConfig | undefined
): boolean {
  const parts = message.trim().split(/\s+/);
  const cmd = (parts[0] || '').toLowerCase();
  const arg = parts[1];

  if (SET_PRIMARY_ALIASES.has(cmd)) {
    if (!arg) {
      client.say(target, '/me Usage: !setprimlang <lang>');
      return true;
    }
    setPrimary(channelName, arg);
    const cfg = perChannelLanguages.get(channelName) || { primary: arg };
    cfg.primary = arg;
    perChannelLanguages.set(channelName, cfg);
    client.say(target, `/me Primary language set to ${arg}`);
    return true;
  }

  if (SET_SECONDARY_ALIASES.has(cmd)) {
    if (!arg) {
      client.say(target, '/me Usage: !setseclang <lang|off>');
      return true;
    }
    if (arg.toLowerCase() === 'off') {
      setSecondary(channelName, null);
      const cfg = perChannelLanguages.get(channelName) || { primary: process.env.PRIMARY_LANG || 'en' };
      delete cfg.secondary;
      perChannelLanguages.set(channelName, cfg);
      client.say(target, '/me Secondary language disabled');
      return true;
    }
    setSecondary(channelName, arg);
    const cfg = perChannelLanguages.get(channelName) || { primary: process.env.PRIMARY_LANG || 'en' };
    cfg.secondary = arg;
    perChannelLanguages.set(channelName, cfg);
    client.say(target, `/me Secondary language set to ${arg}`);
    return true;
  }

  if (GET_LANGS_ALIASES.has(cmd)) {
    return handleGetLangsCommand(client, target, channelName, perChannelLanguages.get(channelName) || langConfig);
  }

  if (TRANSLATE_ALIASES.has(cmd)) {
    if (!arg) {
      client.say(target, '/me Usage: !translate <on|off>');
      return true;
    }
    const enabled = arg.toLowerCase() !== 'off' && arg.toLowerCase() !== 'false';
    setTranslateEnabled(channelName, enabled);
    const cfg = perChannelLanguages.get(channelName) || { primary: process.env.PRIMARY_LANG || 'en' };
    cfg.translateEnabled = enabled;
    perChannelLanguages.set(channelName, cfg);
    client.say(target, `/me Translations ${enabled ? 'enabled' : 'disabled'}`);
    return true;
  }

  return false;
}

export function handleGetLangsCommand(
  client: tmi.Client,
  target: string,
  channelName: string,
  langConfig: ChannelConfig | undefined
): boolean {
  const primary = langConfig?.primary || process.env.PRIMARY_LANG || 'en';
  const secondary = langConfig?.secondary || 'off';
  const translateEnabled = langConfig?.translateEnabled !== false ? 'on' : 'off';
  client.say(target, `/me Languages for ${channelName}: primary=${primary}, secondary=${secondary}, translate=${translateEnabled}`);
  return true;
}

export function normalizeCommandTyping(message: string): string {
  const lowerMsg = message.toLowerCase();
  if (lowerMsg.startsWith('!ignore')) {
    if (lowerMsg === '!ignoreadd' || lowerMsg.startsWith('!ignoreadd ')) {
      return '!ignore add' + message.slice('!ignoreadd'.length);
    }
    if (lowerMsg === '!ignoreremove' || lowerMsg.startsWith('!ignoreremove ')) {
      return '!ignore remove' + message.slice('!ignoreremove'.length);
    }
    if (lowerMsg === '!ignorelist') {
      return '!ignore list';
    }
  }
  return message;
}
