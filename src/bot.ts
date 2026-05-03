import tmi from 'tmi.js';
import dotenv from 'dotenv';
import axios from 'axios';
import http from 'http';
import https from 'https';
import fs from 'fs';
import { ensureConfigDir } from './config';
import { normalizeUsername } from './utils';
import { loadIgnoreListFromFile, parseEnvIgnoreUsers, saveIgnoreList } from './ignoreList';
import { detectLanguage, translateMessage } from './translator';
import {
  loadStoredToken,
  saveToken,
  isTokenExpired,
  refreshToken as refreshStoredToken,
  getAccessToken
} from './tokenManager';

dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value;
}

async function getOAuthTokenViaFlow(): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const clientId = requireEnv('TWITCH_CLIENT_ID');
  const clientSecret = requireEnv('TWITCH_CLIENT_SECRET');
  const certPath = process.env.TWITCH_OAUTH_CERT_PATH;
  const keyPath = process.env.TWITCH_OAUTH_KEY_PATH;
  const useHttps = certPath && keyPath && fs.existsSync(certPath) && fs.existsSync(keyPath);
  const protocol = useHttps ? 'https' : 'http';
  const redirectUri = process.env.TWITCH_OAUTH_REDIRECT_URI || `${protocol}://localhost:3000/auth/callback`;
  const scopes = ['chat:read', 'chat:edit', 'whispers:read', 'whispers:edit'];
  const state = `${Math.random().toString(36).slice(2)}_${Date.now()}`;

  const authorizeUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&response_type=code&scope=${encodeURIComponent(scopes.join(' '))}&state=${encodeURIComponent(state)}`;

  console.log('Open this URL in your browser to authorize your bot:');
  console.log(authorizeUrl);

  return new Promise((resolve, reject) => {
    const requestHandler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
      if (!req.url) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      // Parse the URL from the request
      // Use X-Forwarded-* headers if behind a proxy (e.g., Cloudflare)
      const forwardedProto = (req.headers['x-forwarded-proto'] as string) || protocol;
      const forwardedHost = (req.headers['x-forwarded-host'] as string) || req.headers.host;
      const url = new URL(req.url, `${forwardedProto}://${forwardedHost}`);

      if (url.pathname !== '/auth/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      if (!code || returnedState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid state or missing code.');
        return;
      }

      try {
        const tokenResponse = await axios.post(
          'https://id.twitch.tv/oauth2/token',
          null,
          {
            params: {
              client_id: clientId,
              client_secret: clientSecret,
              code,
              grant_type: 'authorization_code',
              redirect_uri: redirectUri
            }
          }
        );

        const accessToken = tokenResponse.data?.access_token;
        const refreshToken = tokenResponse.data?.refresh_token;
        const expiresIn = tokenResponse.data?.expires_in || 3600;

        if (!accessToken || !refreshToken) {
          throw new Error('No access or refresh token in response');
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Authorization complete</h1><p>You may close this window and return to your terminal.</p>');
        server.close();
        resolve({ accessToken, refreshToken, expiresIn });
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Failed to exchange code for token.');
        server.close();
        reject(err);
      }
    };

    const server = useHttps
      ? https.createServer(
          {
            cert: fs.readFileSync(certPath!),
            key: fs.readFileSync(keyPath!)
          },
          requestHandler
        )
      : http.createServer(requestHandler);

    server.listen(3000, '0.0.0.0', () => {
      console.log(`Waiting for Twitch auth callback at ${redirectUri} ...`);
    });

    setTimeout(() => {
      reject(new Error('OAuth authorization timed out after 2 minutes.'));
      server.close();
    }, 120000);
  });
}

ensureConfigDir();

const botUsername = requireEnv('BOT_USERNAME');
const channelInput = process.env.CHANNEL_NAME || botUsername;
// Parse channels: comma or space separated
const channels = channelInput
  .split(/[,\s]+/)
  .map((c) => c.trim().toLowerCase())
  .filter((c) => c.length > 0);

// Initialize per-channel ignore lists
const perChannelIgnoreSets = new Map<string, Set<string>>();
for (const channel of channels) {
  const initialIgnore = new Set<string>(loadIgnoreListFromFile(channel));
  for (const u of parseEnvIgnoreUsers()) initialIgnore.add(u);
  perChannelIgnoreSets.set(channel, initialIgnore);
}

// Initialize per-channel languages
const perChannelLanguages = new Map<string, {primary: string, secondary?: string}>();
const globalPrimary = requireEnv('PRIMARY_LANG');
const globalSecondary = process.env.SECONDARY_LANG;
for (const channel of channels) {
  const primary = process.env[`PRIMARY_LANG_${channel.toUpperCase()}`] || globalPrimary;
  const secondary = process.env[`SECONDARY_LANG_${channel.toUpperCase()}`] || globalSecondary;
  perChannelLanguages.set(channel, {primary, secondary});
}

let client: tmi.Client;
let tokenRefreshInterval: NodeJS.Timeout | null = null;
const useOAuthFlow = ['1', 'true', 'yes'].includes((process.env.TWITCH_OAUTH_FLOW || '').toLowerCase());
const envOAuth = process.env.TWITCH_OAUTH;

