import { CometChat } from "@cometchat/chat-sdk-react-native";
import { CometChatUIKit } from "@cometchat/chat-uikit-react-native";

let activeUid: string | null = null;

export async function ensureCometChatSession(
  uid: string,
  displayName: string,
): Promise<void> {
  if (activeUid === uid && CometChatUIKit.loggedInUser) {
    return;
  }
  try {
    await CometChatUIKit.createUser(
      new CometChat.User({ uid, name: displayName }),
    ).catch(() => {});
    await CometChatUIKit.login({ uid });
    activeUid = uid;
    console.log("[CometChat] background session established for calls");
  } catch (error) {
    console.log("[CometChat] background session failed (calls unavailable)", error);
  }
}

export function clearCometChatSession(): Promise<unknown> {
  activeUid = null;
  return CometChatUIKit.logout().catch(() => undefined);
}
