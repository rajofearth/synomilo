import React, { useCallback } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useTheme } from '@cometchat/chat-uikit-react-native';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';
import {
  Appbar,
  Avatar,
  Button,
  Divider,
  List,
  Text,
} from 'react-native-paper';
import { useSession } from '../../auth/SessionProvider';

const ProfileScreen = ({ navigation }: any) => {
  const theme = useTheme();
  const { user, signOut } = useSession();

  const displayName = user?.displayName ?? 'Unknown';
  const username = user?.username ?? 'unknown';
  const initials =
    displayName
      .trim()
      .split(/\s+/)
      .map(part => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?';

  const confirmSignOut = useCallback(() => {
    Alert.alert('Sign out', 'Are you sure?', [
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
          title="Profile"
          titleStyle={{ color: theme.color.textPrimary }}
        />
      </Appbar.Header>

      <View style={styles.hero}>
        <Avatar.Text
          size={96}
          label={initials}
          style={{ backgroundColor: theme.color.extendedPrimary50 }}
          color={theme.color.primary}
        />
        <Text
          variant="headlineMedium"
          style={[styles.name, { color: theme.color.textPrimary }]}
        >
          {displayName}
        </Text>
        <Text variant="bodyMedium" style={{ color: theme.color.textSecondary }}>
          @{username}
        </Text>
      </View>

      <List.Section
        title="Account"
        titleStyle={{ color: theme.color.textSecondary }}
      >
        <List.Item
          title="Username"
          titleStyle={{ color: theme.color.textPrimary }}
          right={({ style }) => (
            <Text
              variant="bodyMedium"
              style={[style, { color: theme.color.textSecondary }]}
            >
              @{username}
            </Text>
          )}
        />
        <Divider style={{ backgroundColor: theme.color.borderDefault }} />
        <List.Item
          title="Display name"
          titleStyle={{ color: theme.color.textPrimary }}
          right={({ style }) => (
            <Text
              variant="bodyMedium"
              style={[style, { color: theme.color.textSecondary }]}
            >
              {displayName}
            </Text>
          )}
        />
      </List.Section>

      <List.Section
        title="Settings"
        titleStyle={{ color: theme.color.textSecondary }}
      >
        <List.Item
          title="Settings"
          titleStyle={{ color: theme.color.textPrimary }}
          left={({ style }) => (
            <MaterialDesignIcons
              name="cog-outline"
              size={24}
              style={style}
              color={theme.color.textSecondary}
            />
          )}
          onPress={() => navigation.navigate('Settings')}
        />
      </List.Section>

      <View style={styles.footer}>
        <Button
          mode="outlined"
          textColor="#E5484D"
          icon={() => (
            <MaterialDesignIcons name="logout" size={20} color="#E5484D" />
          )}
          style={[styles.signOutButton, { borderColor: '#E5484D' }]}
          onPress={confirmSignOut}
        >
          Sign out
        </Button>
      </View>
    </View>
  );
};

export default ProfileScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  hero: {
    alignItems: 'center',
    paddingTop: 32,
    paddingBottom: 24,
  },
  name: {
    marginTop: 16,
    marginBottom: 4,
  },
  footer: {
    marginTop: 'auto',
    padding: 16,
  },
  signOutButton: {
    borderWidth: 1,
  },
});
