import { create } from 'zustand';
import config from './config.json';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * ---------------------------------------------------------------------------
 * THIS STORE IS NOT A THEME SOURCE. DO NOT MAKE IT ONE.
 * ---------------------------------------------------------------------------
 *
 * `config.json` ships `settings.style.theme: "system"` and a `brandColor`, and
 * this store persists the whole config under `@app_config`. It is therefore the
 * obvious-looking place to put a light/dark override, and it is the wrong place
 * for one concrete reason: `initializeConfig()` below is ASYNC. It reads
 * AsyncStorage after the first render, so anything derived from
 * `useConfigStore` would resolve one tick (or one network round trip) after the
 * app has already painted -- a flash of the wrong theme on every cold start --
 * and, worse, a persisted value would win over the OS until the next cold start
 * re-read it. That is precisely the "it only switches after I relaunch" symptom.
 *
 * The colour scheme is read from the device exactly once, in
 * `src/theme/useAppTheme.ts`. If a user-facing light/dark override is ever
 * wanted, it has to be applied there, synchronously, as an in-app value -- not
 * hydrated out of storage underneath the theme.
 *
 * Nothing currently reads this store (`useConfig` has no call sites); it is
 * kept because `src/config/config.json` is still part of the project.
 */

// TypeScript interfaces for the config structure
interface ColorConfig {
  brandColor: string;
  primaryTextLight: string;
  primaryTextDark: string;
  secondaryTextLight: string;
  secondaryTextDark: string;
}

interface TypographyConfig {
  font: string;
  size: string;
}

interface StyleConfig {
  theme: string;
  color: ColorConfig;
  typography: TypographyConfig;
}

interface LayoutConfig {
  withSideBar: boolean;
  tabs: string[];
  chatType: string;
  compactMessageComposer: boolean;
}

interface CoreMessagingConfig {
  typingIndicator: boolean;
  threadConversationAndReplies: boolean;
  photosSharing: boolean;
  videoSharing: boolean;
  audioSharing: boolean;
  fileSharing: boolean;
  editMessage: boolean;
  deleteMessage: boolean;
  messageDeliveryAndReadReceipts: boolean;
  userAndFriendsPresence: boolean;
}

interface DeeperEngagementConfig {
  mentions: boolean;
  reactions: boolean;
  messageTranslation: boolean;
  polls: boolean;
  collaborativeWhiteboard: boolean;
  collaborativeDocument: boolean;
  voiceNotes: boolean;
  emojis: boolean;
  stickers: boolean;
  userInfo: boolean;
  groupInfo: boolean;
}

interface AiUserCopilotConfig {
  conversationStarter: boolean;
  conversationSummary: boolean;
  smartReply: boolean;
}

interface GroupManagementConfig {
  createGroup: boolean;
  addMembersToGroups: boolean;
  joinLeaveGroup: boolean;
  deleteGroup: boolean;
  viewGroupMembers: boolean;
}

interface ModeratorControlsConfig {
  kickUsers: boolean;
  banUsers: boolean;
  promoteDemoteMembers: boolean;
}

interface PrivateMessagingConfig {
  sendPrivateMessageToGroupMembers: boolean;
}

interface ChatFeaturesConfig {
  coreMessagingExperience: CoreMessagingConfig;
  deeperUserEngagement: DeeperEngagementConfig;
  aiUserCopilot: AiUserCopilotConfig;
  groupManagement: GroupManagementConfig;
  moderatorControls: ModeratorControlsConfig;
  privateMessagingWithinGroups: PrivateMessagingConfig;
}

interface VoiceVideoCallingConfig {
  oneOnOneVoiceCalling: boolean;
  oneOnOneVideoCalling: boolean;
  groupVideoConference: boolean;
  groupVoiceConference: boolean;
}

interface CallFeaturesConfig {
  voiceAndVideoCalling: VoiceVideoCallingConfig;
}

interface SettingsConfig {
  chatFeatures: ChatFeaturesConfig;
  callFeatures: CallFeaturesConfig;
  layout: LayoutConfig;
  style: StyleConfig;
}

interface AppConfig {
  builderId: string;
  settings: SettingsConfig;
  name: string;
  type: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

// Zustand store interface
interface ConfigStore {
  config: AppConfig;
  updateConfig: (newConfig: Partial<AppConfig>) => void;
  resetConfig: () => void;
}

// Initialize config from storage
const initializeConfig = async (): Promise<AppConfig> => {
  try {
    const savedConfig = await AsyncStorage.getItem('@app_config');
    if (savedConfig) {
      const parsedConfig = JSON.parse(savedConfig);
      
      // Handle both old format (direct config) and new API response format (nested in data)
      let actualConfig: AppConfig;
      if (parsedConfig.data && parsedConfig.data.settings) {
        // New API response format - extract data property
        actualConfig = parsedConfig.data as AppConfig;
      } else if (parsedConfig.settings && parsedConfig.builderId) {
        // Old format - direct config
        actualConfig = parsedConfig as AppConfig;
      } else {
        // Invalid structure, use default
        return config as AppConfig;
      }
      
      // Validate that the config has the expected structure
      if (actualConfig && actualConfig.settings && actualConfig.builderId) {
        return actualConfig;
      }
    }
  } catch (error) {
    console.error('Error loading config from storage:', error);
  }
  return config as AppConfig;
};

// Create the Zustand store
export const useConfigStore = create<ConfigStore>((set, _get) => ({
  // Initialize with the config.json data
  config: config as AppConfig,

  // Update the entire config
  updateConfig: (newConfig) =>
    set((state) => ({
      config: { ...state.config, ...newConfig },
    })),

  // Reset to original config
  resetConfig: () =>
    set({
      config: config as AppConfig,
    }),
}));

// Initialize the store with saved config if available
initializeConfig().then((initialConfig) => {
  useConfigStore.setState({ config: initialConfig });
}).catch((error) => {
  console.error('Error initializing config:', error);
  // Fallback to default config from JSON file
  useConfigStore.setState({ config: config as AppConfig });
});

export const useConfig = <T>(selector: (state: AppConfig) => T) =>
  useConfigStore((state) => selector(state.config));
