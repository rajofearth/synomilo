import { NavigatorScreenParams } from '@react-navigation/native';

/**
 * The complete route surface of the app.
 *
 * Every entry here has a live `<Stack.Screen>` registration in `RootStackNavigator.tsx`
 * AND at least one real `navigate()` caller. The UIKit-era routes (Conversation,
 * CreateConversation, ThreadView, UserInfo, GroupInfo, AddMember, TransferOwnership,
 * BannedMember, ViewMembers, SearchMessages, SavedMessages, PinnedMessages, QRScreen,
 * AIAgents, CallDetails, OngoingCallScreen, AppCredentials, SampleUser) went out with the
 * screens themselves, and their param types folded away with them.
 */
export type RootStackParamList = {
  Login: undefined;
  SignUp: undefined;
  BottomTabNavigator: NavigatorScreenParams<BottomTabParamList>;
  CallScreen: {
    callId: string;
    type: 'audio' | 'video';
    role: 'caller' | 'callee';
    peerName: string;
  };
  Messages: {
    conversationId?: string;
    title?: string;
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
};

export type BottomTabParamList = {
  Chats: undefined;
  Calls: undefined;
  Profile: undefined;
};
