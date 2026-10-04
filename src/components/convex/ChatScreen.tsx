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
  Animated,
  Dimensions,
  NativeModules,
  Image,
  Modal,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Video from 'react-native-video';
import { useTheme } from '@cometchat/chat-uikit-react-native';
import { useTheme as usePaperTheme } from 'react-native-paper';
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

type Receipt = {
  userId: string;
  lastReadAt: number;
  lastSeenAt: number;
};

type PendingAttachment = {
  id: string;
  uri: string;
  name: string;
  mimeType: string;
  size: number | null;
  kind: Message['kind'];
};

let pendingSequence = 0;

const nextPendingId = (): string => {
  pendingSequence += 1;
  return `pending-${Date.now()}-${pendingSequence}`;
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

const pendingIconName = (
  kind: Message['kind'],
): React.ComponentProps<typeof MaterialDesignIcons>['name'] => {
  switch (kind) {
    case 'image':
      return 'file-image';
    case 'video':
      return 'file-video';
    case 'audio':
      return 'music-note';
    default:
      return 'file-document';
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

type MenuActionProps = {
  icon: React.ComponentProps<typeof MaterialDesignIcons>['name'];
  label: string;
  color?: string;
  onPress: () => void;
};

const MenuAction = ({ icon, label, color, onPress }: MenuActionProps) => {
  const paper = usePaperTheme();
  return (
    <TouchableOpacity
      style={styles.menuAction}
      activeOpacity={0.7}
      onPress={onPress}
    >
      <MaterialDesignIcons
        name={icon}
        size={20}
        color={color ?? paper.colors.onSurfaceVariant}
      />
      <Text
        style={[styles.menuActionLabel, { color: color ?? paper.colors.onSurface }]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
};

type ReactionPickerButtonProps = {
  emoji: string;
  onPress: () => void;
};

const ReactionPickerButton = ({
  emoji,
  onPress,
}: ReactionPickerButtonProps) => {
  const paper = usePaperTheme();
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity
        style={[
          styles.reactionPickerItem,
          { backgroundColor: paper.colors.surfaceVariant },
        ]}
        activeOpacity={0.75}
        onPressIn={() => {
          Animated.spring(scale, {
            toValue: 1.22,
            stiffness: 420,
            damping: 16,
            mass: 0.6,
            useNativeDriver: true,
          }).start();
        }}
        onPressOut={() => {
          Animated.spring(scale, {
            toValue: 1,
            stiffness: 360,
            damping: 20,
            mass: 0.7,
            useNativeDriver: true,
          }).start();
        }}
        onPress={onPress}
      >
        <Text style={styles.reactionPickerEmoji}>{emoji}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

const ChatScreen = ({ route, navigation }: any) => {
  const theme = useTheme();
  const paperTheme = usePaperTheme();
  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
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
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [actionPanel, setActionPanel] = useState<'delete' | 'info' | null>(
    null,
  );
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [viewer, setViewer] = useState<{ message: Message } | null>(null);
  const menuScale = useRef(new Animated.Value(0.8)).current;
  const menuOpacity = useRef(new Animated.Value(0)).current;
  const listRef = useRef<FlatList<Message>>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const messages = useMemo(
    () => [...(thread?.messages ?? [])].reverse(),
    [thread],
  );

  const receipts = useMemo<Receipt[]>(
    () => ((thread as any)?.receipts ?? []) as Receipt[],
    [thread],
  );

  const tickFor = useCallback(
    (message: Message): 'sent' | 'delivered' | 'read' => {
      if (receipts.length === 0) {
        return 'sent';
      }
      if (receipts.every(receipt => receipt.lastReadAt >= message.createdAt)) {
        return 'read';
      }
      if (receipts.every(receipt => receipt.lastSeenAt >= message.createdAt)) {
        return 'delivered';
      }
      return 'sent';
    },
    [receipts],
  );

  useEffect(() => {
    if (token && conversationId) {
      markRead({ token, conversationId: conversationId as any }).catch(
        () => {},
      );
      try {
        NativeModules.Installer?.cancelNotifications?.(conversationId);
      } catch {}
    }
  }, [token, conversationId, messages.length, markRead]);

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!actionTarget) {
      return;
    }
    menuScale.setValue(0.8);
    menuOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(menuOpacity, {
        toValue: 1,
        duration: 140,
        useNativeDriver: true,
      }),
      Animated.spring(menuScale, {
        toValue: 1,
        stiffness: 380,
        damping: 26,
        mass: 0.9,
        useNativeDriver: true,
      }),
    ]).start();
  }, [actionTarget, actionPanel, menuScale, menuOpacity]);

  const closeActionMenu = useCallback(() => {
    Animated.parallel([
      Animated.timing(menuOpacity, {
        toValue: 0,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.timing(menuScale, {
        toValue: 0.92,
        duration: 120,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setActionTarget(null);
      setMenuAnchor(null);
      setActionPanel(null);
    });
  }, [menuOpacity, menuScale]);

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

  const removePending = useCallback((id: string) => {
    setPending(prev => prev.filter(item => item.id !== id));
  }, []);

  const uploadAsset = useCallback(
    async (attachment: PendingAttachment): Promise<boolean> => {
      if (!token) {
        return false;
      }
      try {
        const postUrl = await generateUploadUrl({ token });
        const blob = await uriToBlob(attachment.uri);
        const mime = attachment.mimeType || 'application/octet-stream';
        const response = await fetch(postUrl, {
          method: 'POST',
          headers: { 'Content-Type': mime },
          body: blob,
        });
        const { storageId } = await response.json();
        await sendMessage({
          token,
          conversationId: conversationId as any,
          kind: attachment.kind,
          storageId,
          fileName: attachment.name || 'file',
          mimeType: mime,
          size: attachment.size ?? undefined,
        });
        return true;
      } catch (error) {
        Alert.alert(
          'Upload failed',
          convexErrorMessage(error, 'Could not upload the file.'),
        );
        return false;
      }
    },
    [token, generateUploadUrl, sendMessage, conversationId],
  );

  const onSend = useCallback(async () => {
    const body = text.trim();
    const queue = pending;
    if ((!body && queue.length === 0) || !token || sending) {
      return;
    }
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
    }
    setSending(true);
    try {
      if (body) {
        const replyToId = replyTarget?._id;
        setText('');
        setReplyTarget(null);
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
          return;
        }
      }
      for (const attachment of queue) {
        const uploaded = await uploadAsset(attachment);
        if (uploaded) {
          setPending(prev => prev.filter(item => item.id !== attachment.id));
        }
      }
    } finally {
      setSending(false);
    }
  }, [
    text,
    pending,
    token,
    sending,
    sendMessage,
    conversationId,
    replyTarget,
    uploadAsset,
  ]);

  const pickPhoto = useCallback(async () => {
    setAttachOpen(false);
    const result = await launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: 0,
    });
    const additions: PendingAttachment[] = (result.assets ?? [])
      .filter(asset => !!asset.uri)
      .map(asset => ({
        id: nextPendingId(),
        uri: asset.uri as string,
        name: asset.fileName ?? `photo-${Date.now()}.jpg`,
        mimeType: asset.type ?? 'image/jpeg',
        size: asset.fileSize ?? null,
        kind: 'image' as Message['kind'],
      }));
    if (additions.length > 0) {
      setPending(prev => [...prev, ...additions]);
    }
  }, []);

  const pickVideo = useCallback(async () => {
    setAttachOpen(false);
    const result = await launchImageLibrary({
      mediaType: 'video',
      selectionLimit: 0,
    });
    const additions: PendingAttachment[] = (result.assets ?? [])
      .filter(asset => !!asset.uri)
      .map(asset => ({
        id: nextPendingId(),
        uri: asset.uri as string,
        name: asset.fileName ?? `video-${Date.now()}.mp4`,
        mimeType: asset.type ?? 'video/mp4',
        size: asset.fileSize ?? null,
        kind: 'video' as Message['kind'],
      }));
    if (additions.length > 0) {
      setPending(prev => [...prev, ...additions]);
    }
  }, []);

  const pickDocument = useCallback(async () => {
    setAttachOpen(false);
    try {
      const files = await pick({
        type: [docTypes.allFiles],
        allowMultiSelection: true,
      });
      if (files.length === 0) {
        return;
      }
      const additions: PendingAttachment[] = [];
      for (const file of files) {
        if (!file.uri) {
          continue;
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
        additions.push({
          id: nextPendingId(),
          uri,
          name: file.name ?? 'file',
          mimeType: mime,
          size: file.size ?? null,
          kind,
        });
      }
      if (additions.length > 0) {
        setPending(prev => [...prev, ...additions]);
      }
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
  }, []);

  const applyReaction = useCallback(
    async (message: Message, emoji: string) => {
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

  const reactFromMenu = useCallback(
    (emoji: string) => {
      if (!actionTarget) {
        return;
      }
      const target = actionTarget;
      closeActionMenu();
      applyReaction(target, emoji);
    },
    [actionTarget, closeActionMenu, applyReaction],
  );

  const replyFromMenu = useCallback(() => {
    if (!actionTarget) {
      return;
    }
    setReplyTarget(actionTarget);
    closeActionMenu();
  }, [actionTarget, closeActionMenu]);

  const copyFromMenu = useCallback(() => {
    if (!actionTarget) {
      return;
    }
    copyMessage(actionTarget);
    closeActionMenu();
  }, [actionTarget, copyMessage, closeActionMenu]);

  const forwardMessageAction = useCallback(
    (message: Message) => {
      closeActionMenu();
      navigation.navigate('ForwardMessage', { message });
    },
    [navigation, closeActionMenu],
  );

  const showMessageInfo = useCallback(() => {
    if (!actionTarget) {
      return;
    }
    setActionPanel('info');
  }, [actionTarget]);

  const requestDelete = useCallback(() => {
    if (!actionTarget || actionTarget.senderId !== user?._id) {
      return;
    }
    setActionPanel('delete');
  }, [actionTarget, user?._id]);

  const cancelPanel = useCallback(() => {
    setActionPanel(null);
  }, []);

  const confirmDeleteMessage = useCallback(() => {
    if (!actionTarget || !token) {
      return;
    }
    const messageId = actionTarget._id;
    closeActionMenu();
    removeMessage({ token, messageId: messageId as any }).catch(error => {
      Alert.alert('Could not delete', convexErrorMessage(error, 'Try again.'));
    });
  }, [actionTarget, token, removeMessage, closeActionMenu]);

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

  const openViewer = useCallback((message: Message) => {
    setViewer({ message });
  }, []);

  const forwardFromViewer = useCallback(() => {
    if (!viewer) {
      return;
    }
    const message = viewer.message;
    setViewer(null);
    navigation.navigate('ForwardMessage', { message });
  }, [viewer, navigation]);

  const renderMessage = useCallback(
    ({ item, index }: { item: Message; index: number }) => {
      const mine = item.senderId === user?._id;
      const isGroup = conversation?.type === 'group';
      const older = messages[index + 1];
      const showDay =
        !older || !dayjs(older.createdAt).isSame(item.createdAt, 'day');
      const deleted = !!item.deletedAt;
      const isHighlighted = highlightId === item._id;
      const tick = mine && !deleted ? tickFor(item) : null;
      const timeColor = mine ? '#E9E4FF' : theme.color.textTertiary;

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
              onLongPress={e => {
                if (deleted) {
                  return;
                }
                const { pageX, pageY } = e.nativeEvent;
                setMenuAnchor({ x: pageX, y: pageY });
                setActionTarget(item);
              }}
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
                    <Pressable onPress={() => openViewer(item)}>
                      <Image
                        source={{ uri: item.fileUrl }}
                        style={styles.imageAttachment}
                        resizeMode="cover"
                      />
                    </Pressable>
                  ) : item.kind === 'video' && item.fileUrl ? (
                    <Pressable
                      onPress={() => openViewer(item)}
                      style={styles.videoCard}
                    >
                      <Video
                        source={{ uri: item.fileUrl }}
                        style={styles.videoPreview}
                        paused
                        muted
                        resizeMode="cover"
                      />
                      <View style={styles.videoPlayOverlay} pointerEvents="none">
                        <MaterialDesignIcons
                          name="play-circle"
                          size={54}
                          color="#FFFFFF"
                          style={styles.videoPlayIcon}
                        />
                      </View>
                      {!!item.fileName && (
                        <View style={styles.videoNamePill} pointerEvents="none">
                          <Text numberOfLines={1} style={styles.videoNameText}>
                            {item.fileName}
                          </Text>
                        </View>
                      )}
                    </Pressable>
                  ) : item.kind !== 'text' ? (
                    <Pressable onPress={() => openViewer(item)} style={styles.fileRow}>
                      <MaterialDesignIcons
                        name={
                          item.kind === 'audio'
                            ? 'play-circle'
                            : item.kind === 'video'
                              ? 'file-video-outline'
                              : 'file-document-outline'
                        }
                        size={item.kind === 'audio' ? 28 : 26}
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
              <View style={styles.bubbleTimeRow}>
                <Text
                  style={[
                    theme.typography.caption2?.regular ??
                      theme.typography.caption1.regular,
                    styles.bubbleTime,
                    { color: timeColor },
                  ]}
                >
                  {dayjs(item.createdAt).format('h:mm A')}
                </Text>
                {tick && (
                  <MaterialDesignIcons
                    name={tick === 'sent' ? 'check' : 'check-all'}
                    size={14}
                    color={tick === 'read' ? '#53BDEB' : timeColor}
                    style={styles.bubbleTick}
                  />
                )}
              </View>
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
      openViewer,
      messages,
      highlightId,
      scrollToMessage,
      tickFor,
    ],
  );

  const isSubscribed = thread !== undefined;
  const canSend = (!!text.trim() || pending.length > 0) && !sending;
  const viewerWidth = windowWidth - 32;
  const viewerHeight = windowHeight - 160;
  const actionCount = actionTarget
    ? 3 +
      (actionTarget.kind === 'text' ? 1 : 0) +
      (actionTarget.senderId === user?._id ? 1 : 0)
    : 0;
  const estimatedMenuHeight = 56 + actionCount * 56;
  const menuLeft = menuAnchor
    ? Math.min(Math.max(menuAnchor.x - 12, 12), screenWidth - 242)
    : 12;
  const menuTop = menuAnchor
    ? Math.max(
        12,
        Math.min(
          menuAnchor.y > screenHeight * 0.55
            ? menuAnchor.y - estimatedMenuHeight - 8
            : menuAnchor.y + 8,
          screenHeight - estimatedMenuHeight - 12,
        ),
      )
    : 12;
  const confirmWidth = Math.min(300, screenWidth - 48);
  const confirmLeft = (screenWidth - confirmWidth) / 2;
  const confirmTop = menuAnchor
    ? Math.max(48, Math.min(menuAnchor.y - 110, screenHeight - 280))
    : screenHeight / 2 - 110;

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
          keyboardShouldPersistTaps="handled"
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
                No messages yet
              </Text>
            </View>
          }
        />
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {pending.length > 0 && (
          <View
            style={[
              styles.pendingBar,
              {
                backgroundColor: theme.color.background2,
                borderTopColor: theme.color.borderDefault,
              },
            ]}
          >
            <FlatList
              horizontal
              data={pending}
              keyExtractor={item => item.id}
              showsHorizontalScrollIndicator={false}
              style={styles.pendingList}
              renderItem={({ item }) => (
                <View
                  style={[
                    styles.pendingChip,
                    { backgroundColor: paperTheme.colors.surfaceVariant },
                  ]}
                >
                  {item.kind === 'image' ? (
                    <Image
                      source={{ uri: item.uri }}
                      style={styles.pendingThumb}
                    />
                  ) : (
                    <MaterialDesignIcons
                      name={pendingIconName(item.kind)}
                      size={20}
                      color={paperTheme.colors.onSurfaceVariant}
                      style={styles.pendingIcon}
                    />
                  )}
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.pendingName,
                      { color: paperTheme.colors.onSurfaceVariant },
                    ]}
                  >
                    {item.name}
                  </Text>
                  <TouchableOpacity
                    onPress={() => removePending(item.id)}
                    style={styles.pendingRemove}
                  >
                    <MaterialDesignIcons
                      name="close"
                      size={14}
                      color={paperTheme.colors.onSurfaceVariant}
                    />
                  </TouchableOpacity>
                </View>
              )}
            />
          </View>
        )}
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
              !canSend && styles.sendButtonDisabled,
            ]}
            onPress={onSend}
            disabled={!canSend}
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
        visible={viewer !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setViewer(null)}
      >
        <View style={styles.viewerBackdrop}>
          {viewer && (
            <>
              <View
                style={[
                  styles.viewerTopBar,
                  {
                    top: insets.top + 8,
                    backgroundColor: paperTheme.colors.elevation.level3,
                  },
                ]}
              >
                <TouchableOpacity
                  style={styles.viewerTopButton}
                  onPress={() => setViewer(null)}
                >
                  <MaterialDesignIcons
                    name="close"
                    size={24}
                    color={paperTheme.colors.onSurface}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.viewerTopButton}
                  onPress={forwardFromViewer}
                >
                  <MaterialDesignIcons
                    name="share-variant"
                    size={22}
                    color={paperTheme.colors.onSurface}
                  />
                </TouchableOpacity>
              </View>
              {viewer.message.kind === 'image' && viewer.message.fileUrl ? (
                <Image
                  source={{ uri: viewer.message.fileUrl }}
                  style={[
                    styles.viewerImage,
                    { width: viewerWidth, height: viewerHeight },
                  ]}
                  resizeMode="contain"
                />
              ) : viewer.message.kind === 'video' && viewer.message.fileUrl ? (
                <Video
                  source={{ uri: viewer.message.fileUrl }}
                  style={[
                    styles.viewerVideo,
                    { width: viewerWidth, height: viewerHeight },
                  ]}
                  controls
                  paused={false}
                  resizeMode="contain"
                />
              ) : viewer.message.kind === 'audio' ? (
                <View style={styles.viewerAudioWrap}>
                  <MaterialDesignIcons
                    name="music-note"
                    size={96}
                    color="#FFFFFF"
                  />
                  <Text
                    numberOfLines={2}
                    style={styles.viewerAudioName}
                  >
                    {viewer.message.fileName ?? 'Voice note'}
                  </Text>
                  {!!viewer.message.fileUrl && (
                    <Video
                      source={{ uri: viewer.message.fileUrl }}
                      style={styles.viewerAudioPlayer}
                      controls
                      paused={false}
                    />
                  )}
                </View>
              ) : (
                <View
                  style={[
                    styles.viewerFileCard,
                    {
                      width: Math.min(windowWidth - 48, 340),
                      backgroundColor: paperTheme.colors.elevation.level2,
                    },
                  ]}
                >
                  <MaterialDesignIcons
                    name="file-document-outline"
                    size={48}
                    color={paperTheme.colors.onSurfaceVariant}
                  />
                  <Text
                    numberOfLines={2}
                    style={[
                      styles.viewerFileName,
                      { color: paperTheme.colors.onSurface },
                    ]}
                  >
                    {viewer.message.fileName ?? 'Attachment'}
                  </Text>
                  {!!formatBytes(viewer.message.size) && (
                    <Text
                      style={[
                        styles.viewerFileMeta,
                        { color: paperTheme.colors.onSurfaceVariant },
                      ]}
                    >
                      {formatBytes(viewer.message.size)}
                    </Text>
                  )}
                  {!!viewer.message.mimeType && (
                    <Text
                      style={[
                        styles.viewerFileMeta,
                        { color: paperTheme.colors.onSurfaceVariant },
                      ]}
                    >
                      {viewer.message.mimeType}
                    </Text>
                  )}
                  <Text
                    style={[
                      styles.viewerFileTime,
                      { color: paperTheme.colors.onSurfaceVariant },
                    ]}
                  >
                    {dayjs(viewer.message.createdAt).format(
                      'MMMM D, YYYY h:mm A',
                    )}
                  </Text>
                </View>
              )}
            </>
          )}
        </View>
      </Modal>

      {actionTarget && (
        <View style={styles.actionOverlay} pointerEvents="box-none">
          <Pressable style={styles.actionBackdrop} onPress={closeActionMenu} />
          {actionPanel === 'delete' ? (
            <Animated.View
              style={[
                styles.confirmCard,
                {
                  left: confirmLeft,
                  top: confirmTop,
                  width: confirmWidth,
                  backgroundColor: paperTheme.colors.elevation.level3,
                  borderColor: paperTheme.colors.outlineVariant,
                  opacity: menuOpacity,
                  transform: [{ scale: menuScale }],
                },
              ]}
            >
              <Text
                style={[
                  styles.confirmTitle,
                  { color: paperTheme.colors.onSurface },
                ]}
              >
                Delete message?
              </Text>
              <Text
                style={[
                  styles.confirmBody,
                  { color: paperTheme.colors.onSurfaceVariant },
                ]}
              >
                This will delete the message for everyone.
              </Text>
              <View style={styles.confirmActions}>
                <TouchableOpacity
                  style={[
                    styles.confirmPill,
                    { backgroundColor: paperTheme.colors.surfaceVariant },
                  ]}
                  onPress={cancelPanel}
                >
                  <Text
                    style={[
                      styles.confirmPillLabel,
                      { color: paperTheme.colors.onSurfaceVariant },
                    ]}
                  >
                    Cancel
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.confirmPill,
                    { backgroundColor: paperTheme.colors.errorContainer },
                  ]}
                  onPress={confirmDeleteMessage}
                >
                  <Text
                    style={[
                      styles.confirmPillLabel,
                      { color: paperTheme.colors.onErrorContainer },
                    ]}
                  >
                    Delete
                  </Text>
                </TouchableOpacity>
              </View>
            </Animated.View>
          ) : actionPanel === 'info' ? (
            <Animated.View
              style={[
                styles.confirmCard,
                {
                  left: confirmLeft,
                  top: confirmTop,
                  width: confirmWidth,
                  backgroundColor: paperTheme.colors.elevation.level3,
                  borderColor: paperTheme.colors.outlineVariant,
                  opacity: menuOpacity,
                  transform: [{ scale: menuScale }],
                },
              ]}
            >
              <Text
                style={[
                  styles.confirmTitle,
                  { color: paperTheme.colors.onSurface },
                ]}
              >
                Message info
              </Text>
              <Text
                style={[
                  styles.confirmBody,
                  { color: paperTheme.colors.onSurfaceVariant },
                ]}
              >
                {actionTarget.sender.displayName}
                {'\n'}
                {dayjs(actionTarget.createdAt).format('MMMM D, YYYY h:mm A')}
              </Text>
              <View style={styles.confirmActions}>
                <TouchableOpacity
                  style={[
                    styles.confirmPill,
                    { backgroundColor: paperTheme.colors.primaryContainer },
                  ]}
                  onPress={cancelPanel}
                >
                  <Text
                    style={[
                      styles.confirmPillLabel,
                      { color: paperTheme.colors.onPrimaryContainer },
                    ]}
                  >
                    Close
                  </Text>
                </TouchableOpacity>
              </View>
            </Animated.View>
          ) : (
            <Animated.View
              style={[
                styles.actionMenu,
                {
                  left: menuLeft,
                  top: menuTop,
                  backgroundColor: paperTheme.colors.elevation.level3,
                  borderColor: paperTheme.colors.outlineVariant,
                  opacity: menuOpacity,
                  transform: [{ scale: menuScale }],
                },
              ]}
            >
              <View style={styles.actionEmojiRow}>
                {REACTION_EMOJIS.map(emoji => (
                  <ReactionPickerButton
                    key={emoji}
                    emoji={emoji}
                    onPress={() => reactFromMenu(emoji)}
                  />
                ))}
              </View>
              <View
                style={[
                  styles.sheetDivider,
                  { backgroundColor: paperTheme.colors.outlineVariant },
                ]}
              />
              <MenuAction icon="reply" label="Reply" onPress={replyFromMenu} />
              {actionTarget.kind === 'text' && (
                <MenuAction
                  icon="content-copy"
                  label="Copy"
                  onPress={copyFromMenu}
                />
              )}
              <MenuAction
                icon="share-variant"
                label="Forward"
                onPress={() => forwardMessageAction(actionTarget)}
              />
              <MenuAction
                icon="information-outline"
                label="Info"
                onPress={showMessageInfo}
              />
              {actionTarget.senderId === user?._id && (
                <MenuAction
                  icon="delete-outline"
                  label="Delete"
                  color={paperTheme.colors.error}
                  onPress={requestDelete}
                />
              )}
            </Animated.View>
          )}
        </View>
      )}
    </SafeAreaView>
  );
};

export default ChatScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
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
  bubbleTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    marginTop: 4,
  },
  bubbleTime: {
    fontSize: 10,
  },
  bubbleTick: {
    marginLeft: 3,
  },
  imageAttachment: {
    width: 220,
    height: 220,
    borderRadius: 10,
    marginBottom: 4,
  },
  videoCard: {
    width: 220,
    height: 165,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 4,
    backgroundColor: '#000000',
  },
  videoPreview: {
    ...StyleSheet.absoluteFillObject,
  },
  videoPlayOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPlayIcon: {
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 5,
  },
  videoNamePill: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    maxWidth: 180,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  videoNameText: {
    color: '#FFFFFF',
    fontSize: 11,
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
  pendingBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  pendingList: {
    flexGrow: 0,
  },
  pendingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingLeft: 6,
    paddingRight: 4,
    paddingVertical: 4,
    marginRight: 8,
    maxWidth: 220,
  },
  pendingThumb: {
    width: 28,
    height: 28,
    borderRadius: 10,
  },
  pendingIcon: {
    marginHorizontal: 6,
  },
  pendingName: {
    flexShrink: 1,
    fontSize: 13,
    marginRight: 2,
  },
  pendingRemove: {
    padding: 4,
    marginLeft: 2,
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
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerTopBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    borderRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 6,
    zIndex: 2,
    elevation: 6,
  },
  viewerTopButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerImage: {
    borderRadius: 16,
  },
  viewerVideo: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  viewerAudioWrap: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  viewerAudioName: {
    color: '#FFFFFF',
    fontSize: 17,
    marginTop: 16,
    marginBottom: 20,
    textAlign: 'center',
  },
  viewerAudioPlayer: {
    width: '100%',
    height: 56,
    borderRadius: 16,
    overflow: 'hidden',
  },
  viewerFileCard: {
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 28,
    alignItems: 'center',
  },
  viewerFileName: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 14,
    textAlign: 'center',
  },
  viewerFileMeta: {
    fontSize: 13,
    marginTop: 6,
  },
  viewerFileTime: {
    fontSize: 12,
    marginTop: 14,
  },
  actionOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
  },
  actionBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  actionMenu: {
    position: 'absolute',
    width: 230,
    borderRadius: 26,
    borderWidth: 1,
    paddingVertical: 8,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  actionEmojiRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 6,
  },
  sheetDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 12,
    marginBottom: 4,
  },
  reactionPickerItem: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionPickerEmoji: {
    fontSize: 17,
  },
  menuAction: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  menuActionLabel: {
    fontSize: 15,
    marginLeft: 12,
  },
  confirmCard: {
    position: 'absolute',
    borderRadius: 28,
    borderWidth: 1,
    padding: 20,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  confirmTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  confirmBody: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  confirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 18,
  },
  confirmPill: {
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 9,
    marginLeft: 8,
  },
  confirmPillLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
});
