import React, { useCallback } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import { useTheme } from '@cometchat/chat-uikit-react-native';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';
import { Appbar, Divider, List } from 'react-native-paper';
import { useSession } from '../../auth/SessionProvider';

const SettingsScreen = ({ navigation }: any) => {
  const theme = useTheme();
  const { signOut } = useSession();

  const confirmSignOut = useCallback(() => {
    Alert.alert('Sign out', 'This will sign you out on this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          signOut().catch(() => {});
        },
      },
    ]);
  }, [signOut]);

  const openSystemSettings = useCallback(() => {
    Linking.openSettings().catch(() => {});
  }, []);

  return (
    <View
      style={[styles.container, { backgroundColor: theme.color.background1 }]}
    >
      <Appbar.Header style={{ backgroundColor: theme.color.background2 }}>
        <Appbar.BackAction
          onPress={() => navigation.goBack()}
          color={theme.color.textPrimary}
        />
        <Appbar.Content
          title="Settings"
          titleStyle={{ color: theme.color.textPrimary }}
        />
      </Appbar.Header>

      <List.Section
        title="Notifications"
        titleStyle={{ color: theme.color.textSecondary }}
      >
        <List.Item
          title="App notification settings"
          description="Open system settings for synomiló"
          titleStyle={{ color: theme.color.textPrimary }}
          descriptionStyle={{ color: theme.color.textSecondary }}
          left={({ style }) => (
            <MaterialDesignIcons
              name="bell-outline"
              size={24}
              style={style}
              color={theme.color.textSecondary}
            />
          )}
          onPress={openSystemSettings}
        />
      </List.Section>

      <Divider style={{ backgroundColor: theme.color.borderDefault }} />

      <List.Section
        title="About"
        titleStyle={{ color: theme.color.textSecondary }}
      >
        <List.Item
          title="synomiló"
          description="Version 1.0.0 (Convex chat)"
          titleStyle={{ color: theme.color.textPrimary }}
          descriptionStyle={{ color: theme.color.textSecondary }}
          left={({ style }) => (
            <MaterialDesignIcons
              name="information-outline"
              size={24}
              style={style}
              color={theme.color.textSecondary}
            />
          )}
        />
      </List.Section>

      <Divider style={{ backgroundColor: theme.color.borderDefault }} />

      <List.Section>
        <List.Item
          title="Sign out"
          titleStyle={{ color: '#E5484D' }}
          left={({ style }) => (
            <MaterialDesignIcons
              name="logout"
              size={24}
              style={style}
              color="#E5484D"
            />
          )}
          onPress={confirmSignOut}
        />
      </List.Section>
    </View>
  );
};

export default SettingsScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
