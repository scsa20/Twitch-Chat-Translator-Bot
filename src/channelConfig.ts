import { loadBotConfig, saveBotConfig } from './botConfigStore.js';

export interface EmoteProviderConfig {
  twitch: boolean;
  sevenTv: boolean;
  bttv: boolean;
  ffz: boolean;
  refreshIntervalMinutes: number;
}

export const DEFAULT_EMOTE_PROVIDER_CONFIG: EmoteProviderConfig = {
  twitch: true,
  sevenTv: true,
  bttv: true,
  ffz: true,
  refreshIntervalMinutes: 30
};

export interface ChannelConfig {
  primary: string;
  secondary?: string | null;
  translateEnabled?: boolean;
  emoteProviders?: EmoteProviderConfig;
}

export function normalizeEmoteProviderConfig(config?: Partial<EmoteProviderConfig> | null): EmoteProviderConfig {
  return {
    twitch: config?.twitch ?? DEFAULT_EMOTE_PROVIDER_CONFIG.twitch,
    sevenTv: config?.sevenTv ?? DEFAULT_EMOTE_PROVIDER_CONFIG.sevenTv,
    bttv: config?.bttv ?? DEFAULT_EMOTE_PROVIDER_CONFIG.bttv,
    ffz: config?.ffz ?? DEFAULT_EMOTE_PROVIDER_CONFIG.ffz,
    refreshIntervalMinutes: config?.refreshIntervalMinutes ?? DEFAULT_EMOTE_PROVIDER_CONFIG.refreshIntervalMinutes
  };
}

function loadAllFromBotConfig(): Record<string, ChannelConfig> {
  try {
    const botCfg = loadBotConfig() || {};
    return botCfg.channels || {};
  } catch (err) {
    console.warn('Failed to load channel configs from bot_config.json:', err);
    return {};
  }
}

function saveAllToBotConfig(data: Record<string, ChannelConfig>) {
  try {
    const botCfg = loadBotConfig() || {};
    botCfg.channels = data;
    saveBotConfig(botCfg);
  } catch (err) {
    console.warn('Failed to save channel configs to bot_config.json:', err);
  }
}

export function initializeChannelConfigs(channels: string[], defaults: { primary: string; secondary?: string | undefined }): Map<string, ChannelConfig> {
  const stored = loadAllFromBotConfig();
  const map = new Map<string, ChannelConfig>();

  for (const channel of channels) {
    const storedCfg = stored[channel] || {};
    const cfg: ChannelConfig = {
      primary: storedCfg.primary || defaults.primary,
      secondary: typeof storedCfg.secondary !== 'undefined' ? storedCfg.secondary : defaults.secondary,
      translateEnabled: typeof storedCfg.translateEnabled === 'boolean' ? storedCfg.translateEnabled : true,
      emoteProviders: normalizeEmoteProviderConfig(storedCfg.emoteProviders)
    };
    map.set(channel, cfg);
  }

  return map;
}

export function getChannelConfig(channel: string): ChannelConfig | null {
  const all = loadAllFromBotConfig();
  return all[channel] || null;
}

export function setPrimary(channel: string, lang: string) {
  const all = loadAllFromBotConfig();
  const cfg = all[channel] || {};
  cfg.primary = lang;
  all[channel] = cfg;
  saveAllToBotConfig(all);
}

export function setSecondary(channel: string, langOrNull: string | null) {
  const all = loadAllFromBotConfig();
  const cfg = all[channel] || {};
  if (langOrNull === null) {
    delete cfg.secondary;
  } else {
    cfg.secondary = langOrNull;
  }
  all[channel] = cfg;
  saveAllToBotConfig(all);
}

export function setTranslateEnabled(channel: string, enabled: boolean) {
  const all = loadAllFromBotConfig();
  const cfg = all[channel] || {};
  cfg.translateEnabled = enabled;
  all[channel] = cfg;
  saveAllToBotConfig(all);
}

export function setEmoteProviders(channel: string, emoteProviders: Partial<EmoteProviderConfig>) {
  const all = loadAllFromBotConfig();
  const cfg = all[channel] || {};
  cfg.emoteProviders = normalizeEmoteProviderConfig({
    ...cfg.emoteProviders,
    ...emoteProviders
  });
  all[channel] = cfg;
  saveAllToBotConfig(all);
}
