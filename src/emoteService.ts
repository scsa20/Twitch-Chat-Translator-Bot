import { DEFAULT_EMOTE_PROVIDER_CONFIG, normalizeEmoteProviderConfig, type EmoteProviderConfig } from './channelConfig.js';
import { toBearerAccessToken } from './tokenManager.js';

type ProviderName = 'twitch' | 'sevenTv' | 'bttv' | 'ffz';

interface BroadcasterIdentity {
  id: string;
  login: string;
}

interface EmoteServiceOptions {
  clientId?: string;
  accessToken?: string;
}

interface ProviderResult {
  emotes: string[];
  error?: string;
}

const EMPTY_EMOTES = new Set<string>();
const MIN_REFRESH_MINUTES = 5;

export class EmoteService {
  private readonly accessToken?: string;
  private readonly clientId?: string;
  private readonly broadcasterByChannel = new Map<string, BroadcasterIdentity>();
  private readonly emotesByChannel = new Map<string, Set<string>>();
  private readonly lastRefreshAtByChannel = new Map<string, number>();
  private readonly providerConfigByChannel = new Map<string, EmoteProviderConfig>();
  private globalTwitchEmotes: Set<string> | null = null;
  private globalTwitchLastRefreshAt = 0;
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(options: EmoteServiceOptions) {
    this.clientId = options.clientId;
    this.accessToken = options.accessToken ? toBearerAccessToken(options.accessToken) : undefined;
  }

  async start(channels: Array<{ channel: string; config?: EmoteProviderConfig | null }>): Promise<void> {
    for (const { channel, config } of channels) {
      this.providerConfigByChannel.set(channel, normalizeEmoteProviderConfig(config ?? undefined));
    }

    await Promise.all(channels.map(({ channel }) => this.refreshChannel(channel)));
    this.startRefreshTimer();
  }

  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  getChannelEmotes(channel: string): ReadonlySet<string> {
    return this.emotesByChannel.get(channel) ?? EMPTY_EMOTES;
  }

  private startRefreshTimer(): void {
    this.stop();

    const configs = Array.from(this.providerConfigByChannel.values());
    if (configs.length === 0) return;

    const refreshMinutes = Math.max(
      MIN_REFRESH_MINUTES,
      Math.min(...configs.map((config) => config.refreshIntervalMinutes ?? DEFAULT_EMOTE_PROVIDER_CONFIG.refreshIntervalMinutes))
    );

    this.refreshTimer = setInterval(() => {
      void this.refreshDueChannels();
    }, refreshMinutes * 60 * 1000);
  }

  private async refreshDueChannels(): Promise<void> {
    const now = Date.now();
    const dueChannels: string[] = [];

    for (const [channel, config] of this.providerConfigByChannel.entries()) {
      const lastRefresh = this.lastRefreshAtByChannel.get(channel) ?? 0;
      const intervalMs = Math.max(
        MIN_REFRESH_MINUTES,
        config.refreshIntervalMinutes ?? DEFAULT_EMOTE_PROVIDER_CONFIG.refreshIntervalMinutes
      ) * 60 * 1000;

      if (now - lastRefresh >= intervalMs) {
        dueChannels.push(channel);
      }
    }

    await Promise.all(dueChannels.map((channel) => this.refreshChannel(channel)));
  }

  private async refreshChannel(channel: string): Promise<void> {
    const config = this.providerConfigByChannel.get(channel) ?? DEFAULT_EMOTE_PROVIDER_CONFIG;
    const merged = new Set<string>();

    const broadcaster = await this.getBroadcasterIdentity(channel);

    const providerResults = await Promise.all([
      config.twitch ? this.fetchTwitchEmotes(channel, broadcaster, config) : Promise.resolve<ProviderResult>({ emotes: [] }),
      config.sevenTv ? this.fetchSevenTvEmotes(channel, broadcaster) : Promise.resolve<ProviderResult>({ emotes: [] }),
      config.bttv ? this.fetchBttvEmotes(channel, broadcaster) : Promise.resolve<ProviderResult>({ emotes: [] }),
      config.ffz ? this.fetchFfzEmotes(channel) : Promise.resolve<ProviderResult>({ emotes: [] })
    ]);

    for (const result of providerResults) {
      if (result.error) {
        console.warn(`Emote provider refresh warning for ${channel}: ${result.error}`);
      }
      for (const emote of result.emotes) {
        merged.add(emote);
      }
    }

    if (merged.size > 0 || !this.emotesByChannel.has(channel)) {
      this.emotesByChannel.set(channel, merged);
    }

    this.lastRefreshAtByChannel.set(channel, Date.now());
  }