async function getOrRefreshToken(): Promise<string> {
  if (useOAuthFlow) {
    const clientId = requireEnv('TWITCH_CLIENT_ID');
    const clientSecret = requireEnv('TWITCH_CLIENT_SECRET');

    // Try to load stored token
    const storedToken = loadStoredToken();
    if (storedToken) {
      if (!isTokenExpired(storedToken)) {
        console.log('Using stored OAuth token.');
        return getAccessToken(storedToken);
      }

      // Token expired, refresh it
      try {
        console.log('Stored token expired, refreshing...');
        const refreshed = await refreshStoredToken(clientId, clientSecret, storedToken.refreshToken);
        return getAccessToken(refreshed);
      } catch (err) {
        console.warn('Failed to refresh token, requesting new authorization...');
      }
    }

    // No stored token or refresh failed, go through OAuth flow
    const tokenData = await getOAuthTokenViaFlow();
    saveToken(tokenData.accessToken, tokenData.refreshToken, tokenData.expiresIn);
    return getAccessToken({ accessToken: tokenData.accessToken, refreshToken: tokenData.refreshToken, expiresAt: 0 });
  }

  // Using env var OAuth token
  if (!envOAuth) {
    throw new Error('Twitch auth is required. Set TWITCH_OAUTH or enable TWITCH_OAUTH_FLOW=true');
  }
  return envOAuth.startsWith('oauth:') ? envOAuth : `oauth:${envOAuth}`;
}

function setupAutoTokenRefresh(): void {
  if (!useOAuthFlow) return;

  // Check token every 30 minutes (1800000ms)
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

  const opts = {
    identity: {
      username: botUsername,
      password: formattedToken
    },
    channels: channels
  };

  client = new tmi.Client(opts);

  client.on('connected', onConnectedHandler);
  client.on('message', onMessageHandler);

  await client.connect();
  console.log(
    `Bot connected as '${botUsername}' to ${channels.length} channel(s): ${channels.join(', ')}`
  );

  // Setup auto-refresh after successful connection
  setupAutoTokenRefresh();

  return client;
}

function onConnectedHandler(addr: string, port: number) {
  console.log(`* Connected to ${addr}:${port}`);
}

async function onMessageHandler(
  target: string,
  context: any,
  msg: string,
  self: boolean
) {
  if (self) return;

  // Extract channel name from target (remove # prefix)
  const channelName = target.toLowerCase().startsWith('#') ? target.slice(1) : target.toLowerCase();
  const ignoreSet = perChannelIgnoreSets.get(channelName) || new Set<string>();
  const langConfig = perChannelLanguages.get(channelName)!;

  let message = msg.trim();

  const isBroadcaster = Boolean(context?.badges?.broadcaster);
  const isMod = Boolean(context?.badges?.moderator);
  const usernameLower = String(context?.username ?? '').toLowerCase();
  const isPrivileged = isBroadcaster || isMod;

  // Correct common command typos for !ignore
  const lowerMsg = message.toLowerCase();
  if (lowerMsg.startsWith('!ignore')) {
    if (lowerMsg === '!ignoreadd' || lowerMsg.startsWith('!ignoreadd ')) {
      message = '!ignore add' + message.slice('!ignoreadd'.length);
      client.say(target, '/me Corrected "!ignoreadd" to "!ignore add".');
    } else if (lowerMsg === '!ignoreremove' || lowerMsg.startsWith('!ignoreremove ')) {
      message = '!ignore remove' + message.slice('!ignoreremove'.length);
      client.say(target, '/me Corrected "!ignoreremove" to "!ignore remove".');
    } else if (lowerMsg === '!ignorelist') {
      message = '!ignore list';
      client.say(target, '/me Corrected "!ignorelist" to "!ignore list".');
    }
  }

  if (message.toLowerCase().startsWith('!ignore')) {
    if (!isPrivileged) return;

    const parts = message.trim().split(/\s+/);
    const sub = (parts[1] || '').toLowerCase();

    if (sub === 'add' || sub === '+') {
      const raw = parts[2];
      if (!raw) {
        client.say(target, '/me Usage: !ignore add <username>');
        return;
      }
      const normalized = normalizeUsername(raw);
      if (!normalized) {
        client.say(target, '/me Invalid username.');
        return;
      }
      if (ignoreSet.has(normalized)) {
        client.say(target, `/me ${normalized} is already in ignore list.`);
        return;
      }
      ignoreSet.add(normalized);
      saveIgnoreList(ignoreSet, channelName);
      client.say(target, `/me Added ${normalized} to ignore list.`);
      return;
    } else if (sub === 'remove' || sub === '-') {
      const raw = parts[2];
      if (!raw) {
        client.say(target, '/me Usage: !ignore remove <username>');
        return;
      }
      const normalized = normalizeUsername(raw);
      if (!normalized) {
        client.say(target, '/me Invalid username.');
        return;
      }
      if (!ignoreSet.has(normalized)) {
        client.say(target, `/me ${normalized} is not in ignore list.`);
        return;
      }
      ignoreSet.delete(normalized);
      saveIgnoreList(ignoreSet, channelName);
      client.say(target, `/me Removed ${normalized} from ignore list.`);
      return;
    } else if (sub === 'list') {
      const list = Array.from(ignoreSet.values()).sort();
      const preview = list.slice(0, 20).join(', ') || '(empty)';
      const suffix = list.length > 20 ? ` ... and ${list.length - 20} more` : '';
      client.say(target, `/me Ignore list: ${preview}${suffix}`);
      return;
    }

    client.say(target, '/me Commands: !ignore add <username> | !ignore remove <username> | !ignore list');
    return;
  }

  if (context?.emotes) {
    const emotes = Object.values<string>(context.emotes)
      .map(([positions]) => {
        const [start, end] = positions.split('-').map(Number);
        return message.substring(start, end + 1);
      })
      .filter(Boolean);

    emotes.forEach((x) => {
      message = message.replace(new RegExp(x, 'g'), '');
    });
  }

  if (ignoreSet.has(usernameLower)) return;

  if (isBroadcaster || message.length <= 7) return;

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

createClientAndConnect().catch((err) => {
  console.error('Failed to start bot:', err.message || err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  if (tokenRefreshInterval) {
    clearInterval(tokenRefreshInterval);
  }
  process.exit(0);
});

