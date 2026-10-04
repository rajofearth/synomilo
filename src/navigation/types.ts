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
  Profile: undefined;
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
  Users: undefined;
  Groups: undefined;
  SavedMessages: undefined;
  PinnedMessages: { user?: any; group?: any } | undefined;
  QRScreen: undefined;
};

export type BottomTabParamList = {
  Chats: undefined;
  Calls: undefined;
  Users: undefined;
  Groups: undefined;
};
