import { NavigatorScreenParams } from '@react-navigation/native';
import { CometChat } from '@cometchat/chat-sdk-react-native';

export type CallType = 'audio' | 'video';

export type RootStackParamList = {
  Login: undefined;
  SignUp: undefined;
  BottomTabNavigator: NavigatorScreenParams<BottomTabParamList>;
  OngoingCallScreen: { sessionId: string; callType?: CallType } | { call: any };
  CallScreen: {
    callId: string;
    type: 'audio' | 'video';
    role: 'caller' | 'callee';
    peerName: string;
  };
  ForwardMessage: {
    message: {
      _id: string;
      kind: 'text' | 'image' | 'video' | 'audio' | 'file';
      body: string | null;
      fileName: string | null;
      mimeType: string | null;
      size: number | null;
      storageId: string | null;
      sender: { displayName: string };
    };
  };
  ChatInfo: { conversationId: string; title?: string };
  ContactInfo: { conversationId: string };
  AddContact: undefined;
  Settings: undefined;
  AppCredentials: undefined;
  SampleUser: undefined;
  Conversation: undefined;
  CreateConversation: undefined;
  Messages: {
    conversationId?: string;
    title?: string;
    user?: CometChat.User;
    group?: CometChat.Group;
    fromMention?: boolean;
    fromMessagePrivately?: boolean;
    parentMessageId?: string;
    messageId?: string;
    searchKeyword?: string;
    navigatedFromSearch?: boolean;
  };
  SearchMessages: {
    user?: CometChat.User;
    group?: CometChat.Group;
  };
  AIAgents: undefined;
  BannedMembers: undefined;
  UserInfo: {
    user: CometChat.User;
  };
  GroupInfo: {
    group: CometChat.Group;
  };
  ThreadView: {
    message: CometChat.BaseMessage;
    user?: CometChat.User;
    group?: CometChat.Group;
    highlightMessageId?: string;
  };
  AddMember: {
    group: CometChat.Group;
  };
  TransferOwnershipSection: {
    group: CometChat.Group;
  };
  BannedMember: {
    group: CometChat.Group;
  };
  ViewMembers: {
    group: CometChat.Group;
  };
  CallLogs: undefined;
  CallDetails: {
    call: any;
  };
  SavedMessages: undefined;
  PinnedMessages: { user?: any; group?: any } | undefined;
  QRScreen: undefined;
};

export type BottomTabParamList = {
  Chats: undefined;
  Calls: undefined;
  Profile: undefined;
};

/**
 * TODO(dead-route audit) — candidates for removal, NOT removed here on purpose.
 *
 * Screens outside this module's ownership are being deleted as part of a cleanup pass, and
 * removing a route type before its screen is gone breaks `Stack.Screen` registration for
 * everyone. Each entry below was cross-checked against `RootStackNavigator.tsx` and a
 * repo-wide grep for `navigate(SCREEN_CONSTANTS.X)` / `navigate('X')`; "registered" means a
 * `<Stack.Screen name={...}>` still exists, "referenced" means some file still navigates
 * to it.
 *
 * Confirm against the screen list AFTER the deletion pass, then delete in one go.
 *
 * 1. `BannedMembers` — registered: NO. `SCREEN_CONSTANTS.BANNED_MEMBER` is `'BannedMember'`
 *    (singular), which IS registered and IS navigated to. This plural key is a leftover.
 *    Referenced: 0. Safe to delete.
 * 2. `Conversation`, `CreateConversation`, `UserInfo`, `GroupInfo`, `SearchMessages`,
 *    `QRScreen`, `AIAgents`, `CallLogs`, `CallDetails`, `SavedMessages`, `PinnedMessages`,
 *    `Settings`, `ChatInfo`, `ContactInfo` — registered: YES,
 *    `navigate()` referenced: 0 from a grep of `src/`. These screens are CometChat-era
 *    surfaces that the Convex rewrite may have left unreachable, but each is still mounted
 *    in `RootStackNavigator`, so the type must stay until the screen is removed.
 *    (`Users`, `Groups` and the stack-level `Profile` are NOT in this list any more: they
 *    were removed with the three-tab restructure — `Profile` survives as a tab route on
 *    `BottomTabParamList` instead.)
 * 3. `OngoingCallScreen` — registered and referenced once. Verify the caller before
 *    touching it; the calls rewrite may have replaced it with `CallScreen`.
 * 4. `CallType` — exported type used by `OngoingCallScreen` params only. Folds away with it.
 *
 * Everything else (`Login`, `SignUp`, `BottomTabNavigator`, `Messages`, `ThreadView`,
 * `ForwardMessage`, `AddMember`, `BannedMember`, `ViewMembers`,
 * `TransferOwnershipSection`, `CallScreen`, `AppCredentials`, `SampleUser`) is either
 * actively navigated to or is load-bearing for the auth flow.
 */
