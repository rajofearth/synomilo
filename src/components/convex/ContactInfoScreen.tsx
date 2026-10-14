import React, { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery } from 'convex/react';
import {
  ActivityIndicator,
  Appbar,
  Button,
  Divider,
  List,
  Text,
  useTheme,
} from 'react-native-paper';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';
import { api } from '../../../convex/_generated/api';
import { useSession } from '../../auth/SessionProvider';
import { convexErrorMessage } from '../../utils/convexError';
import UserAvatar from './UserAvatar';

/**
 * Colours come from react-native-paper's theme, never from a second theme system.
 *
 * The UIKit theme is frozen at `App.tsx`'s first render — one palette is handed to both
 * its `light` and `dark` slots — so anything reading it never follows the OS scheme.
 * Paper's `PaperProvider` is rebuilt from `useColorScheme()`, so it does. This file used
 * to read `theme.color.*` (UIKit) for its background and text and `theme.colors.*`
 * (Paper) for its buttons, which is why switching the phone to light mode left this
 * screen looking exactly the same while the rest of the app changed.
 *
 * The two call buttons were `#16A34A` and `#7C3AED` — the only saturated colour left in
 * the app, and invisible-as-hue under a strict monochrome palette. They are expressed
 * with the paper theme's `primary` / `surfaceVariant` roles now, which also keeps them
 * distinguishable on both schemes without inventing a second palette.
 */
const ContactInfoScreen = ({ route, navigation }: any) => {
  const { colors } = useTheme();
  const { token, user } = useSession();
  const conversationId = route.params?.conversationId as string;

  const conversation = useQuery(
    api.conversations.get,
    token && conversationId ? { token, conversationId: conversationId as any } : 'skip',
  );
  const startCall = useMutation(api.calls.start);
  const [calling, setCalling] = useState<'audio' | 'video' | null>(null);

  const otherMember = useMemo(
    () => conversation?.members?.find(m => m._id !== user?._id),
    [conversation?.members, user?._id],
  );

  const handleCall = useCallback(
    async (kind: 'audio' | 'video') => {
      if (!token || !otherMember || calling) return;
      setCalling(kind);
      try {
        const callId = await startCall({ token, calleeId: otherMember._id as any, type: kind });
        navigation.navigate('CallScreen', { callId, type: kind, role: 'caller', peerName: otherMember.displayName });
      } catch (error) {
        Alert.alert('Call failed', convexErrorMessage(error, 'Could not start the call.'));
      } finally {
        setCalling(null);
      }
    },
    [token, otherMember, calling, startCall, navigation],
  );

  const displayName = otherMember?.displayName ?? conversation?.title ?? '';

/**
 * Audio is the quiet action, video is the primary one.
 *
 * Paper's `Button` props are a discriminated union keyed on `mode`, and the outlined arm
 * declares `backgroundColor?: never`. This used to pass `backgroundColor` (for the quiet
 * button) and `buttonColor` (for the primary) as a `filled ? … : …` pair, which is how
 * the `#16A34A` / `#7C3AED` pair got there in the first place; both now go through
 * `buttonColor`, which both arms accept. For the outlined arm that is the *border*, so
 * the audio button takes `outline` — `surfaceVariant` there would have been a border
 * invisible against the background.
 */
const renderCallButton = (
  kind: 'audio' | 'video',
  label: string,
  icon: string,
  primary: boolean,
) => (
  <Button
    mode={primary ? 'contained' : 'outlined'}
    buttonColor={primary ? colors.primary : colors.outline}
    textColor={primary ? colors.onPrimary : colors.onSurface}
    style={styles.callButton}
    contentStyle={styles.callButtonContent}
    loading={calling === kind}
    disabled={!otherMember || calling !== null}
    icon={({ size, color }) => (
      <MaterialDesignIcons name={icon as never} size={size} color={color} />
    )}
    onPress={() => handleCall(kind)}
  >
    {label}
  </Button>
);

  const renderInfoRow = (icon: string, header: string, description: string) => (
    <List.Item
      title={
        <Text variant="bodyLarge" style={{ color: colors.onSurface }}>
          {header}
        </Text>
      }
      description={
        <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
          {description}
        </Text>
      }
      style={styles.row}
      left={() => (
        <View style={styles.rowIcon}>
          <MaterialDesignIcons name={icon as never} size={24} color={colors.onSurfaceVariant} />
        </View>
      )}
    />
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <Appbar.Header statusBarHeight={0} elevated={false} style={{ backgroundColor: colors.surface }}>
        <Appbar.BackAction onPress={() => navigation.goBack()} color={colors.onSurface} />
        <Appbar.Content title="Contact info" titleStyle={{ color: colors.onSurface }} />
      </Appbar.Header>

      {conversation === undefined ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.onSurfaceVariant} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.hero}>
            <UserAvatar
              entity={otherMember}
              name={displayName}
              size={96}
              variant="paper"
              imageStyle={styles.heroImage}
              initialsStyle={{ backgroundColor: colors.primaryContainer }}
              labelColor={colors.onPrimaryContainer}
            />
            <Text
              variant="headlineSmall"
              style={[styles.heroName, { color: colors.onSurface }]}
            >
              {displayName}
            </Text>
            {!!otherMember?.username && (
              <Text
                variant="bodyMedium"
                style={{ color: colors.onSurfaceVariant, marginTop: 4 }}
              >
                @{otherMember.username}
              </Text>
            )}
          </View>

          <View style={styles.actions}>
            {renderCallButton('audio', 'Audio call', 'phone', false)}
            {renderCallButton('video', 'Video call', 'video', true)}
          </View>

          <Divider style={[styles.divider, { backgroundColor: colors.outlineVariant }]} />

          <List.Item
            title={
              <Text variant="bodyLarge" style={{ color: colors.onSurface }}>
                Media, files & links
              </Text>
            }
            style={styles.row}
            left={() => (
              <View style={styles.rowIcon}>
                <MaterialDesignIcons
                  name="folder-multiple-image"
                  size={24}
                  color={colors.onSurfaceVariant}
                />
              </View>
            )}
            right={() => (
              <MaterialDesignIcons
                name="chevron-right"
                size={24}
                color={colors.outline}
              />
            )}
            onPress={() => navigation.navigate('ChatInfo', { conversationId })}
          />

          <Divider style={[styles.divider, { backgroundColor: colors.outlineVariant }]} />

          <Text
            variant="labelMedium"
            style={[
              styles.infoLabel,
              { color: colors.onSurfaceVariant },
            ]}
          >
            Info
          </Text>

          {renderInfoRow('account-outline', 'Username', otherMember?.username ? `@${otherMember.username}` : 'Not set')}
          {renderInfoRow('message-text-outline', 'Type', 'Direct message')}
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

export default ContactInfoScreen;

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingBottom: 40 },
  hero: { alignItems: 'center', paddingTop: 28, paddingBottom: 24, paddingHorizontal: 16 },
  heroImage: { width: 96, height: 96, borderRadius: 48 },
  heroName: { marginTop: 16 },
  actions: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, marginBottom: 20 },
  callButton: { flex: 1, borderRadius: 24 },
  callButtonContent: { paddingVertical: 6 },
  divider: { marginHorizontal: 16 },
  row: { paddingVertical: 4 },
  rowIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  infoLabel: { marginHorizontal: 16, marginTop: 12, marginBottom: 4 },
});