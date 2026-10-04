import React, { useCallback, useEffect, useState } from 'react';
import {
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { useMutation, useQuery } from 'convex/react';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';
import DeviceInfo from 'react-native-device-info';
import { launchImageLibrary } from 'react-native-image-picker';
import {
  ActivityIndicator,
  Appbar,
  Avatar,
  Button,
  Dialog,
  Divider,
  List,
  Portal,
  Snackbar,
  Text,
  TextInput,
  useTheme as usePaperTheme,
} from 'react-native-paper';
import { api } from '../../../convex/_generated/api';
import { useSession } from '../../auth/SessionProvider';
import { convexErrorMessage } from '../../utils/convexError';

const initialsFor = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .map(part => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';

const uriToBlob = (uri: string): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => resolve(xhr.response);
    xhr.onerror = () => reject(new Error('Could not read the selected photo'));
    xhr.responseType = 'blob';
    xhr.open('GET', uri, true);
    xhr.send();
  });

const ProfileScreen = ({ navigation }: any) => {
  const { colors } = usePaperTheme();
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
  const initials = initialsFor(displayName);
  const avatarUri = avatarDraft ?? user?.avatarUrl ?? null;
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

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Appbar.Header centered={false} style={{ backgroundColor: colors.surface }}>
        <Appbar.BackAction
          onPress={() => navigation.goBack()}
          color={colors.onSurface}
        />
        <Appbar.Content
          title="Profile"
          titleStyle={{ color: colors.onSurface }}
        />
        <Appbar.Action
          icon={({ size }) => (
            <MaterialDesignIcons
              name={editing ? 'check' : 'pencil-outline'}
              size={size}
              color={editing ? colors.primary : colors.onSurfaceVariant}
            />
          )}
          onPress={editing ? handleSave : openEdit}
          disabled={editing && (saving || uploadingAvatar)}
        />
      </Appbar.Header>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <View style={styles.avatarWrap}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
            ) : (
              <Avatar.Text
                size={88}
                label={initials}
                style={{ backgroundColor: colors.primaryContainer }}
                color={colors.onPrimaryContainer}
              />
            )}
            {editing && (
              <TouchableOpacity
                style={[
                  styles.cameraBadge,
                  {
                    backgroundColor: colors.primary,
                    borderColor: colors.surface,
                  },
                ]}
                onPress={pickAvatar}
                disabled={uploadingAvatar}
                activeOpacity={0.8}
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
              </TouchableOpacity>
            )}
          </View>
          <Text
            variant="headlineSmall"
            style={[styles.name, { color: colors.onSurface }]}
          >
            {displayName}
          </Text>
          <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
            @{username}
          </Text>
        </View>

        {editing ? (
          <View style={styles.editForm}>
            <TextInput
              mode="outlined"
              label="Display name"
              value={displayNameDraft}
              onChangeText={setDisplayNameDraft}
              style={[styles.input, { backgroundColor: colors.background }]}
              outlineStyle={styles.inputOutline}
              outlineColor={colors.outline}
              activeOutlineColor={colors.primary}
            />
            <TextInput
              mode="outlined"
              label="Username"
              value={usernameDraft}
              onChangeText={setUsernameDraft}
              autoCapitalize="none"
              autoCorrect={false}
              helperText="3-20 characters: a-z, 0-9, _"
              style={[styles.input, { backgroundColor: colors.background }]}
              outlineStyle={styles.inputOutline}
              outlineColor={colors.outline}
              activeOutlineColor={colors.primary}
            />
            <View style={styles.editActions}>
              <Button
                mode="text"
                textColor={colors.onSurfaceVariant}
                style={styles.actionButton}
                disabled={saving}
                onPress={cancelEdit}
              >
                Cancel
              </Button>
              <Button
                mode="contained"
                style={styles.actionButton}
                contentStyle={styles.pillContent}
                loading={saving}
                disabled={saving || !token}
                onPress={handleSave}
              >
                Save
              </Button>
            </View>
          </View>
        ) : (
          <>
            <List.Section
              title="Account"
              titleStyle={{ color: colors.onSurfaceVariant }}
            >
              <List.Item
                title="Username"
                titleStyle={{ color: colors.onSurface }}
                right={() => (
                  <Text variant="bodyMedium" style={styles.value}>
                    @{username}
                  </Text>
                )}
              />
              <Divider style={{ backgroundColor: colors.outlineVariant }} />
              <List.Item
                title="Display name"
                titleStyle={{ color: colors.onSurface }}
                right={() => (
                  <Text variant="bodyMedium" style={styles.value}>
                    {displayName}
                  </Text>
                )}
              />
            </List.Section>

            <List.Section
              title="About"
              titleStyle={{ color: colors.onSurfaceVariant }}
            >
              <List.Item
                title="Version"
                titleStyle={{ color: colors.onSurface }}
                left={({ style }) => (
                  <MaterialDesignIcons
                    name="information-outline"
                    size={24}
                    style={style}
                    color={colors.onSurfaceVariant}
                  />
                )}
                right={() => (
                  <Text variant="bodyMedium" style={styles.value}>
                    {versionLabel}
                  </Text>
                )}
              />
              <Divider style={{ backgroundColor: colors.outlineVariant }} />
              <List.Item
                title="Platform"
                titleStyle={{ color: colors.onSurface }}
                left={({ style }) => (
                  <MaterialDesignIcons
                    name="android"
                    size={24}
                    style={style}
                    color={colors.onSurfaceVariant}
                  />
                )}
                right={() => (
                  <Text variant="bodyMedium" style={styles.value}>
                    {platformLabel}
                  </Text>
                )}
              />
              <Divider style={{ backgroundColor: colors.outlineVariant }} />
              <List.Item
                title="Signed in as"
                titleStyle={{ color: colors.onSurface }}
                left={({ style }) => (
                  <MaterialDesignIcons
                    name="account-outline"
                    size={24}
                    style={style}
                    color={colors.onSurfaceVariant}
                  />
                )}
                right={() => (
                  <Text variant="bodyMedium" style={styles.value}>
                    @{username}
                  </Text>
                )}
              />
            </List.Section>

            <List.Section
              title="Links"
              titleStyle={{ color: colors.onSurfaceVariant }}
            >
              <List.Item
                title="GitHub"
                titleStyle={{ color: colors.onSurface }}
                style={[
                  styles.linkItem,
                  { backgroundColor: colors.elevation.level1 },
                ]}
                left={({ style }) => (
                  <MaterialDesignIcons
                    name="github"
                    size={24}
                    style={style}
                    color={colors.onSurfaceVariant}
                  />
                )}
                right={({ style }) => (
                  <MaterialDesignIcons
                    name="chevron-right"
                    size={24}
                    style={style}
                    color={colors.onSurfaceVariant}
                  />
                )}
                onPress={() => openLink('https://github.com/rajofearth')}
              />
              <List.Item
                title="Source code"
                titleStyle={{ color: colors.onSurface }}
                style={[
                  styles.linkItem,
                  { backgroundColor: colors.elevation.level1 },
                ]}
                left={({ style }) => (
                  <MaterialDesignIcons
                    name="source-repository"
                    size={24}
                    style={style}
                    color={colors.onSurfaceVariant}
                  />
                )}
                right={({ style }) => (
                  <MaterialDesignIcons
                    name="chevron-right"
                    size={24}
                    style={style}
                    color={colors.onSurfaceVariant}
                  />
                )}
                onPress={() =>
                  openLink('https://github.com/rajofearth/synomilo')
                }
              />
              <List.Item
                title="Email"
                titleStyle={{ color: colors.onSurface }}
                style={[
                  styles.linkItem,
                  { backgroundColor: colors.elevation.level1 },
                ]}
                left={({ style }) => (
                  <MaterialDesignIcons
                    name="email-outline"
                    size={24}
                    style={style}
                    color={colors.onSurfaceVariant}
                  />
                )}
                right={({ style }) => (
                  <MaterialDesignIcons
                    name="chevron-right"
                    size={24}
                    style={style}
                    color={colors.onSurfaceVariant}
                  />
                )}
                onPress={() => openLink('mailto:rajofearth@proton.me')}
              />
            </List.Section>

            <List.Section
              title="Preferences"
              titleStyle={{ color: colors.onSurfaceVariant }}
            >
              <List.Item
                title="Settings"
                titleStyle={{ color: colors.onSurface }}
                left={({ style }) => (
                  <MaterialDesignIcons
                    name="cog-outline"
                    size={24}
                    style={style}
                    color={colors.onSurfaceVariant}
                  />
                )}
                onPress={() => navigation.navigate('Settings')}
              />
            </List.Section>

            <View style={styles.footer}>
              <Button
                mode="contained"
                buttonColor={colors.errorContainer}
                textColor={colors.onErrorContainer}
                icon={({ size }) => (
                  <MaterialDesignIcons
                    name="logout"
                    size={size}
                    color={colors.onErrorContainer}
                  />
                )}
                style={styles.signOutButton}
                contentStyle={styles.pillContent}
                onPress={() => setSignOutVisible(true)}
              >
                Sign out
              </Button>
            </View>
          </>
        )}
      </ScrollView>

      <Portal>
        <Dialog
          visible={signOutVisible}
          onDismiss={() => setSignOutVisible(false)}
          style={[styles.dialog, { backgroundColor: colors.elevation.level3 }]}
        >
          <Dialog.Title style={{ color: colors.onSurface }}>
            Sign out
          </Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
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
            <Button textColor={colors.error} onPress={handleSignOut}>
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
    </View>
  );
};

export default ProfileScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingBottom: 24,
  },
  hero: {
    alignItems: 'center',
    paddingTop: 24,
    paddingBottom: 16,
  },
  avatarWrap: {
    position: 'relative',
  },
  avatarImage: {
    width: 88,
    height: 88,
    borderRadius: 44,
  },
  cameraBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    marginTop: 16,
    marginBottom: 4,
  },
  value: {
    alignSelf: 'center',
  },
  linkItem: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 20,
  },
  editForm: {
    paddingHorizontal: 16,
  },
  input: {
    borderRadius: 16,
  },
  inputOutline: {
    borderRadius: 16,
  },
  editActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  actionButton: {
    borderRadius: 28,
  },
  footer: {
    marginTop: 'auto',
    padding: 16,
  },
  signOutButton: {
    width: '100%',
    borderRadius: 28,
  },
  pillContent: {
    paddingVertical: 6,
  },
  dialog: {
    borderRadius: 28,
  },
});
