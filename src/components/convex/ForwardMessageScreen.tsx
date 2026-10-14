import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { useQuery, useMutation } from 'convex/react';
import {
  Appbar,
  Searchbar,
  Divider,
  ActivityIndicator,
  Text,
  useTheme,
} from 'react-native-paper';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';
import { api } from '../../../convex/_generated/api';
import { useSession } from '../../auth/SessionProvider';
import { convexErrorMessage } from '../../utils/convexError';
import UserAvatar from './UserAvatar';

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
  avatarUrl: string | null;
  otherUserId: string | null;
  memberCount: number;
  lastMessageAt: number;
  lastMessagePreview: string;
  unreadCount: number;
  typingName: string | null;
  muted: boolean;
};

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

/**
 * Every colour and every text style below comes from react-native-paper's theme.
 *
 * This screen used to read `theme.color.*` and `theme.typography.*` from the UIKit
 * UIKit, which `App.tsx` feeds a single frozen palette (the same object is handed to the
 * UIKit's `light` and `dark` slots), so flipping the phone to light mode left this screen
 * on the dark palette while the tab bar and the chat list moved. Paper's theme is rebuilt
 * on every `useColorScheme()` change, so it tracks the device.
 */
const ForwardMessageScreen = ({ route, navigation }: any) => {
  const { colors } = useTheme();
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
          storageId: (message.storageId ?? undefined) as any,
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
      const corner = item.type === 'group' ? 16 : 22;
      return (
        <TouchableOpacity
          style={styles.row}
          activeOpacity={0.7}
          disabled={!!sendingId}
          onPress={() => forwardTo(item)}
        >
          <UserAvatar
            entity={item}
            name={item.title}
            size={44}
            variant="paper"
            radius={corner}
            imageStyle={{ width: 44, height: 44, borderRadius: corner }}
            initialsStyle={{
              backgroundColor: colors.primaryContainer,
              borderRadius: corner,
            }}
            labelStyle={[styles.avatarLabel, { color: colors.onPrimaryContainer }]}
          />
          <View style={styles.rowBody}>
            <Text
              numberOfLines={1}
              variant="bodyLarge"
              style={{ color: colors.onSurface }}
            >
              {item.title}
            </Text>
            <Text
              numberOfLines={1}
              variant="bodySmall"
              style={[styles.rowPreview, { color: colors.onSurfaceVariant }]}
            >
              {item.lastMessagePreview}
            </Text>
          </View>
          {busy ? (
            <ActivityIndicator size={20} color={colors.onSurfaceVariant} />
          ) : (
            <MaterialDesignIcons name="chevron-right" size={24} color={colors.outline} />
          )}
        </TouchableOpacity>
      );
    },
    [colors, sendingId, forwardTo],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Appbar.Header
        style={{ backgroundColor: colors.surface, elevation: 0 }}
      >
        <Appbar.BackAction onPress={() => navigation.goBack()} color={colors.onSurface} />
        <Appbar.Content
          title="Forward to"
          titleStyle={{ color: colors.onSurface }}
        />
      </Appbar.Header>

      <View style={styles.previewWrap}>
        <View
          style={[
            styles.preview,
            { backgroundColor: colors.surface, borderColor: colors.outlineVariant },
          ]}
        >
          <View
            style={[styles.previewIcon, { backgroundColor: colors.primaryContainer }]}
          >
            <MaterialDesignIcons
              name={iconForKind(message.kind) as never}
              size={22}
              color={colors.onPrimaryContainer}
            />
          </View>
          <View style={styles.previewBody}>
            <Text
              numberOfLines={1}
              variant="bodySmall"
              style={{ color: colors.onSurfaceVariant }}
            >
              Forwarding from {message.sender.displayName}
            </Text>
            <Text
              numberOfLines={2}
              variant="bodyMedium"
              style={{ color: colors.onSurface }}
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
          iconColor={colors.onSurfaceVariant}
          placeholderTextColor={colors.onSurfaceVariant}
          style={[styles.searchbar, { backgroundColor: colors.surfaceVariant }]}
          inputStyle={{ color: colors.onSurface }}
        />
      </View>

      {conversations === undefined ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.onSurfaceVariant} />
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={item => item._id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => (
            <Divider style={[styles.divider, { backgroundColor: colors.outlineVariant }]} />
          )}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
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
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  previewIcon: {
    width: 40,
    height: 40,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewBody: { flex: 1, marginLeft: 12 },
  searchbar: { marginTop: 12, borderRadius: 16 },
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