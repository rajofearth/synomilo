import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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

  const openChat = useCallback(
    (item: ConversationRow) => {
      navigation.navigate('Messages', {
        conversationId: item._id,
        title: item.title,
      });
    },
    [navigation],
  );

  const confirmLeave = useCallback(
    (item: ConversationRow) => {
      Alert.alert(
        'Leave conversation',
        `Leave "${item.title}"?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Leave',
            style: 'destructive',
            onPress: async () => {
              if (!token) {
                return;
              }
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
            },
          },
        ],
      );
    },
    [token, leaveConversation],
  );

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
            Start a chat from the Users tab, or create a wedding group from the
            Groups tab.
          </Text>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={item => item._id}
          onRefresh={() => {}}
          refreshing={false}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              onPress={() => openChat(item)}
              onLongPress={() => confirmLeave(item)}
            >
              <View
                style={[
                  styles.rowAvatar,
                  { backgroundColor: theme.color.extendedPrimary50 },
                ]}
              >
                {item.type === 'group' ? (
                  <Text style={styles.rowAvatarEmoji}>{item.emoji ?? '💍'}</Text>
                ) : (
                  <Text
                    style={[
                      styles.rowAvatarInitials,
                      { color: theme.color.primary },
                    ]}
                  >
                    {initialsFor(item.title)}
                  </Text>
                )}
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
            </TouchableOpacity>
          )}
        />
      )}
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
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowAvatarEmoji: {
    fontSize: 24,
  },
  rowAvatarInitials: {
    fontSize: 18,
    fontWeight: '700',
  },
  rowBody: {
    flex: 1,
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
});
