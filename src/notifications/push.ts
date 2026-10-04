import messaging from "@react-native-firebase/messaging";
import { PermissionsAndroid, Platform } from "react-native";

export async function requestPushPermission(): Promise<boolean> {
  try {
    if (
      Platform.OS === "android" &&
      typeof Platform.Version === "number" &&
      Platform.Version >= 33
    ) {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
      if (result !== PermissionsAndroid.RESULTS.GRANTED) {
        return false;
      }
    }
    const status = await messaging().requestPermission();
    return (
      status === messaging.AuthorizationStatus.AUTHORIZED ||
      status === messaging.AuthorizationStatus.PROVISIONAL
    );
  } catch (error) {
    console.log("[push] permission error", error);
    return false;
  }
}

export async function getFcmToken(): Promise<string | null> {
  try {
    return await messaging().getToken();
  } catch (error) {
    console.log("[push] getToken error", error);
    return null;
  }
}

export function onTokenRefresh(
  handler: (token: string) => void,
): () => void {
  return messaging().onTokenRefresh(handler);
}

export function onNotificationTap(
  handler: (data: Record<string, string>) => void,
  onInitial: (data: Record<string, string>) => void,
): () => void {
  const unsubscribe = messaging().onNotificationOpenedApp(remoteMessage => {
    if (remoteMessage?.data) {
      handler(remoteMessage.data as Record<string, string>);
    }
  });
  messaging()
    .getInitialNotification()
    .then(initial => {
      if (initial?.data) {
        onInitial(initial.data as Record<string, string>);
      }
    })
    .catch(() => {});
  return unsubscribe;
}
