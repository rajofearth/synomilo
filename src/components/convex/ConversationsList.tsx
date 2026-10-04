import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Dialog, FAB, Portal } from 'react-native-paper';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';
import { useTheme } from '@cometchat/chat-uikit-react-native';
import { useQuery, useMutation } from 'convex/react';
import dayjs from 'dayjs';
import { api } from '../../../convex/_generated/api';
import { useSession } from '../../auth/SessionProvider';
import { convexErrorMessage } from '../../utils/convexError';

type ConversationRow = {
  _id: string;
  type: 'dm' | 'group';
  title: string;
  emoji: string | null;
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

const initialsFor = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('');

const ConversationsList = ({ navigation }: any) => {
  const theme = useTheme();
  const { token, user } = useSession();
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
      style={[styles.container, { backgroundColor: theme.color.background2 }]}
      edges={['top']}
    >
      <View style={styles.header}>
        <Text
          style={[
            theme.typography.heading1.bold,
            { color: theme.color.textPrimary },
          ]}
        >
          Chats
        </Text>
        <TouchableOpacity
          style={[
            styles.avatarButton,
            { backgroundColor: theme.color.primary },
          ]}
          onPress={() => navigation.navigate('Profile')}
        >
          <Text style={styles.avatarText}>
            {initialsFor(user?.displayName ?? '?')}
          </Text>
        </TouchableOpacity>
      </View>

      {conversations === undefined ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.color.primary} />
        </View>
      ) : data.length === 0 ? (
        <View style={styles.center}>
          <Text
            style={[
              theme.typography.heading3.bold,
              { color: theme.color.textPrimary },
            ]}
          >
            No conversations yet
          </Text>
          <Text
            style={[
              theme.typography.body.medium,
              styles.emptyHint,
              { color: theme.color.textSecondary },
            ]}
          >
            Start a chat from the Users tab, or create a group.
          </Text>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={item => item._id}
          onRefresh={() => {}}
          refreshing={false}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: theme.color.background3 },
              ]}
              onPress={() => openChat(item)}
              onLongPress={() => confirmLeave(item)}
            >
              <View
                style={[
                  styles.rowAvatar,
                  item.type === 'group' && styles.rowAvatarGroup,
                  { backgroundColor: theme.color.extendedPrimary50 },
                ]}
              >
                <Text
                  style={[
                    styles.rowAvatarInitials,
                    { color: theme.color.primary },
                  ]}
                >
                  {initialsFor(item.title)}
                </Text>
              </View>
              <View style={styles.rowBody}>
                <View style={styles.rowTop}>
                  <Text
                    numberOfLines={1}
                    style={[
                      theme.typography.body.medium,
                      styles.rowTitle,
                      { color: theme.color.textPrimary },
                    ]}
                  >
                    {item.title}
                  </Text>
                  <Text
                    style={[
                      theme.typography.caption1.regular,
                      { color: theme.color.textTertiary },
                    ]}
                  >
                    {formatTime(item.lastMessageAt)}
                  </Text>
                </View>
                <View style={styles.rowBottom}>
                  {item.typingName ? (
                    <Text
                      numberOfLines={1}
                      style={[
                        theme.typography.caption1.regular,
                        styles.rowPreview,
                        { color: theme.color.primary },
                      ]}
                    >
                      {item.typingName} is typing…
                    </Text>
                  ) : (
                    <Text
                      numberOfLines={1}
                      style={[
                        theme.typography.caption1.regular,
                        styles.rowPreview,
                        {
                          color:
                            item.unreadCount > 0
                              ? theme.color.textPrimary
                              : theme.color.textSecondary,
                        },
                      ]}
                    >
                      {item.lastMessagePreview}
                    </Text>
                  )}
                  {item.unreadCount > 0 && (
                    <View
                      style={[
                        styles.badge,
                        { backgroundColor: theme.color.primary },
                      ]}
                    >
                      <Text style={styles.badgeText}>
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
      <FAB
        variant="primary"
        style={styles.fab}
        icon={({ size, color }) => (
          <MaterialDesignIcons
            name="account-group-outline"
            size={size}
            color={color}
          />
        )}
        onPress={() => navigation.navigate('Groups')}
      />
      <Portal>
        <Dialog
          visible={leaveTarget != null}
          onDismiss={dismissLeave}
          style={[styles.dialog, { backgroundColor: theme.color.background2 }]}
        >
          <Dialog.Title style={{ color: theme.color.textPrimary }}>
            Leave conversation
          </Dialog.Title>
          <Dialog.Content>
            <Text
              style={[
                theme.typography.body.medium,
                { color: theme.color.textSecondary },
              ]}
            >
              {leaveTarget ? `Leave "${leaveTarget.title}"?` : ''}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button
              onPress={dismissLeave}
              textColor={theme.color.primary as string}
            >
              Cancel
            </Button>
            <Button
              onPress={performLeave}
              textColor={theme.color.error as string}
            >
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
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  avatarButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  menu: {
    position: 'absolute',
    top: 64,
    right: 16,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    zIndex: 10,
    minWidth: 200,
  },
  menuName: {
    marginBottom: 8,
  },
  menuItem: {
    paddingVertical: 8,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyHint: {
    textAlign: 'center',
    marginTop: 8,
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
  },
  rowTitle: {
    flex: 1,
    marginRight: 8,
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
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    borderRadius: 20,
  },
  dialog: {
    borderRadius: 28,
  },
});
