import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery } from 'convex/react';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';
import { launchImageLibrary } from 'react-native-image-picker';
import dayjs from 'dayjs';
import {
  ActivityIndicator,
  Button,
  Dialog,
  HelperText,
  Portal,
  Snackbar,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';
import { api } from '../../../convex/_generated/api';
import { useSession } from '../../auth/SessionProvider';
import { convexErrorMessage } from '../../utils/convexError';
import { useAppLock } from '../security/AppLock';
import UserAvatar from './UserAvatar';

const uriToBlob = (uri: string): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => resolve(xhr.response);
    xhr.onerror = () => reject(new Error('Could not read the selected photo'));
    xhr.responseType = 'blob';
    xhr.open('GET', uri, true);
    xhr.send();
  });

/**
 * The page size of `calls.history`. The Calls tab reads the same query with the
 * same arguments, so this number has to match its default or the two screens
 * would fetch two different pages of the same history.
 */
const HISTORY_LIMIT = 50;

/**
 * Rendered while a count is genuinely unknown, i.e. the query has not answered
 * yet. Deliberately not "0": a zero here would be a claim about the account
 * that has not been made yet. `SettingsScreen` says the same thing with
 * "Checking..." for battery optimisation.
 */
const PENDING = '…';

/**
 * Only the fields this page counts. Both queries are read elsewhere with
 * identical arguments - `ConversationsList` and `Calls` respectively - so a
 * second reader is a cache hit, not a second trip to the server.
 */
type ConversationCount = {
  _id: string;
  type: 'dm' | 'group';
  unreadCount: number;
};

type CallCount = {
  _id: string;
  status: 'ringing' | 'active' | 'rejected' | 'missed' | 'ended';
  durationMs: number | null;
  createdAt: number;
};

type CallHistory = {
  calls?: CallCount[];
  hasMore?: boolean;
};

/**
 * A call that rang and was not answered, counted the way `Calls.tsx` labels
 * one: a decline and a no-answer are both "missed" to the person who missed it.
 */
const isMissed = (status: CallCount['status']): boolean =>
  status === 'missed' || status === 'rejected';

const formatDuration = (ms: number): string => {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) {
    return 'Under a minute';
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
};

const formatJoined = (ts: number): string => dayjs(ts).format('D MMM YYYY');

const formatLastCall = (ts: number): string => {
  const now = dayjs();
  const d = dayjs(ts);
  if (d.isSame(now, 'day')) {
    return `Today, ${d.format('h:mm A')}`;
  }
  if (d.isSame(now.subtract(1, 'day'), 'day')) {
    return `Yesterday, ${d.format('h:mm A')}`;
  }
  if (d.isSame(now, 'year')) {
    return d.format('D MMM, h:mm A');
  }
  return d.format('D MMM YYYY');
};

/**
 * One row, one rhythm.
 *
 * `SettingsScreen` has a `SettingRow` for exactly this shape, but it is module
 * private and this job is not allowed to change that file. So this is the same
 * component written out again: 36pt icon plate, title, optional value, an
 * optional chevron only when the row is tappable, and hairline dividers
 * indented to 48 so they start where the text starts.
 *
 * `rowBody` carries `minWidth: 0` and `flex: 1` together, which is the guard
 * the row needs and had before: a flex child in a row keeps `flexShrink: 0` by
 * default in React Native, so without an explicit basis the long value pushes
 * the chevron off the right edge of a narrow screen.
 *
 * A row with no `onPress` renders a plain `View`, not a disabled `Pressable`.
 * A disabled control announces itself as disabled, which is a claim about
 * something the user cannot do; a fact about the account is just text.
 */
const InfoRow = ({
  icon,
  title,
  value,
  onPress,
}: {
  icon: string;
  title: string;
  value?: string;
  onPress?: () => void;
}) => {
  const { colors } = useTheme();
  const label = value ? `${title}, ${value}` : title;
  const body = (
    <>
      <View style={[styles.icon, { backgroundColor: colors.surfaceVariant }]}>
        <MaterialDesignIcons
          name={icon as never}
          size={20}
          color={colors.onSurfaceVariant}
        />
      </View>
      <View style={styles.rowBody}>
        <Text
          variant="bodyLarge"
          numberOfLines={1}
          style={{ color: colors.onSurface }}
        >
          {title}
        </Text>
        {value ? (
          <Text
            variant="bodyMedium"
            numberOfLines={2}
            ellipsizeMode="tail"
            style={{ color: colors.onSurfaceVariant }}
          >
            {value}
          </Text>
        ) : null}
      </View>
      {onPress != null ? (
        <MaterialDesignIcons
          name="chevron-right"
          size={20}
          color={colors.outline}
        />
      ) : null}
    </>
  );

  if (onPress == null) {
    return (
      <View
        style={styles.row}
        accessible
        accessibilityRole="text"
        accessibilityLabel={label}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {body}
    </Pressable>
  );
};

/**
 * One number, one label, centred in a third of the strip.
 *
 * The three tiles are `flex: 1` with `minWidth: 0` so they divide the width
 * equally at 320pt as well as on a tablet, and the whole tile is one
 * accessibility node: a screen reader says "12 chats", not the icon name and
 * then the number and then the label.
 */
const StatTile = ({
  icon,
  label,
  value,
  accessibilityLabel,
}: {
  icon: string;
  label: string;
  value: string;
  accessibilityLabel: string;
}) => {
  const { colors } = useTheme();
  return (
    <View
      style={styles.statTile}
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
    >
      <MaterialDesignIcons
        name={icon as never}
        size={18}
        color={colors.onSurfaceVariant}
      />
      <Text
        variant="headlineSmall"
        numberOfLines={1}
        style={[styles.statValue, { color: colors.onSurface }]}
      >
        {value}
      </Text>
      <Text
        variant="labelSmall"
        numberOfLines={1}
        style={[styles.statLabel, { color: colors.onSurfaceVariant }]}
      >
        {label}
      </Text>
    </View>
  );
};

/**
 * A tab root, so there is no back arrow.
 *
 * Profile used to be a stack screen pushed from the Chats header avatar, which meant it
 * rendered an `Appbar.BackAction` that went nowhere once it became a tab. The header is
 * now a plain title row with the single contextual action (edit), and the identity block
 * that used to be repeated as an "Account" list is the hero instead.
 *
 * This screen is about the person and nothing else. The app card (version, platform) and
 * the links card (GitHub, source, email) live in `SettingsScreen`, where a version
 * already lives.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY TEXT NODE ON THIS PAGE IS BOUNDED AND ELLIPSISED  (the clipping fix)
 * ---------------------------------------------------------------------------
 *
 * The username used to be a bare `<Text>` inside a hero with
 * `alignItems: 'center'`, and a centred child is laid out at its own content
 * width. Android will not break a run of characters that has no break
 * opportunity in it, and a 32-character username - the schema maximum,
 * `validateUsername` in `convex/lib/helpers.ts` - is 32 unbroken characters.
 * The content column on a 320pt screen is 320 - 2 x 16 = 288pt, so the line
 * painted past the box, past the gutter, and off the screen, where the
 * ScrollView cut it. The display name at `headlineSmall` is allowed 40
 * characters (`convex/users.ts`) and did it more often.
 *
 * That was one half of it. The other half is that the page never declared how
 * wide it was: `styles.content` was padding and nothing else, and not one row
 * on the screen carried a shrink guard - `rowTitle` was `flex: 1` with no
 * `minWidth: 0`, and the fixed-width furniture around it had no `flexShrink:
 * 0`, which is the arrangement `ConversationsList.tsx:331` explicitly avoids.
 * A page with no declared width and no guards has no reliable right edge, and
 * the last row of the column - the sign-out button - is where that shows.
 *
 * So every text node is now bounded three ways: `maxWidth: '100%'` so the box
 * cannot exceed the content column, `numberOfLines` so the line count is
 * finite, and `ellipsizeMode` so truncation is a deliberate ellipsis rather
 * than glyphs running off the edge. The handle ellipsises in the *middle*,
 * because the first and last characters of a username are the two that let you
 * recognise it, and tail truncation is exactly what chopped it.
 */
const ProfileScreen = ({ navigation }: any) => {
  const theme = useTheme();
  const { colors } = theme;
  const { user, token, signOut } = useSession();
  const updateProfile = useMutation(api.users.updateProfile);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);

  const [editing, setEditing] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [usernameDraft, setUsernameDraft] = useState('');
  const [avatarDraft, setAvatarDraft] = useState<string | null>(null);
  const [pendingAvatarStorageId, setPendingAvatarStorageId] = useState<any>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [signOutVisible, setSignOutVisible] = useState(false);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const lockStatus = useAppLock(state => state.status);
  const lockEnabled = useAppLock(state => state.enabled);
  const lockPinSet = useAppLock(state => state.pinSet);
  const lockAvailability = useAppLock(state => state.availability);
  const refreshLock = useAppLock(state => state.refresh);

  /**
   * The lock state is read from the encrypted store, not from this component,
   * so it has to be re-read whenever the user can have changed it. Settings is
   * the only place the flag is written and it is a stack route pushed on top of
   * this tab, so 'focus' is the moment the answer can have changed.
   */
  useEffect(() => {
    refreshLock().catch(() => {});
    const subscription = navigation.addListener?.('focus', () => {
      refreshLock().catch(() => {});
    });
    return () => subscription?.remove?.();
  }, [navigation, refreshLock]);

  const conversations = useQuery(
    api.conversations.list,
    token ? { token } : 'skip',
  ) as ConversationCount[] | undefined;
  const history = useQuery(
    api.calls.history,
    token ? { token } : 'skip',
  ) as CallHistory | undefined;

  const uploadedAvatarUrl = useQuery(
    api.files.url,
    token && pendingAvatarStorageId
      ? { token, storageId: pendingAvatarStorageId }
      : 'skip',
  );

  useEffect(() => {
    if (!pendingAvatarStorageId || uploadedAvatarUrl === undefined) {
      return;
    }
    if (uploadedAvatarUrl) {
      setAvatarDraft(uploadedAvatarUrl);
    } else {
      setSnackbar('Could not load the uploaded photo');
    }
    setPendingAvatarStorageId(null);
    setUploadingAvatar(false);
  }, [uploadedAvatarUrl, pendingAvatarStorageId]);

  const displayName = user?.displayName ?? 'Unknown';
  const username = user?.username ?? 'unknown';

  /**
   * Chats, groups and unread, from one pass over the conversation list.
   *
   * All three are counts of rows the query already returned: no inferred
   * denominator, nothing summed that is not a row. "People" was the obvious
   * third tile and it was cut: the only per-person id in this query is
   * `otherUserId`, which is set for a DM and null for a group, so it cannot
   * answer "how many people am I in a room with" without double counting anyone
   * who is in two groups. Better to show a number that is exact.
   */
  const chatStats = useMemo(() => {
    if (conversations === undefined) {
      return null;
    }
    let groups = 0;
    let unread = 0;
    for (const row of conversations) {
      if (row.type === 'group') {
        groups += 1;
      }
      unread += row.unreadCount;
    }
    return { chats: conversations.length, groups, unread };
  }, [conversations]);

  /**
   * Call facts, from the same page the Calls tab is showing.
   *
   * `capped` is the honest part: when the history is longer than the page this
   * screen read, the numbers describe the most recent `HISTORY_LIMIT` calls and
   * the rows say so rather than implying they are a lifetime total.
   */
  const callStats = useMemo(() => {
    if (history === undefined) {
      return null;
    }
    const calls = history.calls ?? [];
    let missed = 0;
    let talkMs = 0;
    let lastAt = 0;
    for (const call of calls) {
      if (isMissed(call.status)) {
        missed += 1;
      }
      if (call.durationMs && call.durationMs > 0) {
        talkMs += call.durationMs;
      }
      if (call.createdAt > lastAt) {
        lastAt = call.createdAt;
      }
    }
    return {
      total: calls.length,
      missed,
      talkMs,
      lastAt,
      capped: history.hasMore === true,
    };
  }, [history]);

  const openEdit = useCallback(() => {
    setDisplayNameDraft(displayName);
    setUsernameDraft(username);
    setAvatarDraft(null);
    setEditing(true);
  }, [displayName, username]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setAvatarDraft(null);
    setPendingAvatarStorageId(null);
    setUploadingAvatar(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!token || saving || uploadingAvatar) {
      return;
    }
    setSaving(true);
    try {
      await updateProfile({
        token,
        displayName: displayNameDraft,
        username: usernameDraft,
        avatarUrl: avatarDraft ?? undefined,
      });
      setEditing(false);
      setSnackbar('Profile updated');
    } catch (error) {
      setSnackbar(convexErrorMessage(error, 'Could not update the profile'));
    } finally {
      setSaving(false);
    }
  }, [
    token,
    saving,
    uploadingAvatar,
    updateProfile,
    displayNameDraft,
    usernameDraft,
    avatarDraft,
  ]);

  const pickAvatar = useCallback(async () => {
    if (!token || uploadingAvatar) {
      return;
    }
    const result = await launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: 1,
    });
    const asset = result.assets?.[0];
    if (!asset?.uri) {
      return;
    }
    setUploadingAvatar(true);
    try {
      const postUrl = await generateUploadUrl({ token });
      const blob = await uriToBlob(asset.uri);
      const mime = asset.type ?? 'image/jpeg';
      const response = await fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': mime },
        body: blob,
      });
      const { storageId } = await response.json();
      setPendingAvatarStorageId(storageId);
    } catch (error) {
      setUploadingAvatar(false);
      setSnackbar(convexErrorMessage(error, 'Could not upload the photo'));
    }
  }, [token, uploadingAvatar, generateUploadUrl]);

  const handleSignOut = useCallback(() => {
    setSignOutVisible(false);
    signOut().catch(() => {});
  }, [signOut]);

  const card = {
    backgroundColor: colors.elevation.level1,
    borderRadius: 20,
  };

  const nameText = editing ? displayNameDraft || displayName : displayName;
  const handleText = editing ? usernameDraft || username : username;
  const joinedAt = user?.createdAt ?? 0;
  const showJoined = Number.isFinite(joinedAt) && joinedAt > 0;

  const chatsValue = chatStats === null ? PENDING : String(chatStats.chats);
  const groupsValue = chatStats === null ? PENDING : String(chatStats.groups);
  const unreadValue = chatStats === null ? PENDING : String(chatStats.unread);

  const cappedSuffix = callStats?.capped ? ` · last ${HISTORY_LIMIT}` : '';
  const callsValue = useMemo(() => {
    if (callStats === null) {
      return PENDING;
    }
    const missedPart = callStats.missed > 0 ? ` · ${callStats.missed} missed` : '';
    return `${callStats.total} call${callStats.total === 1 ? '' : 's'}${missedPart}${cappedSuffix}`;
  }, [callStats, cappedSuffix]);

  const talkValue = useMemo(() => {
    if (callStats === null) {
      return PENDING;
    }
    return `${formatDuration(callStats.talkMs)}${cappedSuffix}`;
  }, [callStats, cappedSuffix]);

  const lastCallValue = useMemo(() => {
    if (callStats === null) {
      return PENDING;
    }
    return callStats.lastAt > 0 ? formatLastCall(callStats.lastAt) : 'No calls yet';
  }, [callStats]);

  /**
   * Straight from the lock store, so this cannot disagree with Settings. The
   * four states are the store's own: never read yet, no encrypted store on
   * this platform, a store that cannot be read, and a store that can.
   */
  const lockDescription = (() => {
    if (lockStatus === 'unknown') {
      return 'Checking…';
    }
    if (lockStatus === 'storeBroken') {
      return 'On, but this device can no longer read its secure storage';
    }
    if (!lockEnabled) {
      return 'Off';
    }
    if (lockAvailability?.available && lockPinSet) {
      return 'On, biometrics with a PIN fallback';
    }
    if (lockAvailability?.available) {
      return 'On, biometrics';
    }
    return 'On, PIN only';
  })();

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      <View style={styles.header}>
        <Text
          variant="headlineMedium"
          style={styles.headerTitle}
          numberOfLines={1}
          accessibilityRole="header"
        >
          Profile
        </Text>
        <Pressable
          style={({ pressed }) => [
            styles.headerAction,
            {
              backgroundColor: editing ? colors.primary : colors.surfaceVariant,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={editing ? 'Save profile' : 'Edit profile'}
          hitSlop={8}
          disabled={editing && (saving || uploadingAvatar)}
          onPress={editing ? handleSave : openEdit}
        >
          <MaterialDesignIcons
            name={editing ? 'check' : 'pencil-outline'}
            size={20}
            color={editing ? colors.onPrimary : colors.onSurfaceVariant}
          />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/**
         * The identity block is the whole of "who am I" in this app. It used to also
         * exist twice more as an ACCOUNT list and a "Signed in as @..." caption; both
         * were the same two values a second and third time.
         *
         * `maxWidth: '100%'` on both lines is the width bound; `numberOfLines` and
         * `ellipsizeMode` are what make the bound visible instead of clipping glyphs.
         */}
        <View style={styles.hero}>
          <Pressable
            onPress={editing ? pickAvatar : undefined}
            disabled={!editing || uploadingAvatar}
            accessibilityRole={editing ? 'button' : undefined}
            accessibilityLabel={editing ? 'Change profile photo' : undefined}
          >
            <UserAvatar
              entity={user}
              name={displayName}
              override={avatarDraft}
              size={112}
              variant="paper"
              initialsStyle={{
                backgroundColor: colors.primaryContainer,
                borderRadius: 56,
              }}
              labelColor={colors.onPrimaryContainer}
              labelStyle={styles.heroInitials}
            />
            {editing ? (
              <View
                style={[
                  styles.cameraBadge,
                  {
                    backgroundColor: colors.primary,
                    borderColor: colors.background,
                  },
                ]}
              >
                {uploadingAvatar ? (
                  <ActivityIndicator size={14} color={colors.onPrimary} />
                ) : (
                  <MaterialDesignIcons
                    name="camera"
                    size={16}
                    color={colors.onPrimary}
                  />
                )}
              </View>
            ) : null}
          </Pressable>
          <Text
            variant="headlineSmall"
            style={styles.heroName}
            numberOfLines={2}
            ellipsizeMode="tail"
            accessibilityRole="header"
            accessibilityLabel={`Display name, ${nameText}`}
          >
            {nameText}
          </Text>
          <Text
            variant="bodyMedium"
            numberOfLines={1}
            ellipsizeMode="middle"
            accessibilityLabel={`Username ${handleText}`}
            style={[
              styles.heroHandle,
              { color: colors.onSurfaceVariant },
            ]}
          >
            @{handleText}
          </Text>
        </View>

        {editing ? (
          <View style={[styles.card, card, styles.editCard]}>
            <Text
              variant="labelLarge"
              style={styles.sectionLabel}
              accessibilityRole="header"
            >
              DISPLAY DETAILS
            </Text>
            <TextInput
              mode="outlined"
              label="Display name"
              value={displayNameDraft}
              onChangeText={setDisplayNameDraft}
              style={styles.input}
              outlineStyle={styles.inputOutline}
              outlineColor={colors.outlineVariant}
              activeOutlineColor={colors.onSurface}
            />
            <TextInput
              mode="outlined"
              label="Username"
              value={usernameDraft}
              onChangeText={setUsernameDraft}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              outlineStyle={styles.inputOutline}
              outlineColor={colors.outlineVariant}
              activeOutlineColor={colors.onSurface}
            />
            {/**
             * This describes `users.updateProfile`, which accepts 3 to 20 of
             * [a-z0-9_]. Registration (`validateUsername` in
             * `convex/lib/helpers.ts`) is looser: 3 to 32, and dots and dashes
             * too. So a 32-character handle can exist on an account and can be
             * read here, but cannot be typed back into this field. Fixing that
             * is a `convex/users.ts` change and is deliberately out of this
             * screen's hands.
             */}
            <HelperText type="info" padding="none" visible>
              Username: 3 to 20 characters, a-z, 0-9 and _.
            </HelperText>
            <View style={styles.editActions}>
              <Button
                mode="text"
                textColor={colors.onSurfaceVariant}
                disabled={saving}
                onPress={cancelEdit}
              >
                Cancel
              </Button>
              <Button
                mode="contained"
                style={styles.saveButton}
                contentStyle={styles.pillContent}
                loading={saving}
                disabled={saving || uploadingAvatar || !token}
                onPress={handleSave}
                labelStyle={{ color: colors.onPrimary }}
              >
                Save
              </Button>
            </View>
          </View>
        ) : (
          <>
            {/**
             * Three real numbers about the account, in the space the hero
             * leaves empty. Every tile is filled from a query that another tab
             * is already running, and a value that has not arrived reads as an
             * ellipsis rather than as a zero.
             */}
            <View style={[styles.statStrip, card]}>
              <StatTile
                icon="message-text-outline"
                label="Chats"
                value={chatsValue}
                accessibilityLabel={`${chatsValue === PENDING ? 'Chats, still loading' : `${chatsValue} chats`}`}
              />
              <View
                style={[styles.statDivider, { backgroundColor: colors.outlineVariant }]}
              />
              <StatTile
                icon="account-group-outline"
                label="Groups"
                value={groupsValue}
                accessibilityLabel={`${groupsValue === PENDING ? 'Groups, still loading' : `${groupsValue} group chats`}`}
              />
              <View
                style={[styles.statDivider, { backgroundColor: colors.outlineVariant }]}
              />
              <StatTile
                icon="email-outline"
                label="Unread"
                value={unreadValue}
                accessibilityLabel={`${unreadValue === PENDING ? 'Unread, still loading' : `${unreadValue} unread messages`}`}
              />
            </View>

            {/**
             * Sections below follow `SettingsScreen`: an uppercase label, a
             * card of rows, hairline dividers indented to the text. Values that
             * are facts about the account carry no chevron, so the chevron means
             * exactly one thing: pressing this goes somewhere.
             */}
            {showJoined ? (
              <View style={[styles.card, card]}>
                <Text
                  variant="labelLarge"
                  style={styles.sectionLabel}
                  accessibilityRole="header"
                >
                  ACCOUNT
                </Text>
                <InfoRow
                  icon="calendar-outline"
                  title="Member since"
                  value={formatJoined(joinedAt)}
                />
              </View>
            ) : null}

            <View style={[styles.card, card]}>
              <Text
                variant="labelLarge"
                style={styles.sectionLabel}
                accessibilityRole="header"
              >
                CALLS
              </Text>
              <InfoRow
                icon="phone-outline"
                title="Recent calls"
                value={callsValue}
              />
              <View
                style={[styles.divider, { backgroundColor: colors.outlineVariant }]}
              />
              <InfoRow
                icon="timer-sand"
                title="Time talking"
                value={talkValue}
              />
              {callStats !== null && callStats.lastAt > 0 ? (
                <>
                  <View
                    style={[styles.divider, { backgroundColor: colors.outlineVariant }]}
                  />
                  <InfoRow
                    icon="clock-outline"
                    title="Last call"
                    value={lastCallValue}
                    onPress={() => navigation.navigate('Calls')}
                  />
                </>
              ) : null}
            </View>

            {/**
             * The one row that leads out of the tab and comes back changed.
             * Settings owns every lock control, so this is a shortcut into it
             * rather than a second editor, and the value it shows is read from
             * the same store Settings writes to.
             */}
            {lockStatus !== 'unsupported' ? (
              <View style={[styles.card, card]}>
                <Text
                  variant="labelLarge"
                  style={styles.sectionLabel}
                  accessibilityRole="header"
                >
                  SECURITY
                </Text>
                <InfoRow
                  icon="shield-lock-outline"
                  title="App lock"
                  value={lockDescription}
                  onPress={() => navigation.navigate('Settings')}
                />
              </View>
            ) : null}

            {/**
             * Appearance is informational: the app has no theme override to
             * set, it reads the OS scheme (`src/theme/useAppTheme.ts`), so this
             * row states what is in force and offers no chevron to go and change
             * something that cannot be changed here.
             */}
            <View style={[styles.card, card]}>
              <Text
                variant="labelLarge"
                style={styles.sectionLabel}
                accessibilityRole="header"
              >
                APP
              </Text>
              <InfoRow
                icon="theme-light-dark"
                title="Appearance"
                value={
                  theme.dark
                    ? 'Dark, following your device'
                    : 'Light, following your device'
                }
              />
              <View
                style={[styles.divider, { backgroundColor: colors.outlineVariant }]}
              />
              <InfoRow
                icon="cog-outline"
                title="Settings"
                onPress={() => navigation.navigate('Settings')}
              />
            </View>

            {/**
             * `alignSelf: 'stretch'` is the default for a child of the content
             * column, so this says it out loud: the button spans the content
             * column exactly, and nothing about its label can move its edges.
             */}
            <Button
              mode="outlined"
              icon={({ size, color }) => (
                <MaterialDesignIcons name="logout" size={size} color={color} />
              )}
              style={[styles.signOutButton, styles.stretch]}
              contentStyle={styles.pillContent}
              textColor={colors.onSurface}
              accessibilityLabel="Sign out"
              onPress={() => setSignOutVisible(true)}
            >
              Sign out
            </Button>
          </>
        )}
      </ScrollView>

      <Portal>
        <Dialog
          visible={signOutVisible}
          onDismiss={() => setSignOutVisible(false)}
          style={{ backgroundColor: colors.elevation.level3 }}
        >
          <Dialog.Title style={{ color: colors.onSurface }}>
            Sign out
          </Dialog.Title>
          <Dialog.Content>
            <Text style={{ color: colors.onSurfaceVariant }}>
              Are you sure you want to sign out?
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button
              textColor={colors.onSurfaceVariant}
              onPress={() => setSignOutVisible(false)}
            >
              Cancel
            </Button>
            <Button textColor={colors.onSurface} onPress={handleSignOut}>
              Sign out
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar
        visible={snackbar !== null}
        onDismiss={() => setSnackbar(null)}
        duration={3000}
      >
        {snackbar ?? ''}
      </Snackbar>
    </SafeAreaView>
  );
};

export default ProfileScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
  },
  headerAction: {
    width: 40,
    height: 40,
    borderRadius: 20,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 12,
  },
  hero: {
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 20,
  },
  heroInitials: {
    fontSize: 38,
    fontWeight: '700',
  },
  heroName: {
    marginTop: 20,
    marginBottom: 4,
    maxWidth: '100%',
    textAlign: 'center',
  },
  /**
   * The clipping bug lived here. `maxWidth: '100%'` bounds the box to the
   * content column and `textAlign` keeps it centred inside that bound instead
   * of hanging off the left edge.
   */
  heroHandle: {
    maxWidth: '100%',
    textAlign: 'center',
  },
  cameraBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  statStrip: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: 14,
  },
  statTile: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 4,
  },
  statValue: {
    fontWeight: '700',
  },
  statLabel: {
    letterSpacing: 0.6,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
  },
  editCard: {
    paddingVertical: 14,
  },
  sectionLabel: {
    paddingTop: 12,
    paddingBottom: 4,
    opacity: 0.6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * `flex: 1` without `minWidth: 0` leaves a text column that can out-grow
   * the row and push the trailing chevron off the right edge.
   */
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 48,
  },
  input: {
    marginTop: 8,
    backgroundColor: 'transparent',
  },
  inputOutline: {
    borderRadius: 14,
  },
  editActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
  saveButton: {
    borderRadius: 24,
  },
  pillContent: {
    paddingVertical: 6,
  },
  signOutButton: {
    borderRadius: 24,
  },
  stretch: {
    alignSelf: 'stretch',
  },
});