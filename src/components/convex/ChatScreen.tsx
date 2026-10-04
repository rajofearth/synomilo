import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@cometchat/chat-uikit-react-native';
import { useQuery, useMutation } from 'convex/react';
import dayjs from 'dayjs';
import Clipboard from '@react-native-clipboard/clipboard';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';
import { launchImageLibrary } from 'react-native-image-picker';
import {
  pick,
  types as docTypes,
  keepLocalCopy,
  isErrorWithCode,
  errorCodes,
} from '@react-native-documents/picker';
import { api } from '../../../convex/_generated/api';
import { useSession } from '../../auth/SessionProvider';
import { convexErrorMessage } from '../../utils/convexError';

const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '🙏', '🔥'];

type ReplyPreview = {
  _id: string;
  body: string | null;
  kind: 'text' | 'image' | 'video' | 'audio' | 'file';
  deletedAt: number | null;
  senderName: string;
};

type Message = {
  _id: string;
  conversationId: string;
  senderId: string;
  sender: { _id: string; displayName: string; username: string };
  kind: 'text' | 'image' | 'video' | 'audio' | 'file';
  body: string | null;
  fileName: string | null;
  mimeType: string | null;
  size: number | null;
  storageId: string | null;
  deletedAt: number | null;
  forwardedFrom: string | null;
  replyTo: ReplyPreview | null;
  fileUrl: string | null;
  createdAt: number;
  reactions: Array<{ emoji: string; count: number; mine: boolean }>;
};

const formatBytes = (bytes: number | null): string => {
  if (!bytes || bytes <= 0) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDayLabel = (ts: number): string => {
  const date = dayjs(ts);
  if (date.isSame(dayjs(), 'day')) {
    return 'Today';
  }
  if (date.isSame(dayjs().subtract(1, 'day'), 'day')) {
    return 'Yesterday';
  }
  if (date.isAfter(dayjs().subtract(6, 'day'))) {
    return date.format('dddd');
  }
  return date.format('MMMM D, YYYY');
};

const attachmentLabel = (kind: Message['kind']): string => {
  switch (kind) {
    case 'image':
      return 'Photo';
    case 'video':
      return 'Video';
    case 'audio':
      return 'Voice note';
    default:
      return 'Attachment';
  }
};

const uriToBlob = (uri: string): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => resolve(xhr.response);
    xhr.onerror = () => reject(new Error('Could not read the selected file'));
    xhr.responseType = 'blob';
    xhr.open('GET', uri, true);
    xhr.send();
  });

const ChatScreen = ({ route, navigation }: any) => {
  const theme = useTheme();
  const { token, user } = useSession();
  const conversationId = route.params?.conversationId as string;
  const fallbackTitle = (route.params?.title as string) ?? 'Chat';

  const conversation = useQuery(
    api.conversations.get,
    token && conversationId
      ? { token, conversationId: conversationId as any }
      : 'skip',
  );
  const thread = useQuery(
    api.messages.list,
    token && conversationId
      ? { token, conversationId: conversationId as any, limit: 60 }
      : 'skip',
  );
  const typingNames = useQuery(
    api.conversations.typing,
    token && conversationId
      ? { token, conversationId: conversationId as any }
      : 'skip',
  ) as string[] | undefined;
  const sendMessage = useMutation(api.messages.send);
  const removeMessage = useMutation(api.messages.remove);
  const toggleReaction = useMutation(api.reactions.toggle);
  const markRead = useMutation(api.conversations.markRead);
  const setTyping = useMutation(api.conversations.setTyping);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const startCall = useMutation(api.calls.start);

  const otherMember = useMemo(
    () => conversation?.members?.find(member => member._id !== user?._id),
    [conversation?.members, user?._id],
  );

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [actionTarget, setActionTarget] = useState<Message | null>(null);
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const listRef = useRef<FlatList<Message>>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const messages = useMemo(
    () => [...(thread?.messages ?? [])].reverse(),
    [thread],
  );

  useEffect(() => {
    if (token && conversationId) {
      markRead({ token, conversationId: conversationId as any }).catch(
        () => {},
      );
    }
  }, [token, conversationId, messages.length, markRead]);

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
      }
    };
  }, []);

  const onTextChange = useCallback(
    (value: string) => {
      setText(value);
      if (!token || !conversationId) {
        return;
      }
      setTyping({
        token,
        conversationId: conversationId as any,
        typing: value.trim().length > 0,
      }).catch(() => {});
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
      }
      typingTimerRef.current = setTimeout(() => {
        if (token && conversationId) {
          setTyping({
            token,
            conversationId: conversationId as any,
            typing: false,
          }).catch(() => {});
        }
      }, 3000);
    },
    [token, conversationId, setTyping],
  );

  const onSend = useCallback(async () => {
    const body = text.trim();
    if (!body || !token || sending) {
      return;
    }
    setText('');
    const replyToId = replyTarget?._id;
    setReplyTarget(null);
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
    }
    try {
      await sendMessage({
        token,
        conversationId: conversationId as any,
        body,
        replyToId: replyToId as any,
      });
    } catch (error) {
      setText(body);
      Alert.alert(
        'Message not sent',
        convexErrorMessage(error, 'Please try again.'),
      );
    }
  }, [text, token, sending, sendMessage, conversationId, replyTarget]);

  const uploadAsset = useCallback(
    async (
      asset: {
        uri?: string | null;
        fileName?: string | null;
        name?: string | null;
        type?: string | null;
        fileSize?: number | null;
        size?: number | null;
      },
      kind: Message['kind'],
    ) => {
      if (!token || !asset.uri) {
        return;
      }
      setSending(true);
      try {
        const postUrl = await generateUploadUrl({ token });
        const blob = await uriToBlob(asset.uri);
        const mime = asset.type ?? 'application/octet-stream';
        const response = await fetch(postUrl, {
          method: 'POST',
          headers: { 'Content-Type': mime },
          body: blob,
        });
        const { storageId } = await response.json();
        await sendMessage({
          token,
          conversationId: conversationId as any,
          kind,
          storageId,
          fileName: asset.fileName ?? asset.name ?? 'file',
          mimeType: mime,
          size: asset.fileSize ?? asset.size ?? undefined,
        });
      } catch (error) {
        Alert.alert(
          'Upload failed',
          convexErrorMessage(error, 'Could not upload the file.'),
        );
      } finally {
        setSending(false);
      }
    },
    [token, generateUploadUrl, sendMessage, conversationId],
  );

  const pickPhoto = useCallback(async () => {
    setAttachOpen(false);
    const result = await launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: 1,
    });
    const asset = result.assets?.[0];
    if (!asset?.uri) {
      return;
    }
    await uploadAsset(asset, 'image');
  }, [uploadAsset]);

  const pickVideo = useCallback(async () => {
    setAttachOpen(false);
    const result = await launchImageLibrary({
      mediaType: 'video',
      selectionLimit: 1,
    });
    const asset = result.assets?.[0];
    if (!asset?.uri) {
      return;
    }
    await uploadAsset(asset, 'video');
  }, [uploadAsset]);

  const pickDocument = useCallback(async () => {
    setAttachOpen(false);
    try {
      const [file] = await pick({ type: [docTypes.allFiles] });
      if (!file?.uri) {
        return;
      }
      let uri = file.uri;
      try {
        const copies = await keepLocalCopy({
          files: [{ uri: file.uri, fileName: file.name ?? 'file' }],
          destination: 'cachesDirectory',
        });
        const first = copies[0];
        if (first && 'localUri' in first && first.localUri) {
          uri = first.localUri;
        }
      } catch {}
      const mime = file.type ?? 'application/octet-stream';
      const kind: Message['kind'] = mime.startsWith('image/')
        ? 'image'
        : mime.startsWith('video/')
          ? 'video'
          : mime.startsWith('audio/')
            ? 'audio'
            : 'file';
      await uploadAsset(
        { uri, name: file.name, type: mime, size: file.size },
        kind,
      );
    } catch (error) {
      if (
        isErrorWithCode(error) &&
        error.code === errorCodes.OPERATION_CANCELED
      ) {
        return;
      }
      Alert.alert(
        'Could not pick file',
        convexErrorMessage(error, 'Please try again.'),
      );
    }
  }, [uploadAsset]);

  const applyReaction = useCallback(
    async (message: Message, emoji: string) => {
      setActionTarget(null);
      if (!token) {
        return;
      }
      try {
        await toggleReaction({
          token,
          messageId: message._id as any,
          emoji,
        });
      } catch (error) {
        Alert.alert('Reaction failed', convexErrorMessage(error, 'Try again.'));
      }
    },
    [token, toggleReaction],
  );

  const copyMessage = useCallback((message: Message) => {
    if (message.body) {
      Clipboard.setString(message.body);
    }
  }, []);

  const forwardMessageAction = useCallback(
    (message: Message) => {
      setActionTarget(null);
      navigation.navigate('ForwardMessage', { message });
    },
    [navigation],
  );

  const deleteMessage = useCallback(
    (message: Message) => {
      setActionTarget(null);
      if (!token) {
        return;
      }
      Alert.alert('Delete message?', 'This will delete the message for everyone.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            removeMessage({ token, messageId: message._id as any }).catch(
              error => {
                Alert.alert(
                  'Could not delete',
                  convexErrorMessage(error, 'Try again.'),
                );
              },
            );
          },
        },
      ]);
    },
    [token, removeMessage],
  );

  const scrollToMessage = useCallback(
    (messageId: string) => {
      const index = messages.findIndex(m => m._id === messageId);
      if (index >= 0) {
        listRef.current?.scrollToIndex({
          index,
          viewPosition: 0.5,
          animated: true,
        });
        setHighlightId(messageId);
        setTimeout(() => setHighlightId(null), 1200);
      }
    },
    [messages],
  );

  const openInfo = useCallback(() => {
    if (!conversation) {
      return;
    }
    navigation.navigate(
      conversation.type === 'group' ? 'ChatInfo' : 'ContactInfo',
      { conversationId, title: conversation.title },
    );
  }, [conversation, navigation, conversationId]);

  const handleStartCall = useCallback(
    async (kind: 'audio' | 'video') => {
      if (!token || !otherMember) {
        return;
      }
      try {
        const callId = await startCall({
          token,
          calleeId: otherMember._id as any,
          type: kind,
        });
        navigation.navigate('CallScreen', {
          callId,
          type: kind,
          role: 'caller',
          peerName: otherMember.displayName,
        });
      } catch (error) {
        Alert.alert(
          'Call failed',
          convexErrorMessage(error, 'Could not start the call.'),
        );
      }
    },
    [token, otherMember, startCall, navigation],
  );

  const openFile = useCallback((message: Message) => {
    if (message.fileUrl) {
      Linking.openURL(message.fileUrl).catch(() => {});
    }
  }, []);

  const renderMessage = useCallback(
    ({ item, index }: { item: Message; index: number }) => {
      const mine = item.senderId === user?._id;
      const isGroup = conversation?.type === 'group';
      const older = messages[index + 1];
      const showDay =
        !older || !dayjs(older.createdAt).isSame(item.createdAt, 'day');
      const deleted = !!item.deletedAt;
      const isHighlighted = highlightId === item._id;

      return (
        <View>
          {showDay && (
            <View style={styles.daySeparatorWrap}>
              <Text
                style={[
                  theme.typography.caption1.medium,
                  styles.daySeparator,
                  {
                    color: theme.color.textSecondary,
                    backgroundColor: theme.color.background3,
                  },
                ]}
              >
                {formatDayLabel(item.createdAt)}
              </Text>
            </View>
          )}
          <View
            style={[
              styles.messageRow,
              mine ? styles.messageRowMine : styles.messageRowTheirs,
            ]}
          >
            <Pressable
              onLongPress={() => !deleted && setActionTarget(item)}
              delayLongPress={280}
              style={[
                styles.bubble,
                mine
                  ? { backgroundColor: theme.color.primary }
                  : { backgroundColor: theme.color.background3 },
                isHighlighted && {
                  borderWidth: 2,
                  borderColor: theme.color.extendedPrimary50,
                },
              ]}
            >
              {!mine && isGroup && !deleted && (
                <Text
                  style={[
                    theme.typography.caption1.medium,
                    styles.senderName,
                    { color: theme.color.primary },
                  ]}
                >
                  {item.sender.displayName}
                </Text>
              )}
              {!!item.forwardedFrom && !deleted && (
                <View style={styles.forwardedRow}>
                  <MaterialDesignIcons
                    name="share"
                    size={12}
                    color={mine ? '#E9E4FF' : theme.color.textTertiary}
                  />
                  <Text
                    style={[
                      theme.typography.caption2?.regular ??
                        theme.typography.caption1.regular,
                      styles.forwardedText,
                      { color: mine ? '#E9E4FF' : theme.color.textTertiary },
                    ]}
                  >
                    Forwarded from {item.forwardedFrom}
                  </Text>
                </View>
              )}
              {deleted ? (
                <View style={styles.deletedRow}>
                  <MaterialDesignIcons
                    name="cancel"
                    size={14}
                    color={mine ? '#E9E4FF' : theme.color.textTertiary}
                  />
                  <Text
                    style={[
                      theme.typography.body.regular,
                      styles.deletedText,
                      { color: mine ? '#E9E4FF' : theme.color.textSecondary },
                    ]}
                  >
                    {mine ? 'You deleted this message' : 'This message was deleted'}
                  </Text>
                </View>
              ) : (
                <>
                  {item.replyTo && (
                    <Pressable
                      onPress={() => scrollToMessage(item.replyTo!._id)}
                      style={[
                        styles.quoteBlock,
                        {
                          borderLeftColor: mine ? '#fff' : theme.color.primary,
                          backgroundColor: mine
                            ? 'rgba(255,255,255,0.14)'
                            : theme.color.background1,
                        },
                      ]}
                    >
                      <Text
                        numberOfLines={1}
                        style={[
                          theme.typography.caption1.medium,
                          { color: mine ? '#fff' : theme.color.primary },
                        ]}
                      >
                        {item.replyTo.senderName}
                      </Text>
                      <Text
                        numberOfLines={2}
                        style={[
                          theme.typography.caption1.regular,
                          { color: mine ? '#EDE9FE' : theme.color.textSecondary },
                        ]}
                      >
                        {item.replyTo.deletedAt
                          ? 'Deleted message'
                          : item.replyTo.body ??
                            attachmentLabel(item.replyTo.kind)}
                      </Text>
                    </Pressable>
                  )}
                  {item.kind === 'image' && item.fileUrl ? (
                    <Pressable onPress={() => openFile(item)}>
                      <Image
                        source={{ uri: item.fileUrl }}
                        style={styles.imageAttachment}
                        resizeMode="cover"
                      />
                    </Pressable>
                  ) : item.kind !== 'text' ? (
                    <Pressable onPress={() => openFile(item)} style={styles.fileRow}>
                      <MaterialDesignIcons
                        name={
                          item.kind === 'video'
                            ? 'file-video-outline'
                            : item.kind === 'audio'
                              ? 'music-note-outline'
                              : 'file-document-outline'
                        }
                        size={26}
                        color={mine ? '#fff' : theme.color.primary}
                        style={styles.fileIcon}
                      />
                      <View style={styles.fileMeta}>
                        <Text
                          numberOfLines={1}
                          style={[
                            theme.typography.body.medium,
                            { color: mine ? '#fff' : theme.color.textPrimary },
                          ]}
                        >
                          {item.fileName ?? 'Attachment'}
                        </Text>
                        {!!formatBytes(item.size) && (
                          <Text
                            style={[
                              theme.typography.caption1.regular,
                              {
                                color: mine
                                  ? '#DDD6FE'
                                  : theme.color.textSecondary,
                              },
                            ]}
                          >
                            {formatBytes(item.size)}
                          </Text>
                        )}
                      </View>
                    </Pressable>
                  ) : null}
                  {!!item.body && (
                    <Text
                      style={[
                        theme.typography.body.regular,
                        styles.bubbleText,
                        { color: mine ? '#fff' : theme.color.textPrimary },
                      ]}
                    >
                      {item.body}
                    </Text>
                  )}
                </>
              )}
              <Text
                style={[
                  theme.typography.caption2?.regular ??
                    theme.typography.caption1.regular,
                  styles.bubbleTime,
                  { color: mine ? '#E9E4FF' : theme.color.textTertiary },
                ]}
              >
                {dayjs(item.createdAt).format('h:mm A')}
              </Text>
            </Pressable>

            {item.reactions.length > 0 && !deleted && (
              <View style={[styles.reactionRow, mine && styles.reactionRowMine]}>
                {item.reactions.map(reaction => (
                  <TouchableOpacity
                    key={reaction.emoji}
                    style={[
                      styles.reactionChip,
                      {
                        backgroundColor: reaction.mine
                          ? theme.color.extendedPrimary50
                          : theme.color.background3,
                        borderColor: reaction.mine
                          ? theme.color.primary
                          : 'transparent',
                      },
                    ]}
                    onPress={() => applyReaction(item, reaction.emoji)}
                  >
                    <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
                    {reaction.count > 1 && (
                      <Text
                        style={[
                          theme.typography.caption1.regular,
                          { color: theme.color.textSecondary },
                        ]}
                      >
                        {reaction.count}
                      </Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        </View>
      );
    },
    [
      user?._id,
      conversation?.type,
      theme,
      applyReaction,
      openFile,
      messages,
      highlightId,
      scrollToMessage,
    ],
  );

  const isSubscribed = thread !== undefined;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.color.background1 }]}
      edges={['top']}
    >
      <View
        style={[
          styles.header,
          { borderBottomColor: theme.color.borderDefault },
        ]}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Text style={[styles.backIcon, { color: theme.color.textPrimary }]}>
            ‹
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.headerBody} onPress={openInfo}>
          <Text
            numberOfLines={1}
            style={[
              theme.typography.heading3.bold,
              { color: theme.color.textPrimary },
            ]}
          >
            {conversation?.title ?? fallbackTitle}
          </Text>
          {typingNames && typingNames.length > 0 ? (
            <Text
              numberOfLines={1}
              style={[
                theme.typography.caption1.regular,
                { color: theme.color.primary },
              ]}
            >
              {typingNames.length === 1
                ? `${typingNames[0]} is typing…`
                : `${typingNames.length} people are typing…`}
            </Text>
          ) : conversation?.type === 'group' ? (
            <Text
              style={[
                theme.typography.caption1.regular,
                { color: theme.color.textSecondary },
              ]}
            >
              {conversation.members.length}{' '}
              {conversation.members.length === 1 ? 'member' : 'members'}
            </Text>
          ) : null}
        </TouchableOpacity>
        {conversation?.type === 'dm' && otherMember && (
          <>
            <TouchableOpacity
              style={styles.headerAction}
              onPress={() => handleStartCall('audio')}
            >
              <MaterialDesignIcons
                name="phone-outline"
                size={22}
                color={theme.color.textPrimary}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerAction}
              onPress={() => handleStartCall('video')}
            >
              <MaterialDesignIcons
                name="video-outline"
                size={22}
                color={theme.color.textPrimary}
              />
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity style={styles.headerAction} onPress={openInfo}>
          <MaterialDesignIcons
            name="information-outline"
            size={22}
            color={theme.color.textPrimary}
          />
        </TouchableOpacity>
      </View>

      {!isSubscribed ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.color.primary} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          inverted
          keyExtractor={item => item._id}
          renderItem={renderMessage}
          contentContainerStyle={styles.listContent}
          onScrollToIndexFailed={info => {
            setTimeout(() => {
              listRef.current?.scrollToIndex({
                index: info.index,
                viewPosition: 0.5,
                animated: true,
              });
            }, 250);
          }}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text
                style={[
                  theme.typography.body.medium,
                  { color: theme.color.textSecondary },
                ]}
              >
                No messages yet. Say hi 👋
              </Text>
            </View>
          }
        />
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {replyTarget && (
          <View
            style={[
              styles.replyBar,
              {
                backgroundColor: theme.color.background2,
                borderTopColor: theme.color.borderDefault,
              },
            ]}
          >
            <View
              style={[styles.replyBarAccent, { backgroundColor: theme.color.primary }]}
            />
            <View style={styles.replyBarBody}>
              <Text
                numberOfLines={1}
                style={[
                  theme.typography.caption1.medium,
                  { color: theme.color.primary },
                ]}
              >
                {replyTarget.senderId === user?._id
                  ? 'You'
                  : replyTarget.sender.displayName}
              </Text>
              <Text
                numberOfLines={1}
                style={[
                  theme.typography.caption1.regular,
                  { color: theme.color.textSecondary },
                ]}
              >
                {replyTarget.body ?? attachmentLabel(replyTarget.kind)}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setReplyTarget(null)}
              style={styles.replyBarClose}
            >
              <MaterialDesignIcons
                name="close"
                size={18}
                color={theme.color.textSecondary}
              />
            </TouchableOpacity>
          </View>
        )}
        <View
          style={[
            styles.composer,
            {
              backgroundColor: theme.color.background2,
              borderTopColor: theme.color.borderDefault,
            },
          ]}
        >
          <TouchableOpacity
            style={styles.attachButton}
            onPress={() => setAttachOpen(true)}
            disabled={sending}
          >
            <MaterialDesignIcons
              name="plus-circle-outline"
              size={26}
              color={theme.color.primary}
            />
          </TouchableOpacity>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: theme.color.background1,
                color: theme.color.textPrimary,
                borderColor: theme.color.borderLight,
              },
            ]}
            value={text}
            onChangeText={onTextChange}
            placeholder="Type your message..."
            placeholderTextColor={theme.color.textTertiary}
            multiline
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              { backgroundColor: theme.color.primary },
              (!text.trim() || sending) && styles.sendButtonDisabled,
            ]}
            onPress={onSend}
            disabled={!text.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <MaterialDesignIcons name="send" size={18} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={attachOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAttachOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setAttachOpen(false)}>
          <View
            style={[
              styles.attachSheet,
              { backgroundColor: theme.color.background1 },
            ]}
          >
            <TouchableOpacity style={styles.attachOption} onPress={pickPhoto}>
              <MaterialDesignIcons
                name="image-outline"
                size={22}
                color={theme.color.textPrimary}
                style={styles.attachOptionIcon}
              />
              <Text
                style={[
                  theme.typography.body.medium,
                  { color: theme.color.textPrimary },
                ]}
              >
                Photo
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.attachOption} onPress={pickVideo}>
              <MaterialDesignIcons
                name="video-outline"
                size={22}
                color={theme.color.textPrimary}
                style={styles.attachOptionIcon}
              />
              <Text
                style={[
                  theme.typography.body.medium,
                  { color: theme.color.textPrimary },
                ]}
              >
                Video
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.attachOption} onPress={pickDocument}>
              <MaterialDesignIcons
                name="file-document-outline"
                size={22}
                color={theme.color.textPrimary}
                style={styles.attachOptionIcon}
              />
              <Text
                style={[
                  theme.typography.body.medium,
                  { color: theme.color.textPrimary },
                ]}
              >
                Document
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={!!actionTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setActionTarget(null)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setActionTarget(null)}
        >
          <View
            style={[
              styles.attachSheet,
              { backgroundColor: theme.color.background1 },
            ]}
          >
            <View style={styles.actionEmojiRow}>
              {REACTION_EMOJIS.map(emoji => (
                <TouchableOpacity
                  key={emoji}
                  style={styles.reactionPickerItem}
                  onPress={() =>
                    actionTarget && applyReaction(actionTarget, emoji)
                  }
                >
                  <Text style={styles.reactionPickerEmoji}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View
              style={[
                styles.sheetDivider,
                { backgroundColor: theme.color.borderDefault },
              ]}
            />
            <TouchableOpacity
              style={styles.attachOption}
              onPress={() => {
                if (actionTarget) {
                  setReplyTarget(actionTarget);
                }
                setActionTarget(null);
              }}
            >
              <MaterialDesignIcons
                name="reply"
                size={22}
                color={theme.color.textPrimary}
                style={styles.attachOptionIcon}
              />
              <Text
                style={[
                  theme.typography.body.medium,
                  { color: theme.color.textPrimary },
                ]}
              >
                Reply
              </Text>
            </TouchableOpacity>
            {actionTarget?.kind === 'text' && (
              <TouchableOpacity
                style={styles.attachOption}
                onPress={() => {
                  if (actionTarget) {
                    copyMessage(actionTarget);
                  }
                  setActionTarget(null);
                }}
              >
                <MaterialDesignIcons
                  name="content-copy"
                  size={22}
                  color={theme.color.textPrimary}
                  style={styles.attachOptionIcon}
                />
                <Text
                  style={[
                    theme.typography.body.medium,
                    { color: theme.color.textPrimary },
                  ]}
                >
                  Copy
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.attachOption}
              onPress={() => actionTarget && forwardMessageAction(actionTarget)}
            >
              <MaterialDesignIcons
                name="share-variant"
                size={22}
                color={theme.color.textPrimary}
                style={styles.attachOptionIcon}
              />
              <Text
                style={[
                  theme.typography.body.medium,
                  { color: theme.color.textPrimary },
                ]}
              >
                Forward
              </Text>
            </TouchableOpacity>
            {actionTarget?.senderId === user?._id && (
              <TouchableOpacity
                style={styles.attachOption}
                onPress={() => actionTarget && deleteMessage(actionTarget)}
              >
                <MaterialDesignIcons
                  name="delete-outline"
                  size={22}
                  color="#E5484D"
                  style={styles.attachOptionIcon}
                />
                <Text
                  style={[
                    theme.typography.body.medium,
                    { color: '#E5484D' },
                  ]}
                >
                  Delete
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.attachOption}
              onPress={() => {
                if (actionTarget) {
                  Alert.alert(
                    'Message info',
                    `${actionTarget.sender.displayName}\n${dayjs(
                      actionTarget.createdAt,
                    ).format('MMMM D, YYYY h:mm A')}`,
                  );
                }
                setActionTarget(null);
              }}
            >
              <MaterialDesignIcons
                name="information-outline"
                size={22}
                color={theme.color.textPrimary}
                style={styles.attachOptionIcon}
              />
              <Text
                style={[
                  theme.typography.body.medium,
                  { color: theme.color.textPrimary },
                ]}
              >
                Info
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
};

export default ChatScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  backIcon: {
    fontSize: 34,
    lineHeight: 34,
  },
  headerBody: {
    flex: 1,
    marginLeft: 4,
  },
  headerAction: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  emptyWrap: {
    transform: [{ scaleY: -1 }],
    alignItems: 'center',
    paddingVertical: 40,
  },
  daySeparatorWrap: {
    alignItems: 'center',
    marginVertical: 8,
  },
  daySeparator: {
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  messageRow: {
    marginVertical: 4,
    maxWidth: '82%',
  },
  messageRowMine: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  messageRowTheirs: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  bubble: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  senderName: {
    marginBottom: 2,
  },
  forwardedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  forwardedText: {
    marginLeft: 4,
    fontStyle: 'italic',
  },
  deletedRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  deletedText: {
    marginLeft: 6,
    fontStyle: 'italic',
  },
  quoteBlock: {
    borderLeftWidth: 3,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 6,
  },
  bubbleText: {
    marginTop: 2,
  },
  bubbleTime: {
    marginTop: 4,
    alignSelf: 'flex-end',
    fontSize: 10,
  },
  imageAttachment: {
    width: 220,
    height: 220,
    borderRadius: 10,
    marginBottom: 4,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: 240,
  },
  fileIcon: {
    marginRight: 8,
  },
  fileMeta: {
    flex: 1,
  },
  reactionRow: {
    flexDirection: 'row',
    marginTop: 4,
    flexWrap: 'wrap',
  },
  reactionRowMine: {
    justifyContent: 'flex-end',
  },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginRight: 4,
    marginBottom: 2,
  },
  reactionEmoji: {
    fontSize: 13,
  },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  replyBarAccent: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: 2,
    marginRight: 8,
  },
  replyBarBody: {
    flex: 1,
  },
  replyBarClose: {
    padding: 6,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  attachButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxHeight: 120,
    marginHorizontal: 4,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  attachSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingVertical: 12,
    paddingBottom: 28,
  },
  attachOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  attachOptionIcon: {
    marginRight: 14,
  },
  actionEmojiRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  sheetDivider: {
    height: StyleSheet.hairlineWidth,
    marginBottom: 4,
  },
  reactionPickerItem: {
    padding: 6,
  },
  reactionPickerEmoji: {
    fontSize: 26,
  },
});
