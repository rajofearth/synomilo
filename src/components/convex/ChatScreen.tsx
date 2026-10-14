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
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useTheme } from 'react-native-paper';
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

/**
 * Per-row state for a message this device has created but the server has not
 * confirmed yet.
 *
 * An optimistic row IS a `Message`, so it renders through exactly the same
 * bubble as a delivered one - only the tick, the progress readout and the
 * retry affordance differ. Nothing is ever queued "off to the side" where the
 * user cannot see it, which is what made a slow video look like it had vanished.
 */
type SendStatus = 'pending' | 'uploading' | 'sending' | 'sent' | 'failed';

type OutgoingFields = {
  /** Client id. Doubles as the optimistic `_id` so the list key is stable. */
  localId: string;
  /** `file://` of the picked bytes. Kept after the send so retry can re-read it. */
  localUri: string | null;
  /** Seconds, only known when the platform picker reported it. */
  durationSeconds: number | null;
  sendStatus: SendStatus;
  /** 0..1 when the transport reported a length, else null (indeterminate). */
  progress: number | null;
  error: string | null;
  replyToId: string | null;
  /** Server `_id`. Set the moment `sendMessage` resolves. */
  realId: string | null;
};

type OutgoingMessage = Message & OutgoingFields;

/**
 * The live query's serializer never emits `realId`, so its presence is a sound
 * and allocation-free discriminator between a server row and an optimistic
 * one - no second lookup table to keep in sync with the render.
 */
const asOutgoing = (message: Message): OutgoingMessage | null =>
  'realId' in message ? (message as OutgoingMessage) : null;

/** What the composer holds between picking and pressing send. */
type StagedAttachment = {
  id: string;
  uri: string;
  name: string;
  mimeType: string;
  size: number | null;
  kind: Message['kind'];
  durationSeconds: number | null;
};

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
 * `abort()` handle so discarding a failed send actually cancels the transfer
 * instead of letting a "deleted" attachment post itself later.
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
 * ExoPlayer buffer sizing for the viewer's single player.
 *
 * These are plain progressive HTTP reads. `bufferForPlaybackMs` is how much
 * media must be buffered before the first frame appears, so a low value starts
 * playback in about a second rather than pulling the whole asset first.
 * `maxBufferMs` sits well under the v6 default so a fast connection cannot
 * slurp the entire file into the forward buffer, and `backBufferDurationMs: 0`
 * stops a long clip pinning decoded memory behind the playhead.
 */
const STREAM_BUFFER = {
  minBufferMs: 15000,
  maxBufferMs: 30000,
  bufferForPlaybackMs: 1500,
  bufferForPlaybackAfterRebufferMs: 5000,
  backBufferDurationMs: 0,
};

type MediaTokens = {
  /** Translucent black in BOTH schemes: it sits over arbitrary video pixels. */
  backdrop: string;
  /**
   * Media chrome is drawn on the backdrop rather than on app surfaces. Paper has
   * no token that is light in both schemes, so the pair inverts together
   * (`inverseSurface` / `inverseOnSurface`) and stays legible in each one instead
   * of silently going invisible when dark mode flips the ramps.
   */
  pill: string;
  onPill: string;
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

/** Everything a bubble needs from the Paper palette, in one flat bag. */
type UiTokens = {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  onSecondaryContainer: string;
  background: string;
  surface: string;
  surfaceVariant: string;
  onSurface: string;
  onSurfaceVariant: string;
  outline: string;
  outlineVariant: string;
  error: string;
  errorContainer: string;
  onErrorContainer: string;
  elevation2: string;
  elevation3: string;
  backdrop: string;
  shadow: string;
};

/** The thin, honest progress line drawn under an in-flight send. */
const SendProgressBar = ({
  progress,
  ui,
}: {
  progress: number | null;
  ui: UiTokens;
}) => (
  <View style={[styles.sendTrack, { backgroundColor: ui.outlineVariant }]}>
    <View
      style={[
        styles.sendFill,
        {
          backgroundColor: ui.onSurfaceVariant,
          // No length known: a short muted segment, never a full bar - a full
          // bar would read as "done".
          width: progress == null ? '30%' : `${Math.round(progress * 100)}%`,
          opacity: progress == null ? 0.45 : 1,
        },
      ]}
    />
  </View>
);

/**
 * The scrim + badge that sits over a picture or a video card while its bytes
 * are still going up. Deterministic: it reads the same on every platform and
 * needs no thumbnail to exist yet.
 */
const SendProgressOverlay = ({
  progress,
  ui,
}: {
  progress: number | null;
  ui: UiTokens;
}) => (
  <View
    style={[
      StyleSheet.absoluteFill,
      styles.sendScrim,
      { backgroundColor: ui.backdrop },
    ]}
    pointerEvents="none"
  >
    <View style={[styles.sendBadge, { backgroundColor: ui.surface }]}>
      <MaterialDesignIcons
        name="cloud-upload-outline"
        size={20}
        color={ui.onSurfaceVariant}
      />
      <Text style={[styles.sendBadgeText, { color: ui.onSurfaceVariant }]}>
        {progress == null ? 'Uploading' : `${Math.round(progress * 100)}%`}
      </Text>
      <View style={[styles.sendTrack, { backgroundColor: ui.outlineVariant }]}>
        <View
          style={[
            styles.sendFill,
            {
              backgroundColor: ui.onSurface,
              width:
                progress == null ? '30%' : `${Math.round(progress * 100)}%`,
              opacity: progress == null ? 0.45 : 1,
            },
          ]}
        />
      </View>
    </View>
  </View>
);

/** Same scrim as the progress overlay, but says the send did not happen. */
const SendFailureOverlay = ({ ui }: { ui: UiTokens }) => (
  <View
    style={[
      StyleSheet.absoluteFill,
      styles.sendScrim,
      { backgroundColor: ui.backdrop },
    ]}
    pointerEvents="none"
  >
    <View style={[styles.sendBadge, { backgroundColor: ui.errorContainer }]}>
      <MaterialDesignIcons
        name="alert-circle-outline"
        size={22}
        color={ui.onErrorContainer}
      />
      <Text style={[styles.sendBadgeText, { color: ui.onErrorContainer }]}>
        Not sent
      </Text>
    </View>
  </View>
);

/**
 * A video message cell: a designed placeholder plus a play affordance.
 * Deliberately contains NO player, and deliberately does NOT point `<Image>`
 * at the asset.
 *
 * The old cell used the mp4's own storage URL as an `<Image>` poster "just in
 * case it decoded". On Android that hands the whole clip to Fresco/Glide, which
 * fetches every byte of it before failing to decode it as a picture - a real
 * full download triggered by simply scrolling the list. Nothing here renders an
 * image for a `video` kind now.
 *
 * The cell also mounts no decoder: a paused `<Video>` per row meant one
 * ExoPlayer per visible message and native views swallowing taps. Playback
 * happens in the viewer, which mounts exactly one player for the whole screen.
 */
const VideoAttachmentCell = ({
  fileName,
  size,
  durationSeconds,
  uploading,
  progress,
  ui,
  onPress,
}: {
  fileName: string | null;
  size: number | null;
  durationSeconds: number | null;
  uploading: boolean;
  progress: number | null;
  ui: UiTokens;
  onPress?: () => void;
}) => {
  const caption = [fileName, formatBytes(size) || null]
    .filter(Boolean)
    .join('  ·  ');
  const duration = formatDuration(durationSeconds);

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[styles.videoCard, { backgroundColor: ui.surfaceVariant }]}
      accessibilityRole="button"
      accessibilityLabel={`Play video${fileName ? `, ${fileName}` : ''}`}
    >
      <View
        style={[
          styles.videoPosterFallback,
          { backgroundColor: ui.surfaceVariant },
        ]}
        pointerEvents="none"
      >
        <MaterialDesignIcons name="movie" size={36} color={ui.onSurfaceVariant} />
        <Text
          style={[styles.videoFallbackText, { color: ui.onSurfaceVariant }]}
        >
          Video
        </Text>
      </View>
      <View style={styles.videoPlayOverlay} pointerEvents="none">
        <View
          style={[styles.videoPlayButton, { backgroundColor: ui.primary }]}
        >
          <MaterialDesignIcons name="play" size={26} color={ui.onPrimary} />
        </View>
      </View>
      <View style={styles.videoChipStack} pointerEvents="none">
        {!!duration && (
          <View style={[styles.videoChip, styles.videoChipFixed, { backgroundColor: ui.surface }]}>
            <Text style={[styles.videoChipText, { color: ui.onSurface }]}>
              {duration}
            </Text>
          </View>
        )}
        {!!caption && (
          <View style={[styles.videoChip, { backgroundColor: ui.surface }]}>
            <Text
              numberOfLines={1}
              style={[styles.videoChipText, { color: ui.onSurface }]}
            >
              {caption}
            </Text>
          </View>
        )}
      </View>
      {uploading && <SendProgressOverlay progress={progress} ui={ui} />}
    </Pressable>
  );
};

/** Distance past which a release counts as "reply", and how far it slides. */
const SWIPE_TRIGGER = 56;
const SWIPE_REACH = 68;
/** Vertical slop before the pan gives up and hands the gesture to the list. */
const SWIPE_Y_FAIL = 14;

/**
 * Horizontal swipe-to-reply, WhatsApp-style.
 *
 * Why it does not fight anything else on the row:
 *
 * - `activeOffsetX` is one-sided, so an incoming row only ever activates on a
 *   rightward drag and an outgoing row only on a leftward one. Dragging the
 *   "wrong" way never leaves the BEGAN state, so it never competes at all.
 * - `failOffsetY` fails the gesture the moment the finger strays vertically, so
 *   a scroll stays a scroll. The pan can never activate mid-fling.
 * - The pan only activates at `SWIPE_TRIGGER` of horizontal travel. A tap and a
 *   280 ms long press both complete with far less travel than that, so the inner
 *   `Pressable` keeps owning them and neither is cancelled.
 * - `translateX` runs on the native driver and the arrow only fades and scales,
 *   so a drag never crosses the bridge and never re-renders the list.
 */
const SwipeReply = ({
  direction,
  ui,
  onReply,
  disabled,
  children,
}: {
  direction: 'left' | 'right';
  ui: UiTokens;
  onReply: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) => {
  const translateX = useRef(new Animated.Value(0)).current;
  /** Live drag offset, so `onEnd` can decide without reading an Animated node. */
  const dragX = useRef(0);
  /** Latest callback, so a parent re-render never rebuilds the gesture. */
  const replyRef = useRef(onReply);
  replyRef.current = onReply;

  const reach = direction === 'right' ? SWIPE_REACH : -SWIPE_REACH;
  const reveal = translateX.interpolate({
    inputRange: direction === 'right' ? [0, SWIPE_REACH] : [-SWIPE_REACH, 0],
    outputRange: direction === 'right' ? [0, 1] : [1, 0],
    extrapolate: 'clamp',
  });

  const springTo = useCallback(
    (toValue: number, velocity: number, done?: () => void) => {
      Animated.spring(translateX, {
        toValue,
        velocity,
        stiffness: 240,
        damping: 26,
        mass: 0.8,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished && done) {
          done();
        }
      });
    },
    [translateX],
  );

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!disabled)
        .activeOffsetX(
          direction === 'right'
            ? [-99999, SWIPE_TRIGGER]
            : [-SWIPE_TRIGGER, 99999],
        )
        .failOffsetY([-SWIPE_Y_FAIL, SWIPE_Y_FAIL])
        // A native-driven spring is still running if the user grabs the row
        // again mid-settle; it must be stopped before we drive the value by hand.
        .onStart(() => {
          translateX.stopAnimation();
        })
        .onUpdate(event => {
          dragX.current = event.translationX;
          translateX.setValue(event.translationX);
        })
        .onEnd((event, success) => {
          const travelled = dragX.current;
          dragX.current = 0;
          if (!success || Math.abs(travelled) < SWIPE_TRIGGER) {
            springTo(0, event.velocityX);
            return;
          }
          // Slide out, fire, slide back. The reply bar is already up by the
          // time the bubble returns, so the row never rests open and stale.
          springTo(reach, event.velocityX, () => {
            replyRef.current();
            springTo(0, 0);
          });
        })
        .onFinalize((_event, success) => {
          if (!success) {
            dragX.current = 0;
            springTo(0, 0);
          }
        }),
    [direction, disabled, reach, springTo, translateX],
  );

  return (
    <View
      style={[
        styles.swipeRow,
        direction === 'right' ? styles.swipeRowStart : styles.swipeRowEnd,
      ]}
    >
      <Animated.View
        style={[
          styles.swipeAffordance,
          direction === 'right'
            ? styles.swipeAffordanceStart
            : styles.swipeAffordanceEnd,
          { opacity: reveal, transform: [{ scale: reveal }] },
        ]}
        pointerEvents="none"
      >
        <View
          style={[styles.swipeArrow, { backgroundColor: ui.primaryContainer }]}
        >
          <MaterialDesignIcons
            name="reply"
            size={22}
            color={ui.onPrimaryContainer}
          />
        </View>
      </Animated.View>
      <GestureDetector gesture={gesture}>
        <Animated.View style={{ transform: [{ translateX }] }}>
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
};

/**
 * The viewer's transport bar. Built here rather than using the player's own
 * controls because the native set differs per platform (iOS has no fullscreen
 * affordance at all), while this one is identical everywhere and draws only
 * from the Paper palette.
 */
const ViewerControls = ({
  paused,
  current,
  duration,
  fullscreen,
  media,
  onToggle,
  onToggleFullscreen,
}: {
  paused: boolean;
  current: number;
  duration: number;
  fullscreen: boolean;
  media: MediaTokens;
  onToggle: () => void;
  onToggleFullscreen: () => void;
}) => {
  const ratio = duration > 0 ? Math.min(1, Math.max(0, current / duration)) : 0;
  return (
    <View style={[styles.viewerControls, { backgroundColor: media.pill }]}>
      <Pressable
        onPress={onToggle}
        style={[styles.viewerControlButton, { backgroundColor: media.onPill }]}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={paused ? 'Play' : 'Pause'}
      >
        <MaterialDesignIcons
          name={paused ? 'play' : 'pause'}
          size={22}
          color={media.pill}
        />
      </Pressable>
      <Text style={[styles.viewerControlTime, { color: media.onPill }]}>
        {formatDuration(current) || '0:00'}
      </Text>
      <View
        style={[styles.viewerControlTrack, { backgroundColor: media.onPill }]}
      >
        <View
          style={[
            styles.viewerControlFill,
            {
              backgroundColor: media.pill,
              width: `${Math.round(ratio * 100)}%`,
            },
          ]}
        />
      </View>
      <Text style={[styles.viewerControlTime, { color: media.onPill }]}>
        {formatDuration(duration)}
      </Text>
      <Pressable
        onPress={onToggleFullscreen}
        style={styles.viewerControlIcon}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
      >
        <MaterialDesignIcons
          name={fullscreen ? 'fullscreen-exit' : 'fullscreen'}
          size={22}
          color={media.onPill}
        />
      </Pressable>
    </View>
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
  /**
   * A ready-made node, not an icon name: the app ships only
   * material-design-icons, so every caller passes the element it wants rather
   * than a string some other renderer would have to resolve.
   */
  icon: React.ReactNode;
  label: string;
  color?: string;
  onPress: () => void;
};

const MenuAction = ({ icon, label, color, onPress }: MenuActionProps) => {
  const paper = useTheme();
  return (
    <TouchableOpacity
      style={styles.menuAction}
      activeOpacity={0.7}
      onPress={onPress}
    >
      {icon}
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
  const paper = useTheme();
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
  /** Picked but not yet sent. Nothing here touches the network. */
  const [draft, setDraft] = useState<StagedAttachment[]>([]);
  /** Rows this device has created and not yet seen come back from Convex. */
  const [outgoing, setOutgoing] = useState<OutgoingMessage[]>([]);
  const [viewer, setViewer] = useState<{ message: Message } | null>(null);
  /** 'ready' | 'error' | 'loading' for the ONE player mounted in the viewer. */
  const [viewerMedia, setViewerMedia] = useState<{
    status: 'loading' | 'ready' | 'error';
    nonce: number;
  }>({ status: 'loading', nonce: 0 });
  /** Transport for that same player. The own controls render from these. */
  const [viewerPlayback, setViewerPlayback] = useState({
    paused: false,
    current: 0,
    duration: 0,
    buffering: false,
  });
  const [viewerFullscreen, setViewerFullscreen] = useState(false);
  const menuScale = useRef(new Animated.Value(0.8)).current;
  const menuOpacity = useRef(new Animated.Value(0)).current;
  const listRef = useRef<FlatList<Message>>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** localId -> in-flight XHR, so a retry or discard can *abort* the transfer. */
  const uploadsRef = useRef(new Map<string, XMLHttpRequest>());
  /** localIds the user discarded; their transfer's result must be ignored. */
  const cancelledRef = useRef(new Set<string>());
  /** localIds with a `runSend` promise outstanding; stops double-starts. */
  const inFlightRef = useRef(new Set<string>());
  /** Read inside `runSend` so a re-render never orphans a send. */
  const outgoingRef = useRef<OutgoingMessage[]>([]);
  const mountedRef = useRef(true);
  outgoingRef.current = outgoing;

  /**
   * Every colour this screen draws with, resolved once per theme change.
   *
   * All of it comes from Paper's monochrome palette, and only Paper's. The
   * The legacy UIKit theme is a static snapshot taken when that SDK initialised,
   * so reading `theme.color.*` from it meant the chat kept its original light
   * ramp after the app switched schemes.
   */
  const ui = useMemo<UiTokens>(() => {
    const c = theme.colors;
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
  }, [theme.colors]);

  /**
   * Faces, not full Paper text styles. `theme.fonts.*` carries its own
   * `fontSize`/`lineHeight`, and letting those through would fight the per-row
   * sizes in `styles` (a 10px timestamp set on Paper's 20px line height is a
   * badly kerned mess). Family and weight are what we actually wanted.
   */
  const type = useMemo(() => {
    const f = theme.fonts;
    const face = (
      variant: 'headlineMedium' | 'bodyMedium' | 'labelMedium' | 'labelSmall',
    ) => ({
      fontFamily: f[variant].fontFamily,
      fontWeight: f[variant].fontWeight,
    });
    return {
      heading: face('headlineMedium'),
      body: face('bodyMedium'),
      caption: face('labelMedium'),
      captionSmall: face('labelSmall'),
    };
  }, [theme.fonts]);

  /**
   * Media chrome, which sits on top of arbitrary video pixels rather than on
   * app surfaces. `backdrop` is Paper's scrim - translucent black in both
   * schemes - and everything drawn on it uses the inverse pair, which inverts
   * together and therefore stays legible in each.
   */
  const media = useMemo<MediaTokens>(
    () => ({
      backdrop: theme.colors.scrim,
      pill: theme.colors.inverseSurface,
      onPill: theme.colors.inverseOnSurface,
    }),
    [theme.colors],
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

  /**
   * Server rows newest-first, with this device's own in-flight rows merged in.
   *
   * Reconciliation, in one sentence: `sendMessage` resolves with the server's
   * `_id`, that id is stamped onto the optimistic row as `realId`, and the row
   * is dropped the moment - and only the moment - the live query actually
   * delivers a message carrying that id. Waiting for the real row rather than
   * dropping on resolve is what removes the flicker between "sent" and "the row
   * Convex sent back"; matching on the server id rather than on body or
   * timestamp is what makes it impossible to pair the wrong rows up.
   */
  const messages = useMemo<Message[]>(() => {
    const server = [...(thread?.messages ?? [])].reverse();
    const serverIds = new Set<string>(server.map(row => row._id));
    const extras = outgoing
      .filter(row => row.realId == null || !serverIds.has(row.realId))
      .sort((a, b) => b.createdAt - a.createdAt);
    if (extras.length === 0) {
      return server;
    }
    // A stable merge rather than a full sort: server rows keep their existing
    // order even when two share a millisecond, and only the extras move.
    const merged: Message[] = [];
    let i = 0;
    for (const row of server) {
      while (i < extras.length && extras[i].createdAt >= row.createdAt) {
        merged.push(extras[i]);
        i += 1;
      }
      merged.push(row);
    }
    while (i < extras.length) {
      merged.push(extras[i]);
      i += 1;
    }
    return merged;
  }, [thread, outgoing]);

  const receipts = useMemo<Receipt[]>(
    () => ((thread as any)?.receipts ?? []) as Receipt[],
    [thread],
  );

  /**
   * Reclaim optimistic rows the server has already echoed back.
   *
   * `messages` stops rendering them the instant the real row arrives; this only
   * drops the object itself, so `outgoing` cannot grow for the whole life of the
   * screen. Runs after the render that hid them, never before, which is why the
   * handover is not visible.
   */
  useEffect(() => {
    if (outgoing.length === 0 || !thread) {
      return;
    }
    const confirmed = new Set(
      outgoing
        .filter(row => row.realId != null)
        .map(row => row.realId as string),
    );
    if (confirmed.size === 0) {
      return;
    }
    const landed = new Set(
      (thread.messages ?? [])
        .map(row => row._id as string)
        .filter(id => confirmed.has(id)),
    );
    if (landed.size === 0) {
      return;
    }
    setOutgoing(prev =>
      prev.filter(row => row.realId == null || !landed.has(row.realId)),
    );
  }, [thread, outgoing]);

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

  /**
   * Patch exactly one in-flight row. Functional, and keyed, so N parallel
   * uploads cannot clobber each other's progress or failure.
   */
  const patchOutgoing = useCallback(
    (localId: string, patch: Partial<OutgoingFields>) => {
      setOutgoing(prev =>
        prev.map(row => (row.localId === localId ? { ...row, ...patch } : row)),
      );
    },
    [],
  );

  /**
   * Build the optimistic row that appears the instant the user presses send.
   *
   * It carries a real timestamp, the real sender and the real reply preview, so
   * what the user sees IS the message that is about to exist - not a spinner
   * standing in for one.
   */
  const makeOutgoing = useCallback(
    (
      kind: Message['kind'],
      body: string,
      createdAt: number,
      replyToId: string | null,
      item?: StagedAttachment,
    ): OutgoingMessage => {
      const localId = nextPendingId();
      const me = user;
      return {
        _id: localId,
        conversationId,
        senderId: me?._id ?? '',
        sender: {
          _id: me?._id ?? '',
          displayName: me?.displayName ?? 'You',
          username: me?.username ?? '',
          avatarUrl: me?.avatarUrl ?? null,
        },
        kind,
        body: body || null,
        fileName: item?.name ?? null,
        mimeType: item?.mimeType ?? null,
        size: item?.size ?? null,
        storageId: null,
        deletedAt: null,
        forwardedFrom: null,
        replyTo: replyTarget
          ? {
              _id: replyTarget._id,
              body: replyTarget.body,
              kind: replyTarget.kind,
              deletedAt: replyTarget.deletedAt,
              senderName:
                replyTarget.senderId === me?._id
                  ? 'You'
                  : replyTarget.sender.displayName,
            }
          : null,
        fileUrl: null,
        createdAt,
        reactions: [],
        localId,
        localUri: item?.uri ?? null,
        durationSeconds: item?.durationSeconds ?? null,
        sendStatus: item ? 'pending' : 'sending',
        progress: null,
        error: null,
        replyToId,
        realId: null,
      };
    },
    [conversationId, replyTarget, user],
  );

  /**
   * Upload (when there are bytes) and create one optimistic row, then leave.
   *
   * Fire-and-forget on purpose. It resolves against `sendMessage`'s returned
   * id, which is the only reconciliation handle that can be trusted; the row it
   * stamps is then retired by `messages` the moment Convex delivers the real
   * one. Failures land on the row as `failed`, never in an alert and never in
   * a silent drop - the user's words and bytes stay on screen either way.
   */
  const runSend = useCallback(
    async (localId: string, prebuilt?: OutgoingMessage) => {
      const row =
        prebuilt ?? outgoingRef.current.find(item => item.localId === localId);
      if (
        !row ||
        !token ||
        cancelledRef.current.has(localId) ||
        inFlightRef.current.has(localId)
      ) {
        return;
      }
      inFlightRef.current.add(localId);
      let lastPaint = 0;
      try {
        // The row is passed in as well as looked up: `onSend` starts these in
        // the same tick as the `setOutgoing` that created them.
        if (row.kind === 'text') {
          patchOutgoing(localId, { sendStatus: 'sending', error: null });
          const realId = await sendMessage({
            token,
            conversationId: conversationId as any,
            body: row.body as string,
            replyToId: (row.replyToId ?? undefined) as any,
          });
          patchOutgoing(localId, { sendStatus: 'sent', realId, error: null });
          return;
        }

        patchOutgoing(localId, {
          sendStatus: 'uploading',
          progress: null,
          error: null,
        });
        const mime = row.mimeType || 'application/octet-stream';
        const postUrl = await generateUploadUrl({ token });
        const blob = await uriToBlob(row.localUri as string);
        if (cancelledRef.current.has(localId)) {
          return;
        }
        const { storageId } = await postWithProgress(
          postUrl,
          mime,
          blob,
          fraction => {
            // Throttle: a 300 KB image fires hundreds of progress events and
            // each one would re-render the whole message list.
            const now = Date.now();
            if (now - lastPaint < 150 && fraction < 1) {
              return;
            }
            lastPaint = now;
            patchOutgoing(localId, { progress: fraction });
          },
          xhr => {
            uploadsRef.current.set(localId, xhr);
          },
        );
        uploadsRef.current.delete(localId);
        if (cancelledRef.current.has(localId)) {
          return;
        }
        patchOutgoing(localId, { sendStatus: 'sending', progress: 1 });
        const realId = await sendMessage({
          token,
          conversationId: conversationId as any,
          kind: row.kind,
          // Convex storage returns the id as a plain string over the wire.
          storageId: storageId as any,
          fileName: row.fileName || 'file',
          mimeType: mime,
          size: row.size ?? undefined,
          replyToId: (row.replyToId ?? undefined) as any,
        });
        patchOutgoing(localId, { sendStatus: 'sent', realId, progress: 1 });
      } catch (error) {
        uploadsRef.current.delete(localId);
        if (cancelledRef.current.has(localId) || !mountedRef.current) {
          return;
        }
        // No Alert: a modal would block exactly the conversation the user is
        // trying to carry on with. The bubble turns into an inline retry.
        patchOutgoing(localId, {
          sendStatus: 'failed',
          error: convexErrorMessage(error, 'Could not send the message.'),
        });
        // A failed text send must not cost the user their words. They stay
        // visible on the failed bubble, and are handed back to an EMPTY
        // composer as well - a composer the user has already started typing in
        // is never touched.
        if (row.kind === 'text' && row.body) {
          setText(prev =>
            prev.trim().length === 0 ? (row.body as string) : prev,
          );
        }
      } finally {
        inFlightRef.current.delete(localId);
      }
    },
    [token, conversationId, generateUploadUrl, sendMessage, patchOutgoing],
  );

  /** Drop a failed row for good. Aborts the transfer too. */
  const discardOutgoing = useCallback((localId: string) => {
    // Cancel the transfer as well as dropping the row: otherwise discarding
    // mid-upload still posts the bytes and posts a message the user believes
    // they deleted.
    cancelledRef.current.add(localId);
    const xhr = uploadsRef.current.get(localId);
    uploadsRef.current.delete(localId);
    try {
      xhr?.abort();
    } catch {}
    setOutgoing(prev => prev.filter(row => row.localId !== localId));
  }, []);

  const retryOutgoing = useCallback(
    (localId: string) => {
      const row = outgoingRef.current.find(item => item.localId === localId);
      if (!row) {
        return;
      }
      cancelledRef.current.delete(localId);
      patchOutgoing(localId, {
        sendStatus: row.kind === 'text' ? 'sending' : 'pending',
        progress: null,
        error: null,
      });
      runSend(localId, row);
    },
    [patchOutgoing, runSend],
  );

  /**
   * Send whatever is in the composer, and clear it immediately.
   *
   * Nothing here awaits the network. The bubbles exist before this returns, the
   * send button is never disabled while anything is in flight, and a second
   * message can be composed while the first is still uploading.
   */
  const onSend = useCallback(() => {
    const body = text.trim();
    const staged = draft;
    // Media-only is a valid send: the bubble is just the attachment, with no
    // empty caption under it.
    if ((!body && staged.length === 0) || !token) {
      return;
    }
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
    }
    setTyping({
      token,
      conversationId: conversationId as any,
      typing: false,
    }).catch(() => {});

    // A reply to a row the server has not confirmed yet has no id to quote, so
    // it is dropped rather than sent as a bogus one the mutation would reject.
    const replyToId =
      replyTarget && asOutgoing(replyTarget) === null ? replyTarget._id : null;

    // Consecutive milliseconds keep the batch in the order it was picked.
    const now = Date.now();
    const rows: OutgoingMessage[] = [];
    if (body) {
      rows.push(makeOutgoing('text', body, now, replyToId));
    }
    // A caption stays on its own text message, exactly as before, so three
    // picked photos do not all repeat the same sentence.
    staged.forEach((item, index) => {
      rows.push(makeOutgoing(item.kind, '', now + index + 1, replyToId, item));
    });

    setOutgoing(prev => [...rows, ...prev]);
    setText('');
    setDraft([]);
    setReplyTarget(null);
    rows.forEach(row => {
      cancelledRef.current.delete(row.localId);
      runSend(row.localId, row);
    });
  }, [text, draft, token, conversationId, replyTarget, makeOutgoing, runSend, setTyping]);

  const removeDraft = useCallback((id: string) => {
    setDraft(prev => prev.filter(item => item.id !== id));
  }, []);

  /** Picking only stages. Nothing reaches the network until send is pressed. */
  const stageDraft = useCallback((items: StagedAttachment[]) => {
    if (items.length === 0) {
      return;
    }
    setDraft(prev => [...prev, ...items]);
  }, []);

  const pickPhoto = useCallback(async () => {
    setAttachOpen(false);
    const result = await launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: 0,
    });
    stageDraft(
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
  }, [stageDraft]);

  const pickVideo = useCallback(async () => {
    setAttachOpen(false);
    const result = await launchImageLibrary({
      mediaType: 'video',
      selectionLimit: 0,
    });
    stageDraft(
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
  }, [stageDraft]);

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
      stageDraft(additions);
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
  }, [stageDraft]);

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
    // the next photo, and a new item must not inherit a stale error, a stale
    // playhead or a fullscreen window left over from the last clip.
    setViewerMedia({ status: 'loading', nonce: Date.now() });
    setViewerPlayback({ paused: false, current: 0, duration: 0, buffering: false });
    setViewerFullscreen(false);
    setViewer({ message });
  }, []);

  const closeViewer = useCallback(() => {
    // Dropping `viewer` unmounts the <Video>; there is exactly one player in
    // this tree and it lives only inside the viewer.
    setViewer(null);
    setViewerFullscreen(false);
  }, []);

  const reloadViewerMedia = useCallback(() => {
    setViewerMedia({ status: 'loading', nonce: Date.now() });
    setViewerPlayback({ paused: false, current: 0, duration: 0, buffering: false });
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
      /**
       * This device's own row that Convex has not echoed back yet. It is a real
       * `Message` in every other respect, so nothing below needs a second
       * rendering path - it just has a progress readout instead of a tick.
       */
      const local = asOutgoing(item);
      const inFlight =
        !!local &&
        (local.sendStatus === 'pending' ||
          local.sendStatus === 'uploading' ||
          local.sendStatus === 'sending');
      const failed = local?.sendStatus === 'failed';
      /**
       * Reacting to, deleting or forwarding an unconfirmed row would send a
       * client id where the mutation wants a server id. Those affordances stay
       * suppressed until the row lands; the swipe still works and is resolved
       * at send time instead.
       */
      const actionable = !deleted && local === null;
      // `actionable` already excludes optimistic rows, so a tick here always
      // means a row the server has confirmed.
      const tick = mine && actionable ? tickFor(item) : null;

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
      // Nothing to open until the bytes are on the server and there is a
      // signed URL to open them with.
      const openMedia = item.fileUrl ? () => openViewer(item) : undefined;
      // Taken before the media branch so the flow-narrowing it performs cannot
      // leak into the progress bar's condition below.
      const isImage = item.kind === 'image';
      const isVideo = item.kind === 'video';
      // A picture and a video carry their progress on the media itself; text,
      // files and voice notes get the thin bar under the content instead.
      const showInlineProgress = inFlight && !isImage && !isVideo;

      const bubble = (
        <Pressable
          onLongPress={
            actionable
              ? e => {
                  const { pageX, pageY } = e.nativeEvent;
                  setMenuAnchor({ x: pageX, y: pageY });
                  setActionTarget(item);
                }
              : undefined
          }
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
          {!mine && isGroup && actionable && (
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
                style={[type.caption, styles.senderName, { color: ui.primary }]}
              >
                {item.sender.displayName}
              </Text>
            </View>
          )}
          {!!item.forwardedFrom && actionable && (
            <View style={styles.forwardedRow}>
              <MaterialDesignIcons
                name="share"
                size={12}
                color={bubbleMuted}
              />
              <Text
                style={[
                  type.captionSmall,
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
                style={[type.body, styles.deletedText, { color: bubbleMuted }]}
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
                    style={[type.caption, { color: ui.onSurface }]}
                  >
                    {item.replyTo.senderName}
                  </Text>
                  <Text
                    numberOfLines={2}
                    style={[type.caption, { color: ui.onSurfaceVariant }]}
                  >
                    {item.replyTo.deletedAt
                      ? 'Deleted message'
                      : item.replyTo.body ??
                        attachmentLabel(item.replyTo.kind)}
                  </Text>
                </Pressable>
              )}
              {item.kind === 'image' && local?.localUri ? (
                // The bytes are still on this device: show them, dimmed, with
                // the transfer progress on top. Never a blank grey box.
                <View style={styles.imageFrame}>
                  <Image
                    source={{ uri: local.localUri }}
                    style={styles.imageAttachment}
                    resizeMode="cover"
                  />
                  {inFlight && (
                    <SendProgressOverlay progress={local.progress} ui={ui} />
                  )}
                  {failed && <SendFailureOverlay ui={ui} />}
                </View>
              ) : isImage && item.fileUrl ? (
                <Pressable
                  onPress={openMedia}
                  accessibilityRole="button"
                  accessibilityLabel="Open photo"
                >
                  <Image
                    source={{ uri: item.fileUrl }}
                    style={styles.imageAttachment}
                    resizeMode="cover"
                  />
                </Pressable>
              ) : isVideo ? (
                <VideoAttachmentCell
                  fileName={item.fileName}
                  size={item.size}
                  durationSeconds={local?.durationSeconds ?? null}
                  uploading={inFlight}
                  progress={local?.progress ?? null}
                  ui={ui}
                  onPress={openMedia}
                />
              ) : item.kind !== 'text' ? (
                <Pressable onPress={openMedia} style={styles.fileRow}>
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
                      style={[type.body, { color: bubbleText }]}
                    >
                      {item.fileName ?? 'Attachment'}
                    </Text>
                    {!!formatBytes(item.size) && (
                      <Text style={[type.caption, { color: bubbleMuted }]}>
                        {formatBytes(item.size)}
                      </Text>
                    )}
                  </View>
                </Pressable>
              ) : null}
              {/* A picture and a video carry their progress on the media
                  itself; text, files and voice notes get the thin bar here. */}
              {showInlineProgress && (
                <SendProgressBar progress={local?.progress ?? null} ui={ui} />
              )}
              {!!item.body && (
                <Text
                  style={[type.body, styles.bubbleText, { color: bubbleText }]}
                >
                  {item.body}
                </Text>
              )}
              {failed && !!local?.error && (
                <Text
                  numberOfLines={2}
                  style={[
                    type.captionSmall,
                    styles.bubbleError,
                    { color: bubbleMuted },
                  ]}
                >
                  {local.error}
                </Text>
              )}
            </>
          )}
          <View style={styles.bubbleTimeRow}>
            <Text
              style={[
                type.captionSmall,
                styles.bubbleTime,
                { color: timeColor },
              ]}
            >
              {dayjs(item.createdAt).format('h:mm A')}
            </Text>
            {inFlight && (
              <MaterialDesignIcons
                name="cloud-upload-outline"
                size={13}
                color={bubbleMuted}
                style={styles.bubbleTick}
              />
            )}
            {tick && (
              <MaterialDesignIcons
                name={tickIcon}
                size={tickSize}
                color={tickColor}
                style={styles.bubbleTick}
              />
            )}
            {failed && local && (
              <>
                <Pressable
                  onPress={() => retryOutgoing(local.localId)}
                  style={styles.bubbleRetry}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Retry sending this message"
                >
                  <MaterialDesignIcons
                    name="refresh"
                    size={13}
                    color={ui.onErrorContainer}
                  />
                  <Text
                    style={[
                      styles.bubbleRetryLabel,
                      { color: ui.onErrorContainer },
                    ]}
                  >
                    Retry
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => discardOutgoing(local.localId)}
                  style={styles.bubbleDiscard}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Discard this message"
                >
                  <MaterialDesignIcons
                    name="close"
                    size={13}
                    color={bubbleMuted}
                  />
                </Pressable>
              </>
            )}
          </View>
        </Pressable>
      );

      return (
        <View>
          {showDay && (
            <View style={styles.daySeparatorWrap}>
              <Text
                style={[
                  type.caption,
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
            <SwipeReply
              direction={mine ? 'left' : 'right'}
              ui={ui}
              disabled={deleted}
              onReply={() => setReplyTarget(item)}
            >
              {bubble}
            </SwipeReply>

            {item.reactions.length > 0 && actionable && (
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
                          type.caption,
                          {
                            color: reaction.mine
                              ? ui.onSurface
                              : ui.onSurfaceVariant,
                          },
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
      type,
      ui,
      applyReaction,
      openViewer,
      messages,
      highlightId,
      scrollToMessage,
      tickFor,
      retryOutgoing,
      discardOutgoing,
    ],
  );

  const isSubscribed = thread !== undefined;
  // The send button depends on the DRAFT only. A 40 MB video is already in the
  // list uploading by the time this is true, so it can never disable sending a
  // second message - which is the whole point of the optimistic flow.
  const canSend = !!text.trim() || draft.length > 0;
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
                type.heading,
                styles.headerTitle,
                { color: ui.onSurface },
              ]}
            >
              {conversation?.title ?? fallbackTitle}
            </Text>
          {typingNames && typingNames.length > 0 ? (
            <Text
              numberOfLines={1}
              style={[
                type.caption,
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
                type.caption,
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
                  type.body,
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
        {draft.length > 0 && (
          <View
            style={[
              styles.draftBar,
              {
                backgroundColor: ui.surface,
                borderTopColor: ui.outlineVariant,
              },
            ]}
          >
            <FlatList
              horizontal
              data={draft}
              extraData={draft}
              keyExtractor={item => item.id}
              showsHorizontalScrollIndicator={false}
              style={styles.draftList}
              renderItem={({ item }) => {
                // No progress here: nothing has left the device yet. The
                // platform picker knows how long a picked video is, which is
                // the only place that number can be shown.
                const duration = formatDuration(item.durationSeconds);
                const size = formatBytes(item.size);
                const detail = [duration, size].filter(Boolean).join('  ·  ');
                return (
                  <View
                    style={[
                      styles.draftChip,
                      {
                        backgroundColor: ui.surfaceVariant,
                        borderColor: ui.outlineVariant,
                      },
                    ]}
                  >
                    {item.kind === 'image' ? (
                      <Image source={{ uri: item.uri }} style={styles.draftThumb} />
                    ) : (
                      <MaterialDesignIcons
                        name={pendingIconName(item.kind)}
                        size={20}
                        color={ui.onSurfaceVariant}
                        style={styles.draftIcon}
                      />
                    )}
                    <View style={styles.draftInfo}>
                      <Text
                        numberOfLines={1}
                        style={[styles.draftName, { color: ui.onSurface }]}
                      >
                        {item.name}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[styles.draftDetail, { color: ui.onSurfaceVariant }]}
                      >
                        {detail || 'Ready to send'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => removeDraft(item.id)}
                      style={styles.draftRemove}
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
                  type.caption,
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
                  type.caption,
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
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            <MaterialDesignIcons name="send" size={18} color={ui.onPrimary} />
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
                  type.body,
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
                  type.body,
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
                  type.body,
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
          style={[styles.viewerBackdrop, { backgroundColor: media.backdrop }]}
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
                      viewerFullscreen
                        ? [
                            styles.viewerFullscreen,
                            { backgroundColor: media.backdrop },
                          ]
                        : viewerMediaKind === 'video'
                          ? [
                              styles.viewerVideo,
                              {
                                width: viewerWidth,
                                height: viewerHeight,
                                backgroundColor: media.backdrop,
                              },
                            ]
                          : styles.viewerAudioPlayer
                    }
                  >
                    {/*
                      The ONE and only <Video> in this file. It mounts when a
                      playable item is opened and unmounts when the viewer closes
                      or a non-playable item is shown, so a previously-viewed clip
                      never keeps a decoder (and its audio focus) alive.

                      `source` is the plain https URL Convex storage hands out.
                      Nothing here fetches, blobs or base64s the file first -
                      that round trip is what forced a full download before the
                      first frame. `bufferConfig` keeps ExoPlayer streaming.
                      `controls` is off so play/pause, the scrubber and the
                      fullscreen toggle below are identical on both platforms.
                    */}
                    <Video
                      key={`${viewer.message._id}:${viewerMedia.nonce}`}
                      source={{
                        uri: viewer.message.fileUrl as string,
                        bufferConfig: STREAM_BUFFER,
                      }}
                      style={StyleSheet.absoluteFill}
                      controls={false}
                      paused={viewerPlayback.paused}
                      resizeMode="contain"
                      repeat={false}
                      onLoad={event => {
                        setViewerMedia(prev =>
                          prev.status === 'loading'
                            ? { ...prev, status: 'ready' }
                            : prev,
                        );
                        setViewerPlayback(prev =>
                          event.duration > 0
                            ? { ...prev, duration: event.duration }
                            : prev,
                        );
                      }}
                      onProgress={event =>
                        setViewerPlayback(prev =>
                          prev.current === event.currentTime
                            ? prev
                            : { ...prev, current: event.currentTime },
                        )
                      }
                      onBuffer={event =>
                        setViewerPlayback(prev =>
                          prev.buffering === event.isBuffering
                            ? prev
                            : { ...prev, buffering: event.isBuffering },
                        )
                      }
                      onEnd={() =>
                        setViewerPlayback(prev => ({
                          ...prev,
                          paused: true,
                          current: 0,
                        }))
                      }
                      onError={() =>
                        setViewerMedia({ status: 'error', nonce: Date.now() })
                      }
                    />
                    {/* Buffering is a spinner on a legible surface, never a
                        black rectangle and never an invisible one. */}
                    {(viewerMedia.status === 'loading' ||
                      viewerPlayback.buffering) && (
                      <View
                        style={[StyleSheet.absoluteFill, styles.viewerLoading]}
                        pointerEvents="none"
                      >
                        <View
                          style={[
                            styles.viewerSpinnerBadge,
                            { backgroundColor: media.pill },
                          ]}
                        >
                          <ActivityIndicator
                            color={media.onPill}
                            size="large"
                          />
                        </View>
                      </View>
                    )}
                  </View>
                )
              ) : viewer.message.kind === 'audio' ? (
                <View
                  style={[styles.viewerAudioCard, { backgroundColor: ui.elevation2 }]}
                >
                  <MaterialDesignIcons
                    name="music-note"
                    size={72}
                    color={ui.onSurfaceVariant}
                  />
                  <Text
                    numberOfLines={2}
                    style={[styles.viewerAudioName, { color: ui.onSurface }]}
                  >
                    {viewer.message.fileName ?? 'Voice note'}
                  </Text>
                  <Text
                    style={[styles.viewerFileMeta, { color: ui.onSurfaceVariant }]}
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
              {/* Play/pause, scrubber and fullscreen for the one player. */}
              {viewerMediaKind && viewerMedia.status !== 'error' && (
                <View
                  style={[
                    styles.viewerControlsWrap,
                    {
                      bottom: viewerFullscreen ? insets.bottom + 12 : 20,
                      shadowColor: ui.shadow,
                    },
                  ]}
                >
                  <ViewerControls
                    paused={viewerPlayback.paused}
                    current={viewerPlayback.current}
                    duration={viewerPlayback.duration}
                    fullscreen={viewerFullscreen}
                    media={media}
                    onToggle={() =>
                      setViewerPlayback(prev => ({ ...prev, paused: !prev.paused }))
                    }
                    onToggleFullscreen={() => setViewerFullscreen(prev => !prev)}
                  />
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
              {/* `icon` is an explicit element, not a name: the app ships only
                  material-design-icons, and Paper's default icon renderer
                  resolves MaterialCommunityIcons, which is absent. */}
              <MenuAction
                icon={
                  <MaterialDesignIcons
                    name="reply"
                    size={22}
                    color={ui.onSurfaceVariant}
                  />
                }
                label="Reply"
                onPress={replyFromMenu}
              />
              {actionTarget.kind === 'text' && (
                <MenuAction
                  icon={
                    <MaterialDesignIcons
                      name="content-copy"
                      size={22}
                      color={ui.onSurfaceVariant}
                    />
                  }
                  label="Copy"
                  onPress={copyFromMenu}
                />
              )}
              <MenuAction
                icon={
                  <MaterialDesignIcons
                    name="share-variant"
                    size={22}
                    color={ui.onSurfaceVariant}
                  />
                }
                label="Forward"
                onPress={() => forwardMessageAction(actionTarget)}
              />
              <MenuAction
                icon={
                  <MaterialDesignIcons
                    name="information-outline"
                    size={22}
                    color={ui.onSurfaceVariant}
                  />
                }
                label="Info"
                onPress={showMessageInfo}
              />
              {actionTarget.senderId === user?._id && (
                <MenuAction
                  icon={
                    <MaterialDesignIcons
                      name="delete-outline"
                      size={22}
                      color={ui.error}
                    />
                  }
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
  headerTitle: {
    fontSize: 18,
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
  bubbleError: {
    marginTop: 4,
  },
  bubbleRetry: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 6,
  },
  bubbleRetryLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 3,
  },
  bubbleDiscard: {
    padding: 2,
    marginLeft: 4,
  },
  imageFrame: {
    alignSelf: 'flex-start',
  },
  sendScrim: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBadge: {
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 108,
  },
  sendBadgeText: {
    fontSize: 12,
    marginTop: 4,
    marginBottom: 5,
  },
  sendTrack: {
    height: 3,
    alignSelf: 'stretch',
    borderRadius: 2,
    overflow: 'hidden',
  },
  sendFill: {
    height: 3,
    borderRadius: 2,
  },
  swipeRow: {
    flexDirection: 'row',
  },
  swipeRowStart: {
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
  },
  swipeRowEnd: {
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
  },
  swipeAffordance: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  swipeAffordanceStart: {
    left: 0,
  },
  swipeAffordanceEnd: {
    right: 0,
  },
  swipeArrow: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
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
  videoChipStack: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  videoChip: {
    flexShrink: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  // A duration is short and must never be squeezed out by a long filename.
  videoChipFixed: {
    flexShrink: 0,
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
  draftBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  draftList: {
    flexGrow: 0,
  },
  draftChip: {
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
  draftThumb: {
    width: 28,
    height: 28,
    borderRadius: 10,
  },
  draftIcon: {
    marginHorizontal: 6,
  },
  draftInfo: {
    flex: 1,
    flexShrink: 1,
    marginHorizontal: 4,
  },
  draftName: {
    fontSize: 13,
  },
  draftDetail: {
    fontSize: 11,
    marginTop: 1,
  },
  draftRemove: {
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
  viewerFullscreen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  viewerAudioCard: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 28,
  },
  viewerAudioName: {
    fontSize: 17,
    marginTop: 16,
    marginBottom: 20,
    textAlign: 'center',
  },
  viewerControlsWrap: {
    position: 'absolute',
    left: 20,
    right: 20,
    borderRadius: 26,
    elevation: 6,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  viewerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 26,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  viewerControlButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerControlTime: {
    fontSize: 11,
    marginHorizontal: 8,
    minWidth: 38,
    textAlign: 'center',
  },
  viewerControlTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  viewerControlFill: {
    height: 4,
    borderRadius: 2,
  },
  viewerControlIcon: {
    padding: 8,
  },
  viewerSpinnerBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
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