  private async getBroadcasterIdentity(channel: string): Promise<BroadcasterIdentity | null> {
    const cached = this.broadcasterByChannel.get(channel);
    if (cached) return cached;

    if (!this.clientId || !this.accessToken) {
      return null;
    }

    try {
      const response = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(channel)}`, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Client-Id': this.clientId
        }
      });

      if (!response.ok) {
        const bodyText = await response.text();
        throw new Error(`Twitch user lookup failed: ${response.status} ${response.statusText} ${bodyText}`);
      }

      const data = await response.json();
      const user = Array.isArray(data?.data) ? data.data[0] : null;

      if (!user?.id || !user?.login) {
        return null;
      }

      const broadcaster = { id: String(user.id), login: String(user.login).toLowerCase() };
      this.broadcasterByChannel.set(channel, broadcaster);
      return broadcaster;
    } catch (err) {
      console.warn(`Failed to resolve broadcaster identity for ${channel}:`, err);
      return null;
    }
  }

  private async fetchTwitchEmotes(
    channel: string,
    broadcaster: BroadcasterIdentity | null,
    config: EmoteProviderConfig
  ): Promise<ProviderResult> {
    if (!this.clientId || !this.accessToken || !broadcaster) {
      return { emotes: [], error: `twitch provider unavailable for ${channel} (missing credentials or broadcaster id)` };
    }

    try {
      const [channelResponse, globalEmotes] = await Promise.all([
        fetch(`https://api.twitch.tv/helix/chat/emotes?broadcaster_id=${encodeURIComponent(broadcaster.id)}`, {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Client-Id': this.clientId
          }
        }),
        this.getGlobalTwitchEmotes(config)
      ]);

      if (!channelResponse.ok) {
        const bodyText = await channelResponse.text();
        throw new Error(`channel emotes request failed: ${channelResponse.status} ${channelResponse.statusText} ${bodyText}`);
      }

      const channelData = await channelResponse.json();
      const channelEmotes = collectNamedItems(channelData?.data, 'name');

      return { emotes: [...globalEmotes, ...channelEmotes] };
    } catch (err) {
      return { emotes: [], error: `twitch provider failed for ${channel}: ${stringifyError(err)}` };
    }
  }

  private async getGlobalTwitchEmotes(config: EmoteProviderConfig): Promise<Set<string>> {
    const refreshMinutes = Math.max(
      MIN_REFRESH_MINUTES,
      config.refreshIntervalMinutes ?? DEFAULT_EMOTE_PROVIDER_CONFIG.refreshIntervalMinutes
    );
    const refreshMs = refreshMinutes * 60 * 1000;
    if (this.globalTwitchEmotes && Date.now() - this.globalTwitchLastRefreshAt < refreshMs) {
      return this.globalTwitchEmotes;
    }

    const response = await fetch('https://api.twitch.tv/helix/chat/emotes/global', {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Client-Id': this.clientId ?? ''
      }
    });

    if (!response.ok) {
      const bodyText = await response.text();
      throw new Error(`global emotes request failed: ${response.status} ${response.statusText} ${bodyText}`);
    }

    const data = await response.json();
    this.globalTwitchEmotes = new Set(collectNamedItems(data?.data, 'name'));
    this.globalTwitchLastRefreshAt = Date.now();
    return this.globalTwitchEmotes;
  }

  private async fetchSevenTvEmotes(channel: string, broadcaster: BroadcasterIdentity | null): Promise<ProviderResult> {
    if (!broadcaster) {
      return { emotes: [], error: `7TV provider unavailable for ${channel} (missing broadcaster id)` };
    }

    try {
      const response = await fetch(`https://7tv.io/v3/users/twitch/${encodeURIComponent(broadcaster.id)}`);
      if (response.status === 404) {
        return { emotes: [] };
      }
      if (!response.ok) {
        const bodyText = await response.text();
        throw new Error(`${response.status} ${response.statusText} ${bodyText}`);
      }

      const data = await response.json();
      const emotes = collectNamedItems(data?.emote_set?.emotes, 'name');
      return { emotes };
    } catch (err) {
      return { emotes: [], error: `7TV provider failed for ${channel}: ${stringifyError(err)}` };
    }
  }

  private async fetchBttvEmotes(channel: string, broadcaster: BroadcasterIdentity | null): Promise<ProviderResult> {
    if (!broadcaster) {
      return { emotes: [], error: `BTTV provider unavailable for ${channel} (missing broadcaster id)` };
    }

    try {
      const response = await fetch(`https://api.betterttv.net/3/cached/users/twitch/${encodeURIComponent(broadcaster.id)}`);
      if (response.status === 404) {
        return { emotes: [] };
      }
      if (!response.ok) {
        const bodyText = await response.text();
        throw new Error(`${response.status} ${response.statusText} ${bodyText}`);
      }

      const data = await response.json();
      const channelEmotes = collectNamedItems(data?.channelEmotes, 'code');
      const sharedEmotes = collectNamedItems(data?.sharedEmotes, 'code');
      return { emotes: [...channelEmotes, ...sharedEmotes] };
    } catch (err) {
      return { emotes: [], error: `BTTV provider failed for ${channel}: ${stringifyError(err)}` };
    }
  }

  private async fetchFfzEmotes(channel: string): Promise<ProviderResult> {
    try {
      const response = await fetch(`https://api.frankerfacez.com/v1/room/${encodeURIComponent(channel)}`);
      if (response.status === 404) {
        return { emotes: [] };
      }
      if (!response.ok) {
        const bodyText = await response.text();
        throw new Error(`${response.status} ${response.statusText} ${bodyText}`);
      }

      const data = await response.json();
      const emotes: string[] = [];
      const sets = data?.sets;

      if (sets && typeof sets === 'object') {
        for (const setData of Object.values(sets) as Array<{ emoticons?: unknown }>) {
          emotes.push(...collectNamedItems(setData?.emoticons, 'name'));
        }
      }

      return { emotes };
    } catch (err) {
      return { emotes: [], error: `FFZ provider failed for ${channel}: ${stringifyError(err)}` };
    }
  }
}

function collectNamedItems(items: unknown, key: string): string[] {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const value = (item as Record<string, unknown>)[key];
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    })
    .filter((value): value is string => Boolean(value));
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}