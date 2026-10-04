import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { useTheme } from '@cometchat/chat-uikit-react-native';
import { useQuery, useMutation } from 'convex/react';
import { Appbar, Searchbar, Avatar, Divider, ActivityIndicator } from 'react-native-paper';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';
import { api } from '../../../convex/_generated/api';
import { useSession } from '../../auth/SessionProvider';
import { convexErrorMessage } from '../../utils/convexError';

type ForwardableMessage = {
  _id: string;
  kind: 'text' | 'image' | 'video' | 'audio' | 'file';
  body: string | null;
  fileName: string | null;
  mimeType: string | null;
  size: number | null;
  storageId: string | null;
  sender: { displayName: string };
};

type ConversationRow = {
  _id: string;
  type: 'dm' | 'group';
  title: string;
  emoji: string | null;
  otherUserId: string | null;
  memberCount: number;
  lastMessageAt: number;
  lastMessagePreview: string;
  unreadCount: number;
  typingName: string | null;
  muted: boolean;
};

const initialsFor = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('');

const iconForKind = (kind: ForwardableMessage['kind']): string => {
  if (kind === 'image') return 'image';
  if (kind === 'video') return 'video';
  if (kind === 'audio') return 'microphone';
  if (kind === 'file') return 'file-document';
  return 'format-text';
};

const previewForMessage = (message: ForwardableMessage): string => {
  if (message.kind === 'text') return message.body ?? '';
  if (message.kind === 'image') return 'Photo';
  if (message.kind === 'video') return 'Video';
  if (message.kind === 'audio') return 'Voice note';
  return message.fileName ?? 'File';
};

const ForwardMessageScreen = ({ route, navigation }: any) => {
  const theme = useTheme();
  const { token } = useSession();
  const message = route.params?.message as ForwardableMessage;

  const conversations = useQuery(
    api.conversations.list,
    token ? { token } : 'skip',
  ) as ConversationRow[] | undefined;
  const sendMessage = useMutation(api.messages.send);

  const [search, setSearch] = useState('');
  const [sendingId, setSendingId] = useState<string | null>(null);

  const data = useMemo(() => {
    const rows = conversations ?? [];
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter(item => item.title.toLowerCase().includes(query));
  }, [conversations, search]);

  const forwardTo = useCallback(
    async (item: ConversationRow) => {
      if (!token || sendingId) return;
      setSendingId(item._id);
      try {
        await sendMessage({
          token,
          conversationId: item._id as any,
          kind: message.kind,
          body: message.body ?? undefined,
          storageId: message.storageId ?? undefined,
          fileName: message.fileName ?? undefined,
          mimeType: message.mimeType ?? undefined,
          size: message.size ?? undefined,
          forwardedFrom: message.sender.displayName,
        });
        setSendingId(null);
        Alert.alert('Forwarded', `Sent to ${item.title}`);
        navigation.goBack();
      } catch (error) {
        setSendingId(null);
        Alert.alert('Forward failed', convexErrorMessage(error, 'Could not forward the message'));
      }
    },
    [token, sendingId, message, sendMessage, navigation],
  );

  const renderItem = useCallback(
    ({ item }: { item: ConversationRow }) => {
      const busy = sendingId === item._id;
      return (
        <TouchableOpacity
          style={styles.row}
          activeOpacity={0.7}
          disabled={!!sendingId}
          onPress={() => forwardTo(item)}
        >
          <Avatar.Text
            size={44}
            label={initialsFor(item.title)}
            style={{ backgroundColor: theme.color.extendedPrimary50 }}
            labelStyle={[styles.avatarLabel, { color: theme.color.primary }]}
          />
          <View style={styles.rowBody}>
            <Text
              numberOfLines={1}
              style={[theme.typography.body.medium, { color: theme.color.textPrimary }]}
            >
              {item.title}
            </Text>
            <Text
              numberOfLines={1}
              style={[theme.typography.caption1.regular, styles.rowPreview, { color: theme.color.textSecondary }]}
            >
              {item.lastMessagePreview}
            </Text>
          </View>
          {busy ? (
            <ActivityIndicator size={20} color={theme.color.primary} />
          ) : (
            <MaterialDesignIcons name="chevron-right" size={24} color={theme.color.textTertiary} />
          )}
        </TouchableOpacity>
      );
    },
    [theme, sendingId, forwardTo],
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.color.background1 }]}>
      <Appbar.Header
        style={{ backgroundColor: theme.color.background2, elevation: 0 }}
      >
        <Appbar.BackAction onPress={() => navigation.goBack()} color={theme.color.textPrimary} />
        <Appbar.Content
          title="Forward to…"
          titleStyle={[theme.typography.heading3.bold, { color: theme.color.textPrimary }]}
        />
      </Appbar.Header>

      <View style={styles.previewWrap}>
        <View
          style={[
            styles.preview,
            { backgroundColor: theme.color.background2, borderColor: theme.color.borderDefault },
          ]}
        >
          <View style={[styles.previewIcon, { backgroundColor: theme.color.extendedPrimary50 }]}>
            <MaterialDesignIcons name={iconForKind(message.kind)} size={22} color={theme.color.primary} />
          </View>
          <View style={styles.previewBody}>
            <Text
              numberOfLines={1}
              style={[theme.typography.caption1.regular, { color: theme.color.textSecondary }]}
            >
              Forwarding from {message.sender.displayName}
            </Text>
            <Text
              numberOfLines={2}
              style={[theme.typography.body.medium, { color: theme.color.textPrimary }]}
            >
              {previewForMessage(message)}
            </Text>
          </View>
        </View>
        <Searchbar
          placeholder="Search conversations"
          value={search}
          onChangeText={setSearch}
          elevation={0}
          iconColor={theme.color.textSecondary}
          placeholderTextColor={theme.color.textTertiary}
          style={[styles.searchbar, { backgroundColor: theme.color.background3 }]}
          inputStyle={[theme.typography.body.regular, { color: theme.color.textPrimary }]}
        />
      </View>

      {conversations === undefined ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.color.primary} />
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={item => item._id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => (
            <Divider style={[styles.divider, { backgroundColor: theme.color.borderDefault }]} />
          )}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={[theme.typography.body.medium, { color: theme.color.textSecondary }]}>
                No conversations found
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
};

export default ForwardMessageScreen;

const styles = StyleSheet.create({
  container: { flex: 1 },
  previewWrap: { paddingHorizontal: 12, paddingTop: 12 },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  previewIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewBody: { flex: 1, marginLeft: 12 },
  searchbar: { marginTop: 12, borderRadius: 12 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  listContent: { flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  avatarLabel: { fontWeight: '700' },
  rowBody: { flex: 1, marginLeft: 12, marginRight: 8 },
  rowPreview: { marginTop: 2 },
  divider: { marginLeft: 72, height: StyleSheet.hairlineWidth },
});
