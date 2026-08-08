import tmi from 'tmi.js';
import dotenv from 'dotenv';
import { ensureConfigDir } from './config.js';
import { migrateConfigIfNeeded } from './migrator.js';
import { initializeIgnoreSets, handleIgnoreCommand, isIgnoreMessage, normalizeCommandTyping } from './commandHandler.js';
import { initializeLanguageConfigs, removeEmotes, processMessage } from './messageProcessor.js';
import { setPrimary, setSecondary, setTranslateEnabled } from './channelConfig.js';
import { getOAuthTokenViaFlow } from './authFlow.js';
import { requireEnv } from './env.js';
import {
  loadStoredToken,
  saveToken,
  isTokenExpired,
  refreshToken as refreshStoredToken,
  getAccessToken
} from './tokenManager.js';

dotenv.config();

const BUILT_IN_IGNORED_BOT_USERS = new Set([
  'streamelements',
  'streamlabs',
  'nightbot',
  'moobot',
  'fossabot',
  'phantombot',
  'ankhbot',
  'streamerbot',
  'mixitup',
  'firebot',
  'wizebot',
  'frostytools'
]);

let perChannelIgnoreSets: Map<string, any> = new Map();
let perChannelLanguages: Map<string, any> = new Map();
let botUsername: string;
let channels: string[] = [];
let client: tmi.Client;
let tokenRefreshInterval: NodeJS.Timeout | null = null;

async function main() {
  ensureConfigDir();
  await migrateConfigIfNeeded();

  botUsername = requireEnv('BOT_USERNAME');
  const channelInput = process.env.CHANNEL_NAME || botUsername;
  channels = channelInput
    .split(/[,\s]+/)
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c.length > 0);
  perChannelIgnoreSets = initializeIgnoreSets(channels);
  perChannelLanguages = initializeLanguageConfigs(channels);

  startBot().catch((err) => {
    console.error('Failed to start bot:', err.message || err);
    process.exit(1);
  });
}

main();

async function startBot() {
const useOAuthFlow = ['1', 'true', 'yes'].includes((process.env.TWITCH_OAUTH_FLOW || '').toLowerCase());
const envOAuth = process.env.TWITCH_OAUTH;

async function getOrRefreshToken(): Promise<string> {
  if (useOAuthFlow) {
    const clientId = requireEnv('TWITCH_CLIENT_ID');
    const clientSecret = requireEnv('TWITCH_CLIENT_SECRET');

    const storedToken = loadStoredToken();
    if (storedToken) {
      if (!isTokenExpired(storedToken)) {
        console.log('Using stored OAuth token.');
        return getAccessToken(storedToken);
      }

      try {
        console.log('Stored token expired, refreshing...');
        const refreshed = await refreshStoredToken(clientId, clientSecret, storedToken.refreshToken);
        return getAccessToken(refreshed);
      } catch (err) {
        console.warn('Failed to refresh token, requesting new authorization...', err);
      }
    }

    const tokenData = await getOAuthTokenViaFlow();
    saveToken(tokenData.accessToken, tokenData.refreshToken, tokenData.expiresIn);
    return getAccessToken({
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiresAt: 0
    });
  }

  if (!envOAuth) {
    throw new Error('Twitch auth is required. Set TWITCH_OAUTH or enable TWITCH_OAUTH_FLOW=true');
  }
  return envOAuth.startsWith('oauth:') ? envOAuth : `oauth:${envOAuth}`;
}

function setupAutoTokenRefresh(): void {
  if (!useOAuthFlow) return;

  tokenRefreshInterval = setInterval(async () => {
    try {
      const storedToken = loadStoredToken();
      if (!storedToken) return;

      if (isTokenExpired(storedToken)) {
        const clientId = requireEnv('TWITCH_CLIENT_ID');
        const clientSecret = requireEnv('TWITCH_CLIENT_SECRET');
        console.log('Auto-refreshing expired token...');
        await refreshStoredToken(clientId, clientSecret, storedToken.refreshToken);
        console.log('Token auto-refreshed successfully.');
      }
    } catch (err) {
      console.error('Auto-refresh failed:', err);
    }
  }, 30 * 60 * 1000);
}

async function createClientAndConnect() {
  const formattedToken = await getOrRefreshToken();

  client = new tmi.Client({
    identity: {
      username: botUsername,
      password: formattedToken
    },
    channels
  });

  client.on('connected', onConnectedHandler);
  client.on('message', onMessageHandler);

  await client.connect();
  console.log(`Bot connected as '${botUsername}' to ${channels.length} channel(s): ${channels.join(', ')}`);

  setupAutoTokenRefresh();

  return client;
}

function onConnectedHandler(addr: string, port: number) {
  console.log(`* Connected to ${addr}:${port}`);
}

async function onMessageHandler(target: string, context: any, msg: string, self: boolean) {
  if (self) return;

  const channelName = target.toLowerCase().startsWith('#') ? target.slice(1) : target.toLowerCase();
  const ignoreSet = perChannelIgnoreSets.get(channelName) || new Set<string>();
  const langConfig = perChannelLanguages.get(channelName)!;

  let message = normalizeCommandTyping(msg.trim());
  const isBroadcaster = Boolean(context?.badges?.broadcaster);
  const usernameLower = String(context?.username ?? '').toLowerCase();
  const isPrivileged = Boolean(context?.badges?.broadcaster || context?.mod || context?.['user-type'] === 'mod');

  if (isIgnoreMessage(message)) {
    if (!isPrivileged) return;
    handleIgnoreCommand(client, target, channelName, message, ignoreSet);
    return;
  }

  // Language / translate commands handled by broadcaster & mods
  const parts = message.split(/\s+/);
  const cmd = (parts[0] || '').toLowerCase();
  const arg = parts[1];

  const setPrimAliases = new Set(['!setprimlang', '!setprim', '!setprimary']);
  const setSecAliases = new Set(['!setseclang', '!setsec', '!setsecondary']);
  const translateAliases = new Set(['!translate', '!translations']);

  if (setPrimAliases.has(cmd) || setSecAliases.has(cmd) || translateAliases.has(cmd)) {
    if (!isPrivileged) return;

    if (setPrimAliases.has(cmd)) {
      if (!arg) {
        client.say(target, '/me Usage: !setprimlang <lang>');
        return;
      }
      setPrimary(channelName, arg);
      const cfg = perChannelLanguages.get(channelName) || { primary: arg };
      cfg.primary = arg;
      perChannelLanguages.set(channelName, cfg);
      client.say(target, `/me Primary language set to ${arg}`);
      return;
    }

    if (setSecAliases.has(cmd)) {
      if (!arg) {
        client.say(target, '/me Usage: !setseclang <lang|off>');
        return;
      }
      if (arg.toLowerCase() === 'off') {
        setSecondary(channelName, null);
        const cfg = perChannelLanguages.get(channelName) || { primary: process.env.PRIMARY_LANG || 'en' };
        delete cfg.secondary;
        perChannelLanguages.set(channelName, cfg);
        client.say(target, '/me Secondary language disabled');
        return;
      }
      setSecondary(channelName, arg);
      const cfg2 = perChannelLanguages.get(channelName) || { primary: process.env.PRIMARY_LANG || 'en' };
      cfg2.secondary = arg;
      perChannelLanguages.set(channelName, cfg2);
      client.say(target, `/me Secondary language set to ${arg}`);
      return;
    }

    if (translateAliases.has(cmd)) {
      if (!arg) {
        client.say(target, '/me Usage: !translate <on|off>');
        return;
      }
      const enabled = arg.toLowerCase() !== 'off' && arg.toLowerCase() !== 'false';
      setTranslateEnabled(channelName, enabled);
      const cfg3 = perChannelLanguages.get(channelName) || { primary: process.env.PRIMARY_LANG || 'en' };
      cfg3.translateEnabled = enabled;
      perChannelLanguages.set(channelName, cfg3);
      client.say(target, `/me Translations ${enabled ? 'enabled' : 'disabled'}`);
      return;
    }
  }

  message = removeEmotes(message, context).trim();

  if (ignoreSet.has(usernameLower) || BUILT_IN_IGNORED_BOT_USERS.has(usernameLower)) return;
  if (isBroadcaster || message.length <= 7) return;

  await processMessage(client, target, message, channelName, usernameLower, isBroadcaster, ignoreSet, langConfig, context);
}

  await createClientAndConnect().catch((err) => {
    console.error('Failed to start bot:', err.message || err);
    process.exit(1);
  });

}

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  if (tokenRefreshInterval) {
    clearInterval(tokenRefreshInterval);
  }
  process.exit(0);
});

