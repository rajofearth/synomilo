import React, { useCallback, useEffect, useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery } from 'convex/react';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';
import DeviceInfo from 'react-native-device-info';
import { launchImageLibrary } from 'react-native-image-picker';
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
import UserAvatar from './UserAvatar';

const GITHUB_URL = 'https://github.com/rajofearth';
const SOURCE_URL = 'https://github.com/rajofearth/synomilo';
const EMAIL_URL = 'mailto:rajofearth@proton.me';

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
 * A tab root, so there is no back arrow.
 *
 * Profile used to be a stack screen pushed from the Chats header avatar, which meant it
 * rendered an `Appbar.BackAction` that went nowhere once it became a tab. The header is
 * now a plain title row with the single contextual action (edit), and the identity block
 * that used to be repeated as an "Account" list is the hero instead.
 */
const ProfileScreen = ({ navigation }: any) => {
  const { colors } = useTheme();
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
  const versionLabel = `${DeviceInfo.getVersion()} (${DeviceInfo.getBuildNumber()})`;
  const platformLabel = `${DeviceInfo.getSystemName()} ${DeviceInfo.getSystemVersion()}`;

  const openLink = useCallback((url: string) => {
    Linking.openURL(url).catch(() => {
      setSnackbar('Could not open the link');
    });
  }, []);

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

  /**
   * One row, one value. Every list in this screen is built from these instead of a
   * `List.Item` per row, because `List.Item` renders its own dividers and its own
   * vertical rhythm and the four sections below it did not line up with each other.
   */
  const rows: {
    label: string;
    value?: string;
    icon?: string;
    onPress?: () => void;
  }[] = [
    { label: 'Display name', value: displayName },
    { label: 'Username', value: `@${username}` },
  ];

  const appRows = [
    { label: 'Version', value: versionLabel, icon: 'information-outline' },
    { label: 'Platform', value: platformLabel, icon: 'cellphone' },
  ];

  const linkRows = [
    { label: 'GitHub', icon: 'github', onPress: () => openLink(GITHUB_URL) },
    { label: 'Source code', icon: 'source-repository', onPress: () => openLink(SOURCE_URL) },
    { label: 'Email', icon: 'email-outline', onPress: () => openLink(EMAIL_URL) },
  ];

  const card = {
    backgroundColor: colors.elevation.level1,
    borderRadius: 20,
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      <View style={styles.header}>
        <Text variant="headlineMedium" style={styles.headerTitle}>
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
              size={96}
              variant="paper"
              initialsStyle={{
                backgroundColor: colors.primaryContainer,
                borderRadius: 48,
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
          <Text variant="headlineSmall" style={styles.heroName}>
            {editing ? displayNameDraft || displayName : displayName}
          </Text>
          <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
            @{editing ? usernameDraft || username : username}
          </Text>
        </View>

        {editing ? (
          <View style={[styles.card, card, styles.editCard]}>
            <Text variant="labelLarge" style={styles.sectionLabel}>
              EDIT DETAILS
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
            <View style={[styles.card, card]}>
              <Text variant="labelLarge" style={styles.sectionLabel}>
                ACCOUNT
              </Text>
              {rows.map((row, index) => (
                <View
                  key={row.label}
                  style={[
                    styles.row,
                    index > 0 && {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: colors.outlineVariant,
                    },
                  ]}
                >
                  <Text
                    variant="bodyLarge"
                    style={[styles.rowLabel, { color: colors.onSurface }]}
                  >
                    {row.label}
                  </Text>
                  <Text
                    variant="bodyLarge"
                    numberOfLines={1}
                    style={[styles.rowValue, { color: colors.onSurfaceVariant }]}
                  >
                    {row.value}
                  </Text>
                </View>
              ))}
              <Text
                variant="bodySmall"
                style={[styles.cardCaption, { color: colors.onSurfaceVariant }]}
              >
                Signed in as @{username}
              </Text>
            </View>

            <View style={[styles.card, card]}>
              <Text variant="labelLarge" style={styles.sectionLabel}>
                APP
              </Text>
              {appRows.map((row, index) => (
                <View
                  key={row.label}
                  style={[
                    styles.row,
                    index > 0 && {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: colors.outlineVariant,
                    },
                  ]}
                >
                  <MaterialDesignIcons
                    name={row.icon as never}
                    size={20}
                    color={colors.onSurfaceVariant}
                  />
                  <Text
                    variant="bodyLarge"
                    style={[styles.rowLabel, { color: colors.onSurface }]}
                  >
                    {row.label}
                  </Text>
                  <Text
                    variant="bodyLarge"
                    numberOfLines={1}
                    style={[styles.rowValue, { color: colors.onSurfaceVariant }]}
                  >
                    {row.value}
                  </Text>
                </View>
              ))}
            </View>

            <View style={[styles.card, card]}>
              <Text variant="labelLarge" style={styles.sectionLabel}>
                LINKS
              </Text>
              {linkRows.map((row, index) => (
                <Pressable
                  key={row.label}
                  style={({ pressed }) => [
                    styles.row,
                    index > 0 && {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: colors.outlineVariant,
                    },
                    pressed && { opacity: 0.6 },
                  ]}
                  onPress={row.onPress}
                >
                  <MaterialDesignIcons
                    name={row.icon as never}
                    size={20}
                    color={colors.onSurfaceVariant}
                  />
                  <Text
                    variant="bodyLarge"
                    style={[styles.rowLabel, { color: colors.onSurface }]}
                  >
                    {row.label}
                  </Text>
                  <MaterialDesignIcons
                    name="chevron-right"
                    size={20}
                    color={colors.outline}
                  />
                </Pressable>
              ))}
            </View>

            <View style={[styles.card, card]}>
              <Text variant="labelLarge" style={styles.sectionLabel}>
                PREFERENCES
              </Text>
              <Pressable
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                onPress={() => navigation.navigate('Settings')}
              >
                <MaterialDesignIcons
                  name="cog-outline"
                  size={20}
                  color={colors.onSurfaceVariant}
                />
                <Text
                  variant="bodyLarge"
                  style={[styles.rowLabel, { color: colors.onSurface }]}
                >
                  Settings
                </Text>
                <MaterialDesignIcons
                  name="chevron-right"
                  size={20}
                  color={colors.outline}
                />
              </Pressable>
            </View>

            <Button
              mode="outlined"
              icon={({ size, color }) => (
                <MaterialDesignIcons name="logout" size={size} color={color} />
              )}
              style={styles.signOutButton}
              contentStyle={styles.pillContent}
              textColor={colors.onSurface}
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
  },
  headerAction: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
    paddingBottom: 8,
  },
  heroInitials: {
    fontSize: 32,
    fontWeight: '700',
  },
  heroName: {
    marginTop: 16,
    marginBottom: 4,
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
  rowLabel: {
    flex: 1,
  },
  rowValue: {
    flexShrink: 1,
  },
  cardCaption: {
    paddingTop: 10,
    paddingBottom: 12,
    opacity: 0.7,
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
    marginTop: 4,
    borderRadius: 24,
  },
});