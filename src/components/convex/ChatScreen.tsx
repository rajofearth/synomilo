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
import UserAvatar from './UserAvatar';

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
  sender: {
    _id: string;
    displayName: string;
    username: string;
    /** Convex `publicUser()` sends this; the old type stripped it. */
    avatarUrl: string | null;
  };
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

type UploadStatus = 'uploading' | 'sending' | 'failed';

/**
 * One queued attachment plus its own upload state.
 *
 * The list is keyed by `id` and every mutation patches exactly one item, so N
 * uploads in flight cannot clobber each other's progress or failure.
 */
type PendingAttachment = {
  id: string;
  uri: string;
  name: string;
  mimeType: string;
  size: number | null;
  kind: Message['kind'];
  /** Seconds, only known when the platform picker reported it. */
  durationSeconds: number | null;
  status: UploadStatus;
  /** 0..1 when the transport reported a length, else null (indeterminate). */
  progress: number | null;
  error: string | null;
};

type StagedAttachment = Omit<
  PendingAttachment,
  'status' | 'progress' | 'error'
>;

let pendingSequence = 0;

const nextPendingId = (): string => {
  pendingSequence += 1;
  return `pending-${Date.now()}-${pendingSequence}`;
};

/**
 * POST the bytes with real byte-level progress.
 *
 * `fetch` gives no upload progress, so the old flow could only say "something
 * is happening". XHR's `upload.onprogress` does, and it also gives us an
 * `abort()` handle so removing a chip actually cancels the transfer instead of
 * letting a "deleted" attachment post itself later.
 *
 * `onProgress` is only called when the length is known; otherwise the caller
 * stays indeterminate (`progress: null`) rather than inventing a fake bar.
 */
const postWithProgress = (
  url: string,
  mime: string,
  blob: Blob,
  onProgress: (fraction: number) => void,
  register: (xhr: XMLHttpRequest) => void,
): Promise<{ storageId: string }> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    register(xhr);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(1, event.loaded / event.total));
      }
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Upload failed (${xhr.status})`));
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText));
      } catch {
        reject(new Error('The server sent an unreadable response.'));
      }
    };
    xhr.onerror = () =>
      reject(new Error('Could not reach the server. Check your connection.'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', mime);
    xhr.send(blob);
  });

/** `95` -> `1:35`, `3725` -> `1:02:05`. */
const formatDuration = (seconds: number | null): string => {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
    return '';
  }
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
};

/**
 * Poster frames: a URL that already failed to decode as an image is remembered
 * for the process so a scrolling FlatList does not re-request it on every
 * re-render.
 */
const brokenPosterUris = new Set<string>();

/**
 * Best available still for a video cell, or `null` when we should draw the
 * themed placeholder instead.
 *
 * Convex stores no thumbnail and the SDKs expose no frame extractor here, so
 * this is the asset URL itself: if the storage object happens to be an image
 * (a GIF poster, a server-generated thumbnail) the bubble gets a real frame,
 * and an mp4 that cannot decode as an image degrades to the placeholder.
 */
const videoPosterFor = (uri: string): string | null =>
  brokenPosterUris.has(uri) ? null : uri;

type MediaTokens = {
  scrim: string;
  overlay: string;
  chip: string;
  errorOverlay: string;
  onMedia: string;
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

/**
 * A video message cell: a still (or a designed placeholder) plus a play
 * affordance. Deliberately contains NO player.
 *
 * The previous cell mounted a paused <Video> per row inside an inverted
 * FlatList, which meant one ExoPlayer per visible message, a decoder per
 * scroll, and native views swallowing taps. Playback now happens in the media
 * viewer, which mounts exactly one player for the whole screen.
 */
const VideoAttachmentCell = ({
  uri,
  fileName,
  size,
  media,
  onPress,
}: {
  uri: string;
  fileName: string | null;
  size: number | null;
  media: MediaTokens;
  onPress: () => void;
}) => {
  // `brokenUri` (not a boolean) so a recycled row pointing at a different URL
  // gets a fresh attempt instead of inheriting the previous row's failure.
  const [brokenUri, setBrokenUri] = useState<string | null>(null);
  const poster = brokenUri === uri ? null : videoPosterFor(uri);
  const caption = [fileName, formatBytes(size) || null].filter(Boolean).join('  ·  ');

  return (
    <Pressable
      onPress={onPress}
      style={[styles.videoCard, { backgroundColor: media.scrim }]}
      accessibilityRole="button"
      accessibilityLabel={`Play video${fileName ? `, ${fileName}` : ''}`}
    >
      {poster ? (
        <Image
          source={{ uri: poster }}
          style={styles.videoPoster}
          resizeMode="cover"
          onError={() => {
            brokenPosterUris.add(uri);
            setBrokenUri(uri);
          }}
        />
      ) : (
        <View
          style={[
            styles.videoPosterFallback,
            { backgroundColor: media.errorOverlay },
          ]}
        >
          <MaterialDesignIcons
            name="movie"
            size={34}
            color={media.onMedia}
          />
          <Text style={[styles.videoFallbackText, { color: media.onMedia }]}>
            Video
          </Text>
        </View>
      )}
      <View style={styles.videoPlayOverlay} pointerEvents="none">
        <View style={[styles.videoPlayButton, { backgroundColor: media.overlay }]}>
          <MaterialDesignIcons name="play" size={26} color={media.onMedia} />
        </View>
      </View>
      {!!caption && (
        <View
          style={[styles.videoChip, { backgroundColor: media.chip }]}
          pointerEvents="none"
        >
          <Text numberOfLines={1} style={[styles.videoChipText, { color: media.onMedia }]}>
            {caption}
          </Text>
        </View>
      )}
    </Pressable>
  );
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
  /** 'ready' | 'error' | 'loading' for the ONE player mounted in the viewer. */
  const [viewerMedia, setViewerMedia] = useState<{
    status: 'loading' | 'ready' | 'error';
    nonce: number;
  }>({ status: 'loading', nonce: 0 });
  const menuScale = useRef(new Animated.Value(0.8)).current;
  const menuOpacity = useRef(new Animated.Value(0)).current;
  const listRef = useRef<FlatList<Message>>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** id -> in-flight XHR, so a chip can be removed *and* aborted. */
  const uploadsRef = useRef(new Map<string, XMLHttpRequest>());
  /** ids the user removed; their transfer's result must be ignored. */
  const cancelledRef = useRef(new Set<string>());
  /** ids with a `runUpload` promise outstanding; stops double-starts. */
  const inFlightRef = useRef(new Set<string>());
  /** Read inside `runUpload` so a re-render never orphans an upload. */
  const pendingRef = useRef<PendingAttachment[]>([]);
  const mountedRef = useRef(true);
  pendingRef.current = pending;

  /**
   * Every colour this screen draws with, resolved once per theme change.
   *
   * Chat chrome comes from the monochrome Paper palette so light/dark both
   * stay achromatic. Media overlays use the UIKit's `media*` tokens: those are
   * deliberately dark in BOTH schemes because they sit on top of arbitrary
   * video pixels, where a light scrim in dark mode would be unreadable.
   */
  const ui = useMemo(() => {
    const c = paperTheme.colors;
    return {
      primary: c.primary,
      onPrimary: c.onPrimary,
      primaryContainer: c.primaryContainer,
      onPrimaryContainer: c.onPrimaryContainer,
      onSecondaryContainer: c.onSecondaryContainer,
      background: c.background,
      surface: c.surface,
      surfaceVariant: c.surfaceVariant,
      onSurface: c.onSurface,
      onSurfaceVariant: c.onSurfaceVariant,
      outline: c.outline,
      outlineVariant: c.outlineVariant,
      error: c.error,
      errorContainer: c.errorContainer,
      onErrorContainer: c.onErrorContainer,
      elevation2: c.elevation.level2,
      elevation3: c.elevation.level3,
      backdrop: c.backdrop,
      shadow: c.shadow,
    };
  }, [paperTheme.colors]);

  const media = useMemo(
    () => ({
      scrim: theme.color.mediaScrim as string,
      overlay: theme.color.mediaOverlay as string,
      chip: theme.color.mediaDurationChip as string,
      errorOverlay: theme.color.mediaErrorOverlay as string,
      onMedia: theme.color.staticWhite as string,
    }),
    [theme.color],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
      }
    };
  }, []);

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

  /** Patch exactly one queued item. Parallel uploads never share a setter. */
  const patchPending = useCallback(
    (id: string, patch: Partial<PendingAttachment>) => {
      setPending(prev =>
        prev.map(item => (item.id === id ? { ...item, ...patch } : item)),
      );
    },
    [],
  );

  /**
   * Uploads + sends one attachment, tracking its own progress.
   *
   * Runs on pick, NOT on send: the composer stays typeable and the list stays
   * scrollable for the whole transfer, and `onSend` never waits on it.
   */
  const runUpload = useCallback(
    async (item: StagedAttachment) => {
      const id = item.id;
      if (!token || cancelledRef.current.has(id) || inFlightRef.current.has(id)) {
        return;
      }
      inFlightRef.current.add(id);
      let lastPaint = 0;
      try {
        // The item is passed in, NOT read back out of state: `startUploads`
        // runs in the same tick as the `setPending` that queued it, so state
        // does not contain it yet.
        const mime = item.mimeType || 'application/octet-stream';
        patchPending(id, {
          status: 'uploading',
          progress: null,
          error: null,
        });
        const postUrl = await generateUploadUrl({ token });
        const blob = await uriToBlob(item.uri);
        if (cancelledRef.current.has(id)) {
          return;
        }
        const { storageId } = await postWithProgress(
          postUrl,
          mime,
          blob,
          fraction => {
            // Throttle: a 300 KB image fires hundreds of progress events and
            // each one would re-render the whole pending bar.
            const now = Date.now();
            if (now - lastPaint < 150 && fraction < 1) {
              return;
            }
            lastPaint = now;
            patchPending(id, { progress: fraction });
          },
          xhr => {
            uploadsRef.current.set(id, xhr);
          },
        );
        uploadsRef.current.delete(id);
        patchPending(id, { status: 'sending', progress: 1 });
        await sendMessage({
          token,
          conversationId: conversationId as any,
          kind: item.kind,
          // Convex storage returns the id as a plain string over the wire.
          storageId: storageId as any,
          fileName: item.name || 'file',
          mimeType: mime,
          size: item.size ?? undefined,
        });
        if (mountedRef.current) {
          setPending(prev => prev.filter(row => row.id !== id));
        }
      } catch (error) {
        uploadsRef.current.delete(id);
        if (cancelledRef.current.has(id) || !mountedRef.current) {
          return;
        }
        // No Alert: a modal would block exactly the conversation the user is
        // trying to carry on with. The chip turns into an inline retry.
        patchPending(id, {
          status: 'failed',
          progress: null,
          error: convexErrorMessage(error, 'Could not upload the file.'),
        });
      } finally {
        inFlightRef.current.delete(id);
      }
    },
    [token, generateUploadUrl, sendMessage, conversationId, patchPending],
  );

  const removePending = useCallback((id: string) => {
    // Cancel the transfer as well as dropping the row: otherwise removing a
    // chip mid-upload still posts the bytes and posts a message the user
    // believes they deleted.
    cancelledRef.current.add(id);
    const xhr = uploadsRef.current.get(id);
    uploadsRef.current.delete(id);
    try {
      xhr?.abort();
    } catch {}
    setPending(prev => prev.filter(item => item.id !== id));
  }, []);

  const retryUpload = useCallback(
    (id: string) => {
      const item = pendingRef.current.find(row => row.id === id);
      if (!item) {
        return;
      }
      cancelledRef.current.delete(id);
      patchPending(id, {
        status: 'uploading',
        progress: null,
        error: null,
      });
      runUpload(item);
    },
    [patchPending, runUpload],
  );

  const startUploads = useCallback(
    (items: StagedAttachment[]) => {
      items.forEach(item => {
        cancelledRef.current.delete(item.id);
        runUpload(item);
      });
    },
    [runUpload],
  );

  const onSend = useCallback(async () => {
    const body = text.trim();
    // Text is never gated on an in-flight upload: the attachment posts itself
    // the moment its bytes land, so a slow 40 MB video must not hold the
    // composer hostage.
    if (!body || !token || sending) {
      return;
    }
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
    }
    const replyToId = replyTarget?._id;
    setSending(true);
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
      // Put the draft back exactly as it was: a failed send (or an unrelated
      // failed upload) must never cost the user their words.
      setText(body);
      Alert.alert(
        'Message not sent',
        convexErrorMessage(error, 'Please try again.'),
      );
    } finally {
      setSending(false);
    }
  }, [text, token, sending, sendMessage, conversationId, replyTarget]);

  const stageAndUpload = useCallback(
    (items: StagedAttachment[]) => {
      if (items.length === 0) {
        return;
      }
      setPending(prev => [
        ...prev,
        ...items.map(item => ({
          ...item,
          status: 'uploading' as UploadStatus,
          progress: null,
          error: null,
        })),
      ]);
      // Start now, not on send. The row above is purely a progress readout.
      startUploads(items);
    },
    [startUploads],
  );

  const pickPhoto = useCallback(async () => {
    setAttachOpen(false);
    const result = await launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: 0,
    });
    stageAndUpload(
      (result.assets ?? [])
        .filter(asset => !!asset.uri)
        .map(asset => ({
          id: nextPendingId(),
          uri: asset.uri as string,
          name: asset.fileName ?? `photo-${Date.now()}.jpg`,
          mimeType: asset.type ?? 'image/jpeg',
          size: asset.fileSize ?? null,
          kind: 'image' as Message['kind'],
          durationSeconds: null,
        })),
    );
  }, [stageAndUpload]);

  const pickVideo = useCallback(async () => {
    setAttachOpen(false);
    const result = await launchImageLibrary({
      mediaType: 'video',
      selectionLimit: 0,
    });
    stageAndUpload(
      (result.assets ?? [])
        .filter(asset => !!asset.uri)
        .map(asset => ({
          id: nextPendingId(),
          uri: asset.uri as string,
          name: asset.fileName ?? `video-${Date.now()}.mp4`,
          mimeType: asset.type ?? 'video/mp4',
          size: asset.fileSize ?? null,
          kind: 'video' as Message['kind'],
          durationSeconds:
            typeof asset.duration === 'number' ? asset.duration : null,
        })),
    );
  }, [stageAndUpload]);

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
      const additions: StagedAttachment[] = [];
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
          durationSeconds: null,
        });
      }
      stageAndUpload(additions);
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
  }, [stageAndUpload]);

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
    // Fresh media state per item: a failed player must not follow the user to
    // the next photo, and a new item must not inherit a stale error.
    setViewerMedia({ status: 'loading', nonce: Date.now() });
    setViewer({ message });
  }, []);

  const closeViewer = useCallback(() => {
    // Dropping `viewer` unmounts the <Video>; there is exactly one player in
    // this tree and it lives only inside the viewer.
    setViewer(null);
  }, []);

  const reloadViewerMedia = useCallback(() => {
    setViewerMedia({ status: 'loading', nonce: Date.now() });
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

      // Outgoing is a FILLED container, so its text must be the container's
      // own `on*` colour - never a literal. `primaryContainer` /
      // `onPrimaryContainer` is the pair that survives both schemes
      // (~13.9:1 in light, ~9.2:1 in dark). The old `primary` + hardcoded
      // white pairing rendered white-on-near-white the moment dark mode
      // flipped `primary` to a near-white value.
      const bubbleBg = mine ? ui.primaryContainer : ui.surfaceVariant;
      const bubbleText = mine ? ui.onPrimaryContainer : ui.onSurface;
      const bubbleMuted = mine ? ui.onSecondaryContainer : ui.onSurfaceVariant;
      const timeColor = bubbleMuted;
      // Read is distinguished by SHAPE + WEIGHT, never hue: the app is
      // achromatic, and a cyan tick was unreadable on a light bubble.
      const tickIcon = tick === 'sent' ? 'check' : 'check-all';
      const tickSize = tick === 'read' ? 16 : 14;
      const tickColor = tick === 'read' ? bubbleText : bubbleMuted;

      return (
        <View>
          {showDay && (
            <View style={styles.daySeparatorWrap}>
              <Text
                style={[
                  theme.typography.caption1.medium,
                  styles.daySeparator,
                  {
                    color: ui.onSurfaceVariant,
                    backgroundColor: ui.surfaceVariant,
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
                { backgroundColor: bubbleBg },
                isHighlighted && {
                  borderWidth: 2,
                  borderColor: ui.outline,
                },
              ]}
            >
              {!mine && isGroup && !deleted && (
                <View style={styles.senderRow}>
                  <UserAvatar
                    entity={item.sender}
                    name={item.sender.displayName}
                    size={20}
                    variant="text"
                    containerStyle={[
                      styles.senderAvatar,
                      { backgroundColor: ui.primaryContainer },
                    ]}
                    labelStyle={styles.senderInitials}
                    labelColor={ui.primary}
                  />
                  <Text
                    style={[
                      theme.typography.caption1.medium,
                      styles.senderName,
                      { color: ui.primary },
                    ]}
                  >
                    {item.sender.displayName}
                  </Text>
                </View>
              )}
              {!!item.forwardedFrom && !deleted && (
                <View style={styles.forwardedRow}>
                  <MaterialDesignIcons
                    name="share"
                    size={12}
                    color={bubbleMuted}
                  />
                  <Text
                    style={[
                      theme.typography.caption2?.regular ??
                        theme.typography.caption1.regular,
                      styles.forwardedText,
                      { color: bubbleMuted },
                    ]}
                  >
                    Forwarded from {item.forwardedFrom}
                  </Text>
                </View>
              )}
              {deleted ? (
                <View style={styles.deletedRow}>
                  <MaterialDesignIcons name="cancel" size={14} color={bubbleMuted} />
                  <Text
                    style={[
                      theme.typography.body.regular,
                      styles.deletedText,
                      { color: bubbleMuted },
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
                          borderLeftColor: mine
                            ? ui.onPrimaryContainer
                            : ui.primary,
                          backgroundColor: ui.surfaceVariant,
                        },
                      ]}
                    >
                      <Text
                        numberOfLines={1}
                        style={[
                          theme.typography.caption1.medium,
                          { color: ui.onSurface },
                        ]}
                      >
                        {item.replyTo.senderName}
                      </Text>
                      <Text
                        numberOfLines={2}
                        style={[
                          theme.typography.caption1.regular,
                          { color: ui.onSurfaceVariant },
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
                    <Pressable
                      onPress={() => openViewer(item)}
                      accessibilityRole="button"
                      accessibilityLabel="Open photo"
                    >
                      <Image
                        source={{ uri: item.fileUrl }}
                        style={styles.imageAttachment}
                        resizeMode="cover"
                      />
                    </Pressable>
                  ) : item.kind === 'video' && item.fileUrl ? (
                    <VideoAttachmentCell
                      uri={item.fileUrl}
                      fileName={item.fileName}
                      size={item.size}
                      media={media}
                      onPress={() => openViewer(item)}
                    />
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
                        color={bubbleText}
                        style={styles.fileIcon}
                      />
                      <View style={styles.fileMeta}>
                        <Text
                          numberOfLines={1}
                          style={[
                            theme.typography.body.medium,
                            { color: bubbleText },
                          ]}
                        >
                          {item.fileName ?? 'Attachment'}
                        </Text>
                        {!!formatBytes(item.size) && (
                          <Text
                            style={[
                              theme.typography.caption1.regular,
                              { color: bubbleMuted },
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
                        { color: bubbleText },
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
                    name={tickIcon}
                    size={tickSize}
                    color={tickColor}
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
                          ? ui.primaryContainer
                          : ui.surfaceVariant,
                        borderColor: reaction.mine ? ui.primary : 'transparent',
                      },
                    ]}
                    onPress={() => applyReaction(item, reaction.emoji)}
                  >
                    <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
                    {reaction.count > 1 && (
                      <Text
                        style={[
                          theme.typography.caption1.regular,
                          { color: reaction.mine ? ui.onSurface : ui.onSurfaceVariant },
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
      theme.typography,
      ui,
      media,
      applyReaction,
      openViewer,
      messages,
      highlightId,
      scrollToMessage,
      tickFor,
    ],
  );

  const isSubscribed = thread !== undefined;
  // The send button depends on the DRAFT only. Attachments upload on their own
  // clock, so a half-finished 40 MB upload never disables sending a reply.
  const canSend = !!text.trim() && !sending;
  const viewerWidth = windowWidth - 32;
  const viewerHeight = windowHeight - 160;
  /**
   * Which branch (if any) the single viewer player should take. `null` means
   * the player is not mounted at all - an image, a plain file or a deleted
   * attachment must never leave a decoder running from a previous item.
   */
  const viewerMediaKind: 'video' | 'audio' | null =
    viewer?.message.fileUrl && viewer.message.kind === 'video'
      ? 'video'
      : viewer?.message.fileUrl && viewer.message.kind === 'audio'
        ? 'audio'
        : null;
  // `actionCount` must stay in lockstep with the rows the menu below renders,
  // or `estimatedMenuHeight` puts the panel off-screen. Rows are: Reply,
  // [Copy], Forward, Info, [Delete] -> 3 base.
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
      style={[styles.container, { backgroundColor: ui.background }]}
      edges={['top']}
    >
      <View
        style={[
          styles.header,
          { borderBottomColor: ui.outlineVariant },
        ]}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Text style={[styles.backIcon, { color: ui.onSurface }]}>
            ‹
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.headerBody} onPress={openInfo}>
          <UserAvatar
            entity={conversation}
            name={conversation?.title ?? fallbackTitle}
            size={36}
            variant="text"
            shape={conversation?.type === 'group' ? 'rounded' : 'circle'}
            containerStyle={[
              styles.headerAvatar,
              { backgroundColor: ui.primaryContainer },
            ]}
            labelStyle={styles.headerAvatarInitials}
            labelColor={ui.primary}
          />
          <View style={styles.headerText}>
            <Text
              numberOfLines={1}
              style={[
                theme.typography.heading3.bold,
                { color: ui.onSurface },
              ]}
            >
              {conversation?.title ?? fallbackTitle}
            </Text>
          {typingNames && typingNames.length > 0 ? (
            <Text
              numberOfLines={1}
              style={[
                theme.typography.caption1.regular,
                { color: ui.primary },
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
                { color: ui.onSurfaceVariant },
              ]}
            >
              {conversation.members.length}{' '}
              {conversation.members.length === 1 ? 'member' : 'members'}
            </Text>
          ) : null}
          </View>
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
                color={ui.onSurface}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerAction}
              onPress={() => handleStartCall('video')}
            >
              <MaterialDesignIcons
                name="video-outline"
                size={22}
                color={ui.onSurface}
              />
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity style={styles.headerAction} onPress={openInfo}>
          <MaterialDesignIcons
            name="information-outline"
            size={22}
            color={ui.onSurface}
          />
        </TouchableOpacity>
      </View>

      {!isSubscribed ? (
        <View style={styles.center}>
          <ActivityIndicator color={ui.primary} />
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
                  { color: ui.onSurfaceVariant },
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
                backgroundColor: ui.surface,
                borderTopColor: ui.outlineVariant,
              },
            ]}
          >
            <FlatList
              horizontal
              data={pending}
              extraData={pending}
              keyExtractor={item => item.id}
              showsHorizontalScrollIndicator={false}
              style={styles.pendingList}
              renderItem={({ item }) => {
                const percent =
                  item.status === 'uploading' && item.progress != null
                    ? Math.round(item.progress * 100)
                    : null;
                const label =
                  item.status === 'failed'
                    ? item.error ?? 'Upload failed'
                    : item.status === 'sending'
                      ? 'Sending…'
                      : percent != null
                        ? `Uploading… ${percent}%`
                        : 'Uploading…';
                // The platform picker knows how long a picked video is; the
                // transcript does not, so this is the only place we can show
                // a duration before the message exists.
                const duration = formatDuration(item.durationSeconds);
                const detail =
                  item.status === 'failed'
                    ? label
                    : duration
                      ? `${label}  ·  ${duration}`
                      : label;
                return (
                  <View
                    style={[
                      styles.pendingChip,
                      {
                        backgroundColor: ui.surfaceVariant,
                        borderColor:
                          item.status === 'failed' ? ui.error : ui.outlineVariant,
                      },
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
                        color={ui.onSurfaceVariant}
                        style={styles.pendingIcon}
                      />
                    )}
                    <View style={styles.pendingInfo}>
                      <Text
                        numberOfLines={1}
                        style={[styles.pendingName, { color: ui.onSurface }]}
                      >
                        {item.name}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.pendingStatus,
                          {
                            color:
                              item.status === 'failed'
                                ? ui.error
                                : ui.onSurfaceVariant,
                          },
                        ]}
                      >
                        {detail}
                      </Text>
                      {item.status !== 'failed' && (
                        <View
                          style={[
                            styles.pendingTrack,
                            { backgroundColor: ui.outlineVariant },
                          ]}
                        >
                          <View
                            style={[
                              styles.pendingFill,
                              {
                                backgroundColor: ui.onSurfaceVariant,
                                // No length known: show a short muted segment
                                // rather than a full bar, which would read as
                                // "finished".
                                width: percent == null ? '30%' : `${percent}%`,
                                opacity: percent == null ? 0.4 : 1,
                              },
                            ]}
                          />
                        </View>
                      )}
                    </View>
                    {item.status === 'failed' && (
                      <TouchableOpacity
                        onPress={() => retryUpload(item.id)}
                        style={styles.pendingAction}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`Retry uploading ${item.name}`}
                      >
                        <MaterialDesignIcons
                          name="refresh"
                          size={18}
                          color={ui.onSurface}
                        />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      onPress={() => removePending(item.id)}
                      style={styles.pendingRemove}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${item.name}`}
                    >
                      <MaterialDesignIcons
                        name="close"
                        size={14}
                        color={ui.onSurfaceVariant}
                      />
                    </TouchableOpacity>
                  </View>
                );
              }}
            />
          </View>
        )}
        {replyTarget && (
          <View
            style={[
              styles.replyBar,
              {
                backgroundColor: ui.surface,
                borderTopColor: ui.outlineVariant,
              },
            ]}
          >
            <View
              style={[styles.replyBarAccent, { backgroundColor: ui.primary }]}
            />
            <View style={styles.replyBarBody}>
              <Text
                numberOfLines={1}
                style={[
                  theme.typography.caption1.medium,
                  { color: ui.primary },
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
                  { color: ui.onSurfaceVariant },
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
                color={ui.onSurfaceVariant}
              />
            </TouchableOpacity>
          </View>
        )}
        <View
          style={[
            styles.composer,
            {
              backgroundColor: ui.surface,
              borderTopColor: ui.outlineVariant,
            },
          ]}
        >
          <TouchableOpacity
            style={styles.attachButton}
            onPress={() => setAttachOpen(true)}
          >
            <MaterialDesignIcons
              name="plus-circle-outline"
              size={26}
              color={ui.primary}
            />
          </TouchableOpacity>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: ui.background,
                color: ui.onSurface,
                borderColor: ui.outlineVariant,
              },
            ]}
            value={text}
            onChangeText={onTextChange}
            placeholder="Type your message..."
            placeholderTextColor={ui.outline}
            multiline
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              { backgroundColor: ui.primary },
              !canSend && styles.sendButtonDisabled,
            ]}
            onPress={onSend}
            disabled={!canSend}
          >
            {sending ? (
              <ActivityIndicator color={ui.onPrimary} size="small" />
            ) : (
              <MaterialDesignIcons name="send" size={18} color={ui.onPrimary} />
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
        <Pressable
          style={[styles.modalBackdrop, { backgroundColor: ui.backdrop }]}
          onPress={() => setAttachOpen(false)}
        >
          <View
            style={[
              styles.attachSheet,
              { backgroundColor: ui.background },
            ]}
          >
            <TouchableOpacity style={styles.attachOption} onPress={pickPhoto}>
              <MaterialDesignIcons
                name="image-outline"
                size={22}
                color={ui.onSurface}
                style={styles.attachOptionIcon}
              />
              <Text
                style={[
                  theme.typography.body.medium,
                  { color: ui.onSurface },
                ]}
              >
                Photo
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.attachOption} onPress={pickVideo}>
              <MaterialDesignIcons
                name="video-outline"
                size={22}
                color={ui.onSurface}
                style={styles.attachOptionIcon}
              />
              <Text
                style={[
                  theme.typography.body.medium,
                  { color: ui.onSurface },
                ]}
              >
                Video
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.attachOption} onPress={pickDocument}>
              <MaterialDesignIcons
                name="file-document-outline"
                size={22}
                color={ui.onSurface}
                style={styles.attachOptionIcon}
              />
              <Text
                style={[
                  theme.typography.body.medium,
                  { color: ui.onSurface },
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
        onRequestClose={closeViewer}
      >
        <View
          style={[styles.viewerBackdrop, { backgroundColor: media.scrim }]}
        >
          {viewer && (
            <>
              <View
                style={[
                  styles.viewerTopBar,
                  {
                    top: insets.top + 8,
                    backgroundColor: ui.elevation3,
                    shadowColor: ui.shadow,
                  },
                ]}
              >
                <TouchableOpacity
                  style={styles.viewerTopButton}
                  onPress={closeViewer}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <MaterialDesignIcons name="close" size={24} color={ui.onSurface} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.viewerTopButton}
                  onPress={forwardFromViewer}
                  accessibilityRole="button"
                  accessibilityLabel="Forward"
                >
                  <MaterialDesignIcons
                    name="share-variant"
                    size={22}
                    color={ui.onSurface}
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
              ) : viewerMediaKind ? (
                // The ONE and only <Video> in this file. It mounts when a
                // playable item is opened and unmounts when the viewer closes
                // or a non-playable item is shown, so a previously-viewed clip
                // never keeps a decoder (and its audio focus) alive.
                viewerMedia.status === 'error' ? (
                  <View
                    style={[
                      styles.viewerErrorCard,
                      { backgroundColor: ui.elevation2 },
                    ]}
                  >
                    <MaterialDesignIcons
                      name="alert-circle-outline"
                      size={44}
                      color={ui.onSurfaceVariant}
                    />
                    <Text
                      style={[
                        styles.viewerFileName,
                        { color: ui.onSurface },
                      ]}
                    >
                      Could not play {viewerMediaKind === 'video' ? 'video' : 'audio'}
                    </Text>
                    <Text
                      style={[
                        styles.viewerFileMeta,
                        { color: ui.onSurfaceVariant },
                      ]}
                    >
                      {viewer.message.fileName ?? ''}
                    </Text>
                    <TouchableOpacity
                      style={[
                        styles.viewerRetryPill,
                        { backgroundColor: ui.primaryContainer },
                      ]}
                      onPress={reloadViewerMedia}
                      accessibilityRole="button"
                    >
                      <Text
                        style={[
                          styles.viewerRetryLabel,
                          { color: ui.onPrimaryContainer },
                        ]}
                      >
                        Try again
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View
                    style={
                      viewerMediaKind === 'video'
                        ? [
                            styles.viewerVideo,
                            {
                              width: viewerWidth,
                              height: viewerHeight,
                              backgroundColor: media.scrim,
                            },
                          ]
                        : styles.viewerAudioPlayer
                    }
                  >
                    <Video
                      key={`${viewer.message._id}:${viewerMedia.nonce}`}
                      source={{ uri: viewer.message.fileUrl as string }}
                      style={StyleSheet.absoluteFill}
                      controls
                      paused={false}
                      resizeMode="contain"
                      onLoad={() =>
                        setViewerMedia(prev =>
                          prev.status === 'loading'
                            ? { ...prev, status: 'ready' }
                            : prev,
                        )
                      }
                      onError={() =>
                        setViewerMedia({ status: 'error', nonce: Date.now() })
                      }
                    />
                    {/* Buffering is a spinner, not a black rectangle. */}
                    {viewerMedia.status === 'loading' && (
                      <View
                        style={[StyleSheet.absoluteFill, styles.viewerLoading]}
                        pointerEvents="none"
                      >
                        <ActivityIndicator color={media.onMedia} size="large" />
                      </View>
                    )}
                  </View>
                )
              ) : viewer.message.kind === 'audio' ? (
                <View style={styles.viewerAudioWrap}>
                  <MaterialDesignIcons
                    name="music-note"
                    size={96}
                    color={media.onMedia}
                  />
                  <Text
                    numberOfLines={2}
                    style={[styles.viewerAudioName, { color: media.onMedia }]}
                  >
                    {viewer.message.fileName ?? 'Voice note'}
                  </Text>
                  <Text
                    style={[styles.viewerFileMeta, { color: media.onMedia }]}
                  >
                    This recording could not be loaded.
                  </Text>
                </View>
              ) : (
                <View
                  style={[
                    styles.viewerFileCard,
                    {
                      width: Math.min(windowWidth - 48, 340),
                      backgroundColor: ui.elevation2,
                    },
                  ]}
                >
                  <MaterialDesignIcons
                    name="file-document-outline"
                    size={48}
                    color={ui.onSurfaceVariant}
                  />
                  <Text
                    numberOfLines={2}
                    style={[
                      styles.viewerFileName,
                      { color: ui.onSurface },
                    ]}
                  >
                    {viewer.message.fileName ?? 'Attachment'}
                  </Text>
                  {!!formatBytes(viewer.message.size) && (
                    <Text
                      style={[
                        styles.viewerFileMeta,
                        { color: ui.onSurfaceVariant },
                      ]}
                    >
                      {formatBytes(viewer.message.size)}
                    </Text>
                  )}
                  {!!viewer.message.mimeType && (
                    <Text
                      style={[
                        styles.viewerFileMeta,
                        { color: ui.onSurfaceVariant },
                      ]}
                    >
                      {viewer.message.mimeType}
                    </Text>
                  )}
                  <Text
                    style={[
                      styles.viewerFileTime,
                      { color: ui.onSurfaceVariant },
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
                  backgroundColor: ui.elevation3,
                  shadowColor: ui.shadow,
                  borderColor: ui.outlineVariant,
                  opacity: menuOpacity,
                  transform: [{ scale: menuScale }],
                },
              ]}
            >
              <Text
                style={[
                  styles.confirmTitle,
                  { color: ui.onSurface },
                ]}
              >
                Delete message?
              </Text>
              <Text
                style={[
                  styles.confirmBody,
                  { color: ui.onSurfaceVariant },
                ]}
              >
                This will delete the message for everyone.
              </Text>
              <View style={styles.confirmActions}>
                <TouchableOpacity
                  style={[
                    styles.confirmPill,
                    { backgroundColor: ui.surfaceVariant },
                  ]}
                  onPress={cancelPanel}
                >
                  <Text
                    style={[
                      styles.confirmPillLabel,
                      { color: ui.onSurfaceVariant },
                    ]}
                  >
                    Cancel
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.confirmPill,
                    { backgroundColor: ui.errorContainer },
                  ]}
                  onPress={confirmDeleteMessage}
                >
                  <Text
                    style={[
                      styles.confirmPillLabel,
                      { color: ui.onErrorContainer },
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
                  backgroundColor: ui.elevation3,
                  shadowColor: ui.shadow,
                  borderColor: ui.outlineVariant,
                  opacity: menuOpacity,
                  transform: [{ scale: menuScale }],
                },
              ]}
            >
              <Text
                style={[
                  styles.confirmTitle,
                  { color: ui.onSurface },
                ]}
              >
                Message info
              </Text>
              <Text
                style={[
                  styles.confirmBody,
                  { color: ui.onSurfaceVariant },
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
                    { backgroundColor: ui.primaryContainer },
                  ]}
                  onPress={cancelPanel}
                >
                  <Text
                    style={[
                      styles.confirmPillLabel,
                      { color: ui.onPrimaryContainer },
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
                  backgroundColor: ui.elevation3,
                  shadowColor: ui.shadow,
                  borderColor: ui.outlineVariant,
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
                  { backgroundColor: ui.outlineVariant },
                ]}
              />
              {/* MenuAction `icon` must be an explicit render function: the app
                  ships only material-design-icons, and Paper's default icon
                  renderer resolves MaterialCommunityIcons, which is absent -
                  a string prop here throws when the menu opens. */}
              <MenuAction
                icon={() => (
                  <MaterialDesignIcons
                    name="reply"
                    size={22}
                    color={ui.onSurfaceVariant}
                  />
                )}
                label="Reply"
                onPress={replyFromMenu}
              />
              {actionTarget.kind === 'text' && (
                <MenuAction
                  icon={() => (
                    <MaterialDesignIcons
                      name="content-copy"
                      size={22}
                      color={ui.onSurfaceVariant}
                    />
                  )}
                  label="Copy"
                  onPress={copyFromMenu}
                />
              )}
              <MenuAction
                icon={() => (
                  <MaterialDesignIcons
                    name="share-variant"
                    size={22}
                    color={ui.onSurfaceVariant}
                  />
                )}
                label="Forward"
                onPress={() => forwardMessageAction(actionTarget)}
              />
              <MenuAction
                icon={() => (
                  <MaterialDesignIcons
                    name="information-outline"
                    size={22}
                    color={ui.onSurfaceVariant}
                  />
                )}
                label="Info"
                onPress={showMessageInfo}
              />
              {actionTarget.senderId === user?._id && (
                <MenuAction
                  icon={() => (
                    <MaterialDesignIcons
                      name="delete-outline"
                      size={22}
                      color={ui.error}
                    />
                  )}
                  label="Delete"
                  color={ui.error}
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
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 4,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    marginLeft: 8,
  },
  headerAvatar: {
    marginVertical: 2,
  },
  headerAvatarInitials: {
    fontSize: 13,
    fontWeight: '700',
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
    marginLeft: 6,
  },
  senderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  senderAvatar: {
    marginBottom: 2,
  },
  senderInitials: {
    fontSize: 9,
    fontWeight: '700',
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
  },
  videoPoster: {
    ...StyleSheet.absoluteFillObject,
  },
  videoPosterFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoFallbackText: {
    fontSize: 12,
    marginTop: 4,
  },
  videoPlayOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPlayButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoChip: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    maxWidth: 190,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  videoChipText: {
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
    borderWidth: 1,
    paddingLeft: 6,
    paddingRight: 4,
    paddingVertical: 5,
    marginRight: 8,
    maxWidth: 250,
    minHeight: 38,
  },
  pendingThumb: {
    width: 28,
    height: 28,
    borderRadius: 10,
  },
  pendingIcon: {
    marginHorizontal: 6,
  },
  pendingInfo: {
    flex: 1,
    flexShrink: 1,
    marginHorizontal: 4,
  },
  pendingName: {
    fontSize: 13,
  },
  pendingStatus: {
    fontSize: 11,
    marginTop: 1,
  },
  pendingTrack: {
    height: 3,
    borderRadius: 2,
    marginTop: 4,
    overflow: 'hidden',
  },
  pendingFill: {
    height: 3,
    borderRadius: 2,
  },
  pendingAction: {
    padding: 4,
    marginLeft: 2,
  },
  pendingRemove: {
    padding: 4,
    marginLeft: 2,
  },
  modalBackdrop: {
    flex: 1,
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
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
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
  },
  viewerAudioWrap: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  viewerAudioName: {
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
  viewerErrorCard: {
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 28,
    alignItems: 'center',
    maxWidth: 320,
  },
  viewerLoading: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerRetryPill: {
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 9,
    marginTop: 18,
  },
  viewerRetryLabel: {
    fontSize: 14,
    fontWeight: '600',
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
