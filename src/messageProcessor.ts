import type tmi from 'tmi.js';
import { isPrivilegedUser } from './utils.js';
import { detectLanguage, translateMessage } from './translator.js';
import { IgnoreSet } from './commandHandler.js';
import { initializeChannelConfigs, ChannelConfig as ChannelLanguageConfig } from './channelConfig.js';

const COMMON_CHAT_EMOTES = new Set([
  'kappa',
  'pogchamp',
  'lul',
  'kekw',
  'kreygasm',
  'biblethump',
  'kappapride',
  'pogu',
  'omegalul',
  'trihard',
  'monkas',
  'wutface',
  '4head',
  'poggers',
  'pjsalt',
  'notlikethis',
  'swiftrage',
  'dansgame',
  'pepehands',
  'feelsbadman',
  'feelsgoodman',
  'sadge',
  'pepega',
  'mindblown',
  'forsenlol',
  'widepeepoHappy',
  'widepeepoSad',
  'bbclap',
  'mjalil',
  'ayaya',
  'omegalul'
]);

const URL_REGEX = /(?:https?:\/\/|www\.)\S+|\b\S+\.(?:com|net|io|gg|tv|me|xyz|org|dev|app|co)(?:\/\S*)?/gi;
const COMMON_EMOTE_REGEX = new RegExp(`\\b(${Array.from(COMMON_CHAT_EMOTES).join('|')})\\b`, 'gi');

export function initializeLanguageConfigs(channels: string[]): Map<string, ChannelLanguageConfig> {
  const globalPrimary = requireEnv('PRIMARY_LANG');
  const globalSecondary = process.env.SECONDARY_LANG;
  return initializeChannelConfigs(channels, { primary: globalPrimary, secondary: globalSecondary });
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value;
}

export async function shouldIgnoreMessage(
  target: string,
  context: any,
  msg: string,
  ignoreSet: IgnoreSet
): Promise<{ ignore: boolean; message: string; channelName: string; usernameLower: string; isBroadcaster: boolean }> {
  const channelName = target.toLowerCase().startsWith('#') ? target.slice(1) : target.toLowerCase();
  const message = msg.trim();
  const isBroadcaster = Boolean(context?.badges?.broadcaster);
  const usernameLower = String(context?.username ?? '').toLowerCase();
  const normalizedMessage = message;

  if (ignoreSet.has(usernameLower)) {
    return { ignore: true, message: normalizedMessage, channelName, usernameLower, isBroadcaster };
  }

  return { ignore: false, message: normalizedMessage, channelName, usernameLower, isBroadcaster };
}

function stripUrls(message: string): string {
  return message.replace(URL_REGEX, '');
}

function stripCommonEmoteTokens(message: string): string {
  return message.replace(COMMON_EMOTE_REGEX, '');
}

function stripConfiguredEmoteTokens(message: string, channelEmotes?: ReadonlySet<string>): string {
  if (!channelEmotes || channelEmotes.size === 0) return message;

  return message
    .split(/\s+/)
    .filter((token) => token.length > 0 && !channelEmotes.has(token))
    .join(' ');
}

export function removeEmotes(message: string, context: any, channelEmotes?: ReadonlySet<string>): string {
  let cleaned = stripUrls(message);

  if (context?.emotes) {
    const emotes = Object.values<any>(context.emotes)
      .flatMap((positions: unknown) => {
        if (!Array.isArray(positions)) return [];
        return positions.map((pos) => String(pos));
      })
      .map((positions) => positions.split(',')[0])
      .map((positions) => positions.split('-'))
      .filter((parts) => parts.length === 2)
      .map(([start, end]) => {
        const startNum = Number(start);
        const endNum = Number(end);
        if (Number.isNaN(startNum) || Number.isNaN(endNum)) return null;
        return cleaned.substring(startNum, endNum + 1);
      })
      .filter((emote): emote is string => Boolean(emote));

    cleaned = emotes.reduce((text, emote) => text.replace(new RegExp(escapeRegExp(emote), 'g'), ''), cleaned);
  }

  cleaned = stripConfiguredEmoteTokens(cleaned, channelEmotes);
  cleaned = stripCommonEmoteTokens(cleaned);
  return cleaned.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function processMessage(
  client: tmi.Client,
  target: string,
  message: string,
  channelName: string,
  usernameLower: string,
  isBroadcaster: boolean,
  ignoreSet: IgnoreSet,
  langConfig: ChannelLanguageConfig,
  context: any
): Promise<void> {
  if (isBroadcaster || message.length <= 7) return;

  if (langConfig.translateEnabled === false) return;

  const detectedLang = await detectLanguage(message);

  if (langConfig.secondary) {
    if (detectedLang === langConfig.secondary) {
      await translateMessage(client, message, target, langConfig.primary);
    } else if (detectedLang === langConfig.primary) {
      await translateMessage(client, message, target, langConfig.secondary);
    } else {
      await translateMessage(client, message, target, langConfig.primary);
    }
  } else if (detectedLang !== langConfig.primary) {
    await translateMessage(client, message, target, langConfig.primary);
  }
}
