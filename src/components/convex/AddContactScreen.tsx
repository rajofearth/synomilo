import React, { useCallback, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useConvex } from 'convex/react';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';
import {
  ActivityIndicator,
  Button,
  HelperText,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';
import { api } from '../../../convex/_generated/api';
import { useSession } from '../../auth/SessionProvider';
import { convexErrorMessage } from '../../utils/convexError';
import UserAvatar from './UserAvatar';

/**
 * Shape of `convex/users.ts#findByUsername`. Re-declared rather than imported from
 * `_generated` because the generated module exports function references, not the
 * inferred argument/return types; this mirrors the projection it returns.
 */
type FoundUser = {
  _id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: number;
  hasConversation: boolean;
};

const normalize = (value: string): string => value.trim().toLowerCase();

/**
 * A message that leaked straight to the screen.
 *
 * `convex.query` does not reject with the error the server threw. It rejects with the
 * Convex client's own diagnostic for the query, built in `browser/logging.ts` as
 *
 *   `[CONVEX Q(users:findByUsername)] <server error message>\n  Called by client`
 *
 * and that is a plain `Error`, so it has no `ConvexError.data` to unwrap. The whole
 * thing is about 120 characters, which is inside `convexErrorMessage`'s 220-character
 * pass-through, so the helper handed it back verbatim and the screen rendered the
 * Convex plumbing in full underneath the search field.
 *
 * A `ConvexError` is the other case and is not this one: when the server throws one,
 * `.data` carries the copy a human wrote (`requireUser` sends "Your session has expired.
 * Please log in again."), and `convexErrorMessage` already returns exactly that.
 */
const looksLikeConvexDiagnostic = (text: string): boolean =>
  /\[CONVEX\b|Called by client|Uncaught\s+\w*Error:|^\s*at\s|node_modules/m.test(text);

/**
 * Transport wording, which is true but not something anyone can act on. React Native
 * surfaces these from the WebSocket layer itself, so they arrive as plain `Error`s with
 * no Convex prefix at all: `Network request failed`, `Failed to fetch`, or
 * `WebSocket is closed`. They get the caller's connection-flavoured fallback instead.
 */
const looksLikeTransportFailure = (text: string): boolean =>
  /network request failed|failed to fetch|websocket|connection (closed|failed|refused)|timed? ?out/i.test(
    text,
  );

/**
 * The last gate before a string is rendered.
 *
 * `convexErrorMessage` still does the reading, because it is what recovers the server's
 * own message out of a `ConvexError`, but anything that still reads as a stack, a
 * `[CONVEX …]` prefix or a node_modules path is replaced with the caller's own fallback,
 * as is transport wording. The screen can therefore never show copy that is about Convex
 * or about sockets rather than about the person who is using it.
 */
const friendlyError = (err: unknown, fallback: string): string => {
  const candidate = convexErrorMessage(err, '').trim();
  if (
    candidate.length > 0 &&
    !looksLikeConvexDiagnostic(candidate) &&
    !looksLikeTransportFailure(candidate)
  ) {
    return candidate;
  }
  return fallback;
};

const COPY = {
  signedOut: 'You are signed out. Sign in again to search for contacts.',
  tooShort: 'Enter a username of at least 2 characters.',
  thatIsYou: 'That is you. Search for someone else to start a chat.',
  searchOffline:
    'Could not reach the server. Check your connection and try again.',
  searchFailed: 'Could not search right now. Try again in a moment.',
  chatFailed: 'Could not open the chat. Check your connection and try again.',
};

/**
 * The single entry point to starting a conversation.
 *
 * Replaces the old `Users` tab (a full directory with a client-side filter) and the
 * `Groups` FAB. Both are gone; this is the only way in, by design. An address book
 * is a privacy problem and a navigation problem, and the app only needs to answer
 * "do I know this username?".
 *
 * `users.findByUsername` returns `null` for *every* negative answer, on purpose, so
 * "you searched for yourself" is detected here from the session's own username rather
 * than asked for. That keeps the endpoint from being an enumeration oracle.
 */
const AddContactScreen = ({ navigation }: any) => {
  const { colors } = useTheme();
  const { token, user } = useSession();
  const convex = useConvex();
  const createDM = useMutation(api.conversations.createDM);

  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [match, setMatch] = useState<FoundUser | null>(null);
  /** Has a search been submitted since the last edit? Drives the "not found" notice. */
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Guards against a slow search landing after the user has typed something else
   * and overwritten the result card with a stale person.
   */
  const searchSeq = useRef(0);

  const normalizedUsername = normalize(username);

  const submit = useCallback(async () => {
    const candidate = normalize(username);
    if (!token) {
      setError(COPY.signedOut);
      return;
    }
    if (candidate.length < 2) {
      setError(COPY.tooShort);
      return;
    }

    // The one case the server deliberately will not confirm for us.
    if (user && candidate === normalize(user.username)) {
      setMatch(null);
      setSearched(true);
      setError(COPY.thatIsYou);
      return;
    }

    const seq = ++searchSeq.current;
    setBusy(true);
    setError(null);
    setMatch(null);
    setSearched(true);
    try {
      const found = (await convex.query(api.users.findByUsername, {
        token,
        username: candidate,
      })) as FoundUser | null;
      if (seq !== searchSeq.current) {
        return;
      }
      setMatch(found);
    } catch (err) {
      if (seq !== searchSeq.current) {
        return;
      }
      setError(friendlyError(err, COPY.searchOffline));
    } finally {
      if (seq === searchSeq.current) {
        setBusy(false);
      }
    }
  }, [token, user, username, convex]);

  const openChat = useCallback(async () => {
    if (!token || !match || opening) {
      return;
    }
    setOpening(true);
    setError(null);
    try {
      // Idempotent on `dmKey`: returns the existing DM id when there is one and
      // creates it when there is not, so both button labels take this same path.
      const conversationId = await createDM({
        token,
        otherUserId: match._id as any,
      });
      navigation.replace('Messages', {
        conversationId,
        title: match.displayName,
      });
    } catch (err) {
      setError(friendlyError(err, COPY.chatFailed));
      setOpening(false);
    }
  }, [token, match, opening, createDM, navigation]);

  const reset = useCallback(() => {
    searchSeq.current += 1;
    setUsername('');
    setMatch(null);
    setSearched(false);
    setError(null);
    setBusy(false);
  }, []);

  /**
   * `submit`/`openChat` catch everything they can throw, so these two handlers should
   * be unreachable. They exist because an `async` callback handed to an event prop
   * still produces a promise, and an unhandled rejection on a Pressable is a crash,
   * which is exactly the silent-failure mode this screen must not have. If one ever
   * does fire it becomes a visible inline message instead of a red box.
   */
  const onSearch = useCallback(() => {
    submit().catch(err => {
      setError(friendlyError(err, COPY.searchFailed));
      setBusy(false);
    });
  }, [submit]);

  const onOpenChat = useCallback(() => {
    openChat().catch(err => {
      setError(friendlyError(err, COPY.chatFailed));
      setOpening(false);
    });
  }, [openChat]);

  const notFound = searched && !busy && !match && !error;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      {/**
       * The root stack sets `headerShown: false`, so this screen owns its own back
       * affordance. Without it the screen has no exit except the hardware back button.
       */}
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [
            styles.backButton,
            {
              backgroundColor: colors.surfaceVariant,
              opacity: pressed ? 0.6 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
          onPress={() => navigation.goBack()}
        >
          <MaterialDesignIcons
            name="arrow-left"
            size={22}
            color={colors.onSurface}
          />
        </Pressable>
        <Text variant="headlineMedium" style={styles.headerTitle}>
          Add contact
        </Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Text
            variant="bodyMedium"
            style={[styles.lede, { color: colors.onSurfaceVariant }]}
          >
            Enter the exact username of the person you want to chat with.
          </Text>

          <TextInput
            mode="outlined"
            label="Username"
            value={username}
            onChangeText={value => {
              setUsername(value);
              // Typing invalidates the previous answer; leaving the old card up
              // under a different name is how a search UI lies.
              searchSeq.current += 1;
              setMatch(null);
              setSearched(false);
              setBusy(false);
              setError(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            returnKeyType="search"
            onSubmitEditing={onSearch}
            editable={!busy && !opening}
            left={
              <TextInput.Icon
                icon={({ size, color }) => (
                  <MaterialDesignIcons
                    name="at"
                    size={size}
                    color={color}
                  />
                )}
              />
            }
            style={[styles.input, { backgroundColor: colors.surface }]}
            outlineStyle={styles.inputOutline}
            outlineColor={colors.outlineVariant}
            activeOutlineColor={colors.onSurface}
          />
          <HelperText type="error" visible={error !== null} padding="none">
            {error ?? ' '}
          </HelperText>

          <View style={styles.actions}>
            <Button
              mode="contained"
              onPress={onSearch}
              loading={busy}
              disabled={busy || opening || normalizedUsername.length < 2}
              style={styles.primaryAction}
              contentStyle={styles.pillContent}
              labelStyle={{ color: colors.onPrimary }}
            >
              Search
            </Button>
            {searched && !opening ? (
              <Button
                mode="text"
                onPress={reset}
                disabled={busy}
                textColor={colors.onSurfaceVariant}
              >
                Clear
              </Button>
            ) : null}
          </View>

          {notFound ? (
            <View
              style={[
                styles.notice,
                { backgroundColor: colors.surfaceVariant },
              ]}
            >
              <MaterialDesignIcons
                name="account-off-outline"
                size={20}
                color={colors.onSurfaceVariant}
              />
              <Text
                variant="bodyMedium"
                style={[styles.noticeText, { color: colors.onSurfaceVariant }]}
              >
                No user with that username.
              </Text>
            </View>
          ) : null}

          {match ? (
            <View
              style={[styles.card, { backgroundColor: colors.elevation.level1 }]}
            >
              <View
                style={[
                  styles.cardAvatar,
                  { backgroundColor: colors.primaryContainer },
                ]}
              >
                <UserAvatar
                  entity={match}
                  name={match.displayName}
                  size={56}
                  variant="text"
                  labelStyle={styles.cardInitials}
                  labelColor={colors.onPrimaryContainer}
                />
              </View>
              <View style={styles.cardBody}>
                <Text
                  variant="titleMedium"
                  numberOfLines={1}
                  style={{ color: colors.onSurface }}
                >
                  {match.displayName}
                </Text>
                <Text
                  variant="bodyMedium"
                  numberOfLines={1}
                  style={{ color: colors.onSurfaceVariant }}
                >
                  @{match.username}
                </Text>
              </View>
              <View
                style={[
                  styles.badge,
                  { backgroundColor: colors.surfaceVariant },
                ]}
              >
                <Text
                  variant="labelSmall"
                  style={{ color: colors.onSurfaceVariant }}
                >
                  {match.hasConversation ? 'Existing chat' : 'New contact'}
                </Text>
              </View>
              <Button
                mode="contained"
                icon={({ size, color }) => (
                  <MaterialDesignIcons
                    name="message-text-outline"
                    size={size}
                    color={color}
                  />
                )}
                onPress={onOpenChat}
                loading={opening}
                disabled={opening || busy}
                style={styles.cardAction}
                contentStyle={styles.pillContent}
                labelStyle={{ color: colors.onPrimary }}
              >
                {match.hasConversation ? 'Message' : 'Start chat'}
              </Button>
            </View>
          ) : null}

          {busy ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.onSurfaceVariant} />
              <Text
                variant="bodySmall"
                style={[styles.loadingText, { color: colors.onSurfaceVariant }]}
              >
                Searching…
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default AddContactScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
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
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
    gap: 4,
  },
  lede: {
    marginBottom: 12,
  },
  input: {
    borderRadius: 14,
  },
  inputOutline: {
    borderRadius: 14,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  primaryAction: {
    borderRadius: 24,
  },
  pillContent: {
    paddingVertical: 6,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
    padding: 14,
    borderRadius: 14,
  },
  noticeText: {
    flex: 1,
  },
  card: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: 16,
    padding: 14,
    borderRadius: 20,
    gap: 12,
  },
  cardAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInitials: {
    fontSize: 20,
    fontWeight: '700',
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  cardAction: {
    width: '100%',
    borderRadius: 24,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  },
  loadingText: {
    flex: 1,
  },
});