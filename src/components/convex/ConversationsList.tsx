import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Dialog, Portal, Text, useTheme } from 'react-native-paper';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';
import { useQuery, useMutation } from 'convex/react';
import dayjs from 'dayjs';
import { api } from '../../../convex/_generated/api';
import { useSession } from '../../auth/SessionProvider';
import { convexErrorMessage } from '../../utils/convexError';
import { APP_NAME } from '../../utils/AppConstants';
import UserAvatar from './UserAvatar';

type ConversationRow = {
  _id: string;
  type: 'dm' | 'group';
  title: string;
  emoji: string | null;
  avatarUrl?: string | null;
  memberCount: number;
  lastMessageAt: number;
  lastMessagePreview: string;
  unreadCount: number;
  typingName?: string | null;
  muted?: boolean;
};

const formatTime = (ts: number): string => {
  const d = dayjs(ts);
  const now = dayjs();
  if (d.isSame(now, 'day')) {
    return d.format('h:mm A');
  }
  if (d.isSame(now, 'year')) {
    return d.format('MMM D');
  }
  return d.format('MMM D, YYYY');
};

const ConversationsList = ({ navigation }: any) => {
  const { colors } = useTheme();
  const { token } = useSession();
  const conversations = useQuery(
    api.conversations.list,
    token ? { token } : 'skip',
  ) as ConversationRow[] | undefined;
  const leaveConversation = useMutation(api.conversations.leave);
  const [leaveTarget, setLeaveTarget] = useState<ConversationRow | null>(null);

  const openChat = useCallback(
    (item: ConversationRow) => {
      navigation.navigate('Messages', {
        conversationId: item._id,
        title: item.title,
      });
    },
    [navigation],
  );

  const confirmLeave = useCallback((item: ConversationRow) => {
    setLeaveTarget(item);
  }, []);

  const dismissLeave = useCallback(() => {
    setLeaveTarget(null);
  }, []);

  const performLeave = useCallback(async () => {
    const item = leaveTarget;
    if (!item || !token) {
      return;
    }
    setLeaveTarget(null);
    try {
      await leaveConversation({
        token,
        conversationId: item._id as any,
      });
    } catch (error) {
      Alert.alert(
        'Could not leave',
        convexErrorMessage(error, 'Please try again.'),
      );
    }
  }, [leaveTarget, token, leaveConversation]);

  const data = useMemo(() => conversations ?? [], [conversations]);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      {/**
       * The header names the app, not the screen: "Chats" here duplicated the tab
       * label directly below it, and every other tab header in the app does the same
       * (Calls names itself once, in one place).
       *
       * The profile avatar is gone rather than moved. Profile is a bottom tab, so the
       * avatar in this header was a second, fatter route to a screen one tap away —
       * and it was the only thing making the header a three-element row.
       *
       * That leaves a title and the one action worth having. The title takes `flex: 1`
       * so it stays left-aligned against the 16pt gutter shared by every other screen
       * header, and the filled "+" carries the right-hand weight on its own — the
       * WhatsApp arrangement, where the only two things in the bar are what it is and
       * what you can do next.
       */}
      <View style={styles.header}>
        <Text variant="headlineMedium" style={styles.headerTitle}>
          {APP_NAME}
        </Text>

        <Pressable
          style={({ pressed }) => [
            styles.iconButton,
            {
              backgroundColor: colors.primary,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Start a new chat"
          hitSlop={8}
          onPress={() => navigation.navigate('AddContact')}
        >
          <MaterialDesignIcons
            name="plus"
            size={26}
            color={colors.onPrimary}
          />
        </Pressable>
      </View>

      {conversations === undefined ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.onSurfaceVariant} />
        </View>
      ) : data.length === 0 ? (
        <View style={styles.center}>
          <Text variant="headlineSmall" style={styles.emptyTitle}>
            No conversations yet
          </Text>
          <Text
            variant="bodyMedium"
            style={[styles.emptyHint, { color: colors.onSurfaceVariant }]}
          >
            Tap + to find someone by username and start a chat.
          </Text>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={item => item._id}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: colors.surfaceVariant },
              ]}
              onPress={() => openChat(item)}
              onLongPress={() => confirmLeave(item)}
            >
              <View
                style={[
                  styles.rowAvatar,
                  item.type === 'group' && styles.rowAvatarGroup,
                  { backgroundColor: colors.surfaceVariant },
                ]}
              >
                <UserAvatar
                  entity={item}
                  name={item.title}
                  size={52}
                  variant="text"
                  shape={item.type === 'group' ? 'rounded' : 'circle'}
                  labelStyle={styles.rowAvatarInitials}
                  labelColor={colors.onSurfaceVariant}
                />
              </View>
              <View style={styles.rowBody}>
                <View style={styles.rowTop}>
                  <Text
                    numberOfLines={1}
                    variant="titleSmall"
                    style={[
                      styles.rowTitle,
                      { color: colors.onSurface },
                    ]}
                  >
                    {item.title}
                  </Text>
                  <Text
                    variant="labelSmall"
                    style={{ color: colors.onSurfaceVariant }}
                  >
                    {formatTime(item.lastMessageAt)}
                  </Text>
                </View>
                <View style={styles.rowBottom}>
                  {item.typingName ? (
                    <Text
                      numberOfLines={1}
                      variant="bodySmall"
                      style={[styles.rowPreview, { color: colors.onSurface }]}
                    >
                      {item.typingName} is typing…
                    </Text>
                  ) : (
                    <Text
                      numberOfLines={1}
                      variant="bodySmall"
                      style={[
                        styles.rowPreview,
                        {
                          color:
                            item.unreadCount > 0
                              ? colors.onSurface
                              : colors.onSurfaceVariant,
                        },
                      ]}
                    >
                      {item.lastMessagePreview}
                    </Text>
                  )}
                  {item.unreadCount > 0 && (
                    <View
                      style={[styles.badge, { backgroundColor: colors.primary }]}
                    >
                      <Text
                        variant="labelSmall"
                        style={{ color: colors.onPrimary }}
                      >
                        {item.unreadCount > 99 ? '99+' : item.unreadCount}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </Pressable>
          )}
        />
      )}

      <Portal>
        <Dialog
          visible={leaveTarget != null}
          onDismiss={dismissLeave}
          style={{ backgroundColor: colors.elevation.level3 }}
        >
          <Dialog.Title style={{ color: colors.onSurface }}>
            Leave conversation
          </Dialog.Title>
          <Dialog.Content>
            <Text style={{ color: colors.onSurfaceVariant }}>
              {leaveTarget ? `Leave "${leaveTarget.title}"?` : ''}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={dismissLeave} textColor={colors.onSurfaceVariant}>
              Cancel
            </Button>
            <Button onPress={performLeave} textColor={colors.onSurface}>
              Leave
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </SafeAreaView>
  );
};

export default ConversationsList;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerTitle: {
    flex: 1,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyHint: {
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 8,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowAvatarGroup: {
    borderRadius: 16,
  },
  rowAvatarInitials: {
    fontSize: 18,
    fontWeight: '700',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  rowTitle: {
    flex: 1,
  },
  rowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  rowPreview: {
    flex: 1,
    marginRight: 8,
  },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});