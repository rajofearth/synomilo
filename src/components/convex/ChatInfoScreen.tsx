import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Dimensions, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@cometchat/chat-uikit-react-native';
import { useMutation, useQuery } from 'convex/react';
import dayjs from 'dayjs';
import { launchImageLibrary } from 'react-native-image-picker';
import {
  ActivityIndicator,
  Appbar,
  Avatar,
  Button,
  Checkbox,
  Chip,
  Dialog,
  Divider,
  IconButton,
  List,
  Portal,
  SegmentedButtons,
  Snackbar,
  TextInput,
  useTheme as usePaperTheme,
} from 'react-native-paper';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';
import { api } from '../../../convex/_generated/api';
import { useSession } from '../../auth/SessionProvider';
import { convexErrorMessage } from '../../utils/convexError';

const THUMB_SIZE = Dimensions.get('window').width / 3 - 8;
const PHOTO_LIMIT = 9;
const LIST_LIMIT = 5;
const MEMBER_LIMIT = 5;
type Tab = 'photos' | 'files' | 'links';

const formatBytes = (bytes: number | null): string => {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const initialsFor = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('');

const uriToBlob = (uri: string): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => resolve(xhr.response);
    xhr.onerror = () => reject(new Error('Could not read the selected photo'));
    xhr.responseType = 'blob';
    xhr.open('GET', uri, true);
    xhr.send();
  });

const mimeIcon = (mime: string | null): string =>
  mime?.startsWith('image/') ? 'file-image'
  : mime?.startsWith('video/') ? 'file-video'
  : mime?.startsWith('audio/') ? 'music'
  : mime === 'application/pdf' ? 'file-pdf-box'
  : 'file-document-outline';

const ChatInfoScreen = ({ route, navigation }: any) => {
  const theme = useTheme();
  const c = theme.color;
  const { colors } = usePaperTheme();
  const { token, user } = useSession();
  const conversationId = route.params?.conversationId as string;
  const fallbackTitle = (route.params?.title as string) ?? 'Chat info';

  const conversation = useQuery(
    api.conversations.get,
    token && conversationId ? { token, conversationId: conversationId as any } : 'skip',
  );
  const shared = useQuery(
    api.conversations.sharedContent,
    token && conversationId ? { token, conversationId: conversationId as any } : 'skip',
  );
  const rows = useQuery(api.conversations.list, token ? { token } : 'skip');

  const title = conversation?.title ?? fallbackTitle;
  const isGroup = conversation?.type === 'group';
  const groupAvatarUrl = conversation?.avatarUrl ?? null;
  const members = useMemo(() => conversation?.members ?? [], [conversation?.members]);
  const myMembership = useMemo(
    () => members.find(m => m._id === user?._id),
    [members, user?._id],
  );
  const isOwner = isGroup && myMembership?.role === 'owner';

  const users = useQuery(api.users.list, token && isGroup ? { token } : 'skip');

  const setMuted = useMutation(api.conversations.setMuted);
  const removeMember = useMutation(api.conversations.removeMember);
  const addMembers = useMutation(api.conversations.addMembers);
  const updateGroup = useMutation(api.conversations.updateGroup);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const leaveGroup = useMutation(api.conversations.leave);
  const deleteGroup = useMutation(api.conversations.deleteGroup);

  const [tab, setTab] = useState<Tab>('photos');
  const [mutedOverride, setMutedOverride] = useState<boolean | null>(null);
  const [togglingMute, setTogglingMute] = useState(false);
  const [showAllMembers, setShowAllMembers] = useState(false);
  const [showAllPhotos, setShowAllPhotos] = useState(false);
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [showAllLinks, setShowAllLinks] = useState(false);
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<any>(null);
  const [removing, setRemoving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addSelected, setAddSelected] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [pendingAvatarStorageId, setPendingAvatarStorageId] = useState<any>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

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
    setPendingAvatarStorageId(null);
    setUploadingAvatar(false);
    if (!uploadedAvatarUrl || !token || !conversationId) {
      setSnackbar('Could not load the uploaded photo');
      return;
    }
    updateGroup({
      token,
      conversationId: conversationId as any,
      avatarUrl: uploadedAvatarUrl,
    })
      .then(() => setSnackbar('Group photo updated'))
      .catch(error =>
        setSnackbar(convexErrorMessage(error, 'Could not update the group photo')),
      );
  }, [uploadedAvatarUrl, pendingAvatarStorageId, token, conversationId, updateGroup]);

  const mutedRow = useMemo(() => (rows ?? []).find(r => r._id === conversationId), [rows, conversationId]);
  const muted = mutedOverride ?? mutedRow?.muted ?? false;
  const photos = useMemo(() => (shared?.photos ?? []).filter(p => !!p.fileUrl), [shared]);
  const files = useMemo(() => shared?.files ?? [], [shared]);
  const links = useMemo(() => shared?.links ?? [], [shared]);
  const visibleMembers = useMemo(
    () => (showAllMembers ? members : members.slice(0, MEMBER_LIMIT)),
    [members, showAllMembers],
  );
  const memberIds = useMemo(() => new Set(members.map(m => m._id)), [members]);
  const candidates = useMemo(
    () => (users ?? []).filter(u => !memberIds.has(u._id)),
    [users, memberIds],
  );

  const openUrl = useCallback((url: string | null) => {
    if (url) Linking.openURL(url).catch(() => {});
  }, []);

  const toggleMute = useCallback(async () => {
    if (!token || !conversationId || togglingMute) return;
    const next = !muted;
    setTogglingMute(true);
    setMutedOverride(next);
    try {
      await setMuted({ token, conversationId: conversationId as any, muted: next });
    } catch (error) {
      setMutedOverride(null);
      Alert.alert('Could not update', convexErrorMessage(error, 'Please try again.'));
    } finally {
      setTogglingMute(false);
    }
  }, [token, conversationId, togglingMute, muted, setMuted]);

  const exitScreen = useCallback(() => {
    if (typeof navigation.popToTop === 'function') {
      navigation.popToTop();
      return;
    }
    navigation.goBack();
    navigation.goBack();
  }, [navigation]);

  const openEditName = useCallback(() => {
    setNameDraft(title);
    setEditOpen(true);
  }, [title]);

  const saveName = useCallback(async () => {
    if (!token || !conversationId || savingName) return;
    setSavingName(true);
    try {
      await updateGroup({ token, conversationId: conversationId as any, name: nameDraft });
      setEditOpen(false);
      setSnackbar('Group name updated');
    } catch (error) {
      setSnackbar(convexErrorMessage(error, 'Could not update the group name'));
    } finally {
      setSavingName(false);
    }
  }, [token, conversationId, savingName, updateGroup, nameDraft]);

  const pickGroupPhoto = useCallback(async () => {
    if (!token || uploadingAvatar) return;
    const result = await launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: 1,
    });
    const asset = result.assets?.[0];
    if (!asset?.uri) return;
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

  const confirmRemove = useCallback(async () => {
    if (!token || !conversationId || !removeTarget || removing) return;
    setRemoving(true);
    try {
      await removeMember({ token, conversationId: conversationId as any, userId: removeTarget._id as any });
      setSnackbar(`${removeTarget.displayName ?? 'Member'} was removed`);
      setRemoveTarget(null);
    } catch (error) {
      setSnackbar(convexErrorMessage(error, 'Could not remove the member'));
    } finally {
      setRemoving(false);
    }
  }, [token, conversationId, removeTarget, removing, removeMember]);

  const openAdd = useCallback(() => {
    setAddSelected([]);
    setAddOpen(true);
  }, []);

  const closeAdd = useCallback(() => {
    if (adding) return;
    setAddOpen(false);
    setAddSelected([]);
  }, [adding]);

  const toggleAdd = useCallback((id: string) => {
    setAddSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  }, []);

  const submitAdd = useCallback(async () => {
    if (!token || !conversationId || addSelected.length === 0 || adding) return;
    setAdding(true);
    try {
      await addMembers({ token, conversationId: conversationId as any, memberIds: addSelected as any });
      setAddOpen(false);
      setSnackbar(addSelected.length === 1 ? 'Member added' : 'Members added');
      setAddSelected([]);
    } catch (error) {
      setSnackbar(convexErrorMessage(error, 'Could not add members'));
    } finally {
      setAdding(false);
    }
  }, [token, conversationId, addSelected, adding, addMembers]);

  const confirmLeave = useCallback(async () => {
    if (!token || !conversationId || working) return;
    setWorking(true);
    try {
      await leaveGroup({ token, conversationId: conversationId as any });
      setLeaveOpen(false);
      exitScreen();
    } catch (error) {
      setSnackbar(convexErrorMessage(error, 'Could not leave the group'));
    } finally {
      setWorking(false);
    }
  }, [token, conversationId, working, leaveGroup, exitScreen]);

  const confirmDelete = useCallback(async () => {
    if (!token || !conversationId || working) return;
    setWorking(true);
    try {
      await deleteGroup({ token, conversationId: conversationId as any });
      setDeleteOpen(false);
      exitScreen();
    } catch (error) {
      setSnackbar(convexErrorMessage(error, 'Could not delete the group'));
    } finally {
      setWorking(false);
    }
  }, [token, conversationId, working, deleteGroup, exitScreen]);

  const bodyStyle = [theme.typography.body.medium, { color: c.textPrimary }];
  const subStyle = [theme.typography.caption1.regular, { color: c.textSecondary }];

  const empty = (message: string) => (
    <View style={styles.emptyWrap}>
      <Text style={[theme.typography.body.medium, { color: c.textTertiary }]}>{message}</Text>
    </View>
  );

  const seeAllButton = (expanded: boolean, onPress: () => void) => (
    <Button mode="text" textColor={colors.primary} style={styles.seeAll} onPress={onPress}>
      {expanded ? 'Show less' : 'See all'}
    </Button>
  );

  const renderRow = (key: string, icon: string, header: string, description: string, onPress: () => void) => (
    <List.Item
      key={key}
      title={header}
      description={description}
      titleNumberOfLines={1}
      titleStyle={bodyStyle as any}
      descriptionStyle={subStyle as any}
      style={styles.row}
      left={() => (
        <View style={styles.rowIcon}>
          <MaterialDesignIcons name={icon as any} size={26} color={c.primary} />
        </View>
      )}
      onPress={onPress}
    />
  );

  const quickActions: { icon: string; label: string; onPress: () => void }[] = [
    { icon: muted ? 'bell-outline' : 'bell-off-outline', label: muted ? 'Unmute' : 'Mute', onPress: toggleMute },
    { icon: 'image-multiple-outline', label: 'Media', onPress: () => setTab('photos') },
  ];
  if (isOwner) {
    quickActions.push({ icon: 'pencil-outline', label: 'Edit name', onPress: openEditName });
  }

  const renderPhotos = () => {
    if (photos.length === 0) return empty('No media yet');
    const visible = showAllPhotos ? photos : photos.slice(0, PHOTO_LIMIT);
    return (
      <>
        <View style={styles.photoGrid}>
          {visible.map(photo => (
            <TouchableOpacity key={photo._id} activeOpacity={0.8} onPress={() => openUrl(photo.fileUrl)}>
              <Image source={{ uri: photo.fileUrl as string }} style={[styles.photo, { width: THUMB_SIZE, height: THUMB_SIZE }]} />
              {photo.kind === 'video' && (
                <View style={styles.playOverlay} pointerEvents="none">
                  <MaterialDesignIcons name="play-circle" size={36} color="#FFFFFF" />
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
        {photos.length > PHOTO_LIMIT && seeAllButton(showAllPhotos, () => setShowAllPhotos(value => !value))}
      </>
    );
  };

  const renderFiles = () => {
    if (files.length === 0) return empty('No files yet');
    const visible = showAllFiles ? files : files.slice(0, LIST_LIMIT);
    return (
      <>
        {visible.map(f =>
          renderRow(f._id, mimeIcon(f.mimeType), f.fileName ?? 'File', [formatBytes(f.size), dayjs(f.createdAt).format('MMM D, YYYY')].filter(Boolean).join(' · '), () => openUrl(f.fileUrl)),
        )}
        {files.length > LIST_LIMIT && seeAllButton(showAllFiles, () => setShowAllFiles(value => !value))}
      </>
    );
  };

  const renderLinks = () => {
    if (links.length === 0) return empty('No links yet');
    const visible = showAllLinks ? links : links.slice(0, LIST_LIMIT);
    return (
      <>
        {visible.map(link =>
          renderRow(link.messageId, 'link-variant', link.url, dayjs(link.createdAt).format('MMM D, YYYY'), () => openUrl(link.url)),
        )}
        {links.length > LIST_LIMIT && seeAllButton(showAllLinks, () => setShowAllLinks(value => !value))}
      </>
    );
  };

  const renderTabs = () => {
    if (tab === 'photos') return renderPhotos();
    if (tab === 'files') return renderFiles();
    return renderLinks();
  };

  const ownerChip = (member: any) => (
    <Chip compact style={[styles.ownerChip, { backgroundColor: c.extendedPrimary50 }]} textStyle={[theme.typography.caption2.regular, { color: c.primary }]}>
      Owner
    </Chip>
  );

  const memberRow = (member: any) => (
    <List.Item
      key={member._id}
      title={member.displayName}
      description={member.username ? `@${member.username}` : undefined}
      titleStyle={bodyStyle as any}
      descriptionStyle={subStyle as any}
      style={styles.row}
      left={() => (
        <View style={styles.rowAvatar}>
          <Avatar.Text size={40} label={initialsFor(member.displayName).toUpperCase()} color={c.textPrimary} style={{ backgroundColor: c.extendedPrimary50 }} />
        </View>
      )}
      right={
        member.role === 'owner'
          ? () => ownerChip(member)
          : isOwner
          ? () => (
              <IconButton
                size={22}
                icon={({ size }) => <MaterialDesignIcons name="close" size={size} color={colors.onSurfaceVariant} />}
                onPress={() => setRemoveTarget(member)}
              />
            )
          : undefined
      }
    />
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background1 }]} edges={['top']}>
      <Appbar.Header statusBarHeight={0} elevated={false} style={{ backgroundColor: c.background2 }}>
        <Appbar.BackAction onPress={() => navigation.goBack()} color={c.textPrimary} />
        <Appbar.Content title="Chat info" titleStyle={{ color: c.textPrimary }} />
      </Appbar.Header>

      {conversation === undefined ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.hero}>
            <View style={styles.heroAvatarWrap}>
              {isGroup && groupAvatarUrl ? (
                <Image source={{ uri: groupAvatarUrl }} style={styles.heroAvatarImage} />
              ) : (
                <Avatar.Text
                  size={80}
                  label={initialsFor(title).toUpperCase()}
                  color={c.textPrimary}
                  style={{
                    backgroundColor: c.extendedPrimary50,
                    borderRadius: isGroup ? 24 : 40,
                  }}
                />
              )}
              {isOwner && (
                <TouchableOpacity
                  style={[
                    styles.heroCameraBadge,
                    { backgroundColor: colors.primary, borderColor: c.background1 },
                  ]}
                  onPress={pickGroupPhoto}
                  disabled={uploadingAvatar}
                  activeOpacity={0.8}
                >
                  {uploadingAvatar ? (
                    <ActivityIndicator size={14} color={colors.onPrimary} />
                  ) : (
                    <MaterialDesignIcons name="camera" size={16} color={colors.onPrimary} />
                  )}
                </TouchableOpacity>
              )}
            </View>
            <Text style={[theme.typography.heading3.bold, { color: c.textPrimary, marginTop: 12 }]}>{title}</Text>
            <Text style={[theme.typography.body.medium, { color: c.textSecondary }]}>
              {isGroup ? `${members.length} ${members.length === 1 ? 'member' : 'members'}` : 'Direct message'}
            </Text>
          </View>

          <View style={styles.quickRow}>
            {quickActions.map(action => (
              <TouchableOpacity key={action.label} style={styles.quickAction} onPress={action.onPress} activeOpacity={0.7}>
                <View style={[styles.quickActionIcon, { backgroundColor: c.extendedPrimary50 }]}>
                  <MaterialDesignIcons name={action.icon as any} size={22} color={c.primary} />
                </View>
                <Text style={[subStyle, { marginTop: 6 }]}>{action.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {isGroup && (
            <>
              <View style={styles.sectionHeader}>
                <Text style={[theme.typography.caption1.medium, { color: colors.onSurfaceVariant }]}>Members</Text>
                <Text style={[theme.typography.caption1.regular, { color: colors.onSurfaceVariant }]}>
                  {members.length} {members.length === 1 ? 'member' : 'members'}
                </Text>
              </View>
              <Divider style={[styles.divider, { backgroundColor: c.borderDefault }]} />
              {visibleMembers.map(memberRow)}
              {members.length > MEMBER_LIMIT && seeAllButton(showAllMembers, () => setShowAllMembers(value => !value))}
              {isOwner && (
                <List.Item
                  title="Add members"
                  titleStyle={bodyStyle as any}
                  style={styles.row}
                  left={() => (
                    <View style={styles.rowIcon}>
                      <MaterialDesignIcons name="account-plus-outline" size={26} color={colors.primary} />
                    </View>
                  )}
                  onPress={openAdd}
                />
              )}
            </>
          )}

          <SegmentedButtons
            value={tab}
            onValueChange={value => setTab(value as Tab)}
            style={styles.segments}
            theme={{
              colors: {
                secondaryContainer: c.extendedPrimary50,
                onSecondaryContainer: c.primary,
                outline: c.borderDefault,
                onSurface: c.textSecondary,
              },
            }}
            buttons={[
              { value: 'photos', label: 'Photos' },
              { value: 'files', label: 'Files' },
              { value: 'links', label: 'Links' },
            ]}
          />

          {renderTabs()}

          {isGroup && (
            <View style={styles.dangerWrap}>
              <Button
                mode="contained"
                buttonColor={colors.error}
                textColor={colors.onError}
                style={styles.dangerButton}
                contentStyle={styles.dangerContent}
                icon={({ size }) => (
                  <MaterialDesignIcons name={isOwner ? 'delete-outline' : 'logout'} size={size} color={colors.onError} />
                )}
                onPress={() => (isOwner ? setDeleteOpen(true) : setLeaveOpen(true))}
              >
                {isOwner ? 'Delete group' : 'Leave group'}
              </Button>
            </View>
          )}
        </ScrollView>
      )}

      <Portal>
        <Dialog
          visible={editOpen}
          onDismiss={() => {
            if (!savingName) setEditOpen(false);
          }}
          style={[styles.dialog, { backgroundColor: colors.elevation.level3 }]}
        >
          <Dialog.Title style={{ color: colors.onSurface }}>Edit group name</Dialog.Title>
          <Dialog.Content>
            <TextInput
              mode="outlined"
              label="Group name"
              value={nameDraft}
              onChangeText={setNameDraft}
              autoFocus
              outlineStyle={styles.inputOutline}
              outlineColor={colors.outline}
              activeOutlineColor={colors.primary}
              style={[styles.input, { backgroundColor: colors.background }]}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button textColor={colors.onSurfaceVariant} disabled={savingName} onPress={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button mode="contained" loading={savingName} disabled={savingName || nameDraft.trim().length < 2} onPress={saveName}>
              Save
            </Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog
          visible={removeTarget !== null}
          onDismiss={() => {
            if (!removing) setRemoveTarget(null);
          }}
          style={[styles.dialog, { backgroundColor: colors.elevation.level3 }]}
        >
          <Dialog.Title style={{ color: colors.onSurface }}>Remove member</Dialog.Title>
          <Dialog.Content>
            <Text style={[theme.typography.body.medium, { color: colors.onSurfaceVariant }]}>
              {`Remove ${removeTarget?.displayName ?? 'this member'} from the group?`}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button textColor={colors.onSurfaceVariant} disabled={removing} onPress={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button textColor={colors.error} loading={removing} onPress={confirmRemove}>
              Remove
            </Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog
          visible={leaveOpen}
          onDismiss={() => {
            if (!working) setLeaveOpen(false);
          }}
          style={[styles.dialog, { backgroundColor: colors.elevation.level3 }]}
        >
          <Dialog.Title style={{ color: colors.onSurface }}>Leave group</Dialog.Title>
          <Dialog.Content>
            <Text style={[theme.typography.body.medium, { color: colors.onSurfaceVariant }]}>
              Leave this group? You will no longer see its messages.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button textColor={colors.onSurfaceVariant} disabled={working} onPress={() => setLeaveOpen(false)}>
              Cancel
            </Button>
            <Button textColor={colors.error} loading={working} onPress={confirmLeave}>
              Leave
            </Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog
          visible={deleteOpen}
          onDismiss={() => {
            if (!working) setDeleteOpen(false);
          }}
          style={[styles.dialog, { backgroundColor: colors.elevation.level3 }]}
        >
          <Dialog.Title style={{ color: colors.onSurface }}>Delete group</Dialog.Title>
          <Dialog.Content>
            <Text style={[theme.typography.body.medium, { color: colors.onSurfaceVariant }]}>
              Delete this group for everyone? This cannot be undone.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button textColor={colors.onSurfaceVariant} disabled={working} onPress={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button textColor={colors.error} loading={working} onPress={confirmDelete}>
              Delete
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={closeAdd}>
        <Pressable style={styles.modalBackdrop} onPress={closeAdd}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.elevation.level2 }]} onPress={() => {}}>
            <Text style={[theme.typography.heading3.bold, { color: colors.onSurface, marginBottom: 8 }]}>Add members</Text>
            {users === undefined ? (
              <View style={styles.sheetState}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : candidates.length === 0 ? (
              <View style={styles.sheetState}>
                <Text style={[theme.typography.body.medium, { color: colors.onSurfaceVariant }]}>Everyone is already in this group.</Text>
              </View>
            ) : (
              <ScrollView style={styles.sheetList} keyboardShouldPersistTaps="handled">
                {candidates.map(item => {
                  const selected = addSelected.includes(item._id);
                  return (
                    <TouchableOpacity key={item._id} style={styles.addRow} activeOpacity={0.7} onPress={() => toggleAdd(item._id)}>
                      <Checkbox status={selected ? 'checked' : 'unchecked'} onPress={() => toggleAdd(item._id)} color={colors.primary} />
                      <View style={styles.addRowBody}>
                        <Text style={[theme.typography.body.medium, { color: colors.onSurface }]}>{item.displayName}</Text>
                        <Text style={[theme.typography.caption1.regular, { color: colors.onSurfaceVariant }]}>@{item.username}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
            <View style={styles.sheetActions}>
              <Button mode="text" textColor={colors.onSurfaceVariant} disabled={adding} onPress={closeAdd}>
                Cancel
              </Button>
              <Button mode="contained" loading={adding} disabled={adding || addSelected.length === 0} onPress={submitAdd}>
                Add
              </Button>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

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

export default ChatInfoScreen;

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingBottom: 40 },
  hero: { alignItems: 'center', paddingTop: 24, paddingBottom: 20, paddingHorizontal: 16 },
  heroAvatarWrap: { position: 'relative' },
  heroAvatarImage: { width: 96, height: 96, borderRadius: 24 },
  heroCameraBadge: {
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
  quickRow: { flexDirection: 'row', justifyContent: 'space-evenly', paddingHorizontal: 12, marginBottom: 20 },
  quickAction: { alignItems: 'center', minWidth: 72 },
  quickActionIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 8 },
  segments: { marginHorizontal: 16, marginTop: 8, marginBottom: 8 },
  emptyWrap: { alignItems: 'center', paddingVertical: 48 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 4 },
  photo: { margin: 4, borderRadius: 12 },
  playOverlay: { ...StyleSheet.absoluteFillObject, margin: 4, alignItems: 'center', justifyContent: 'center' },
  row: { paddingVertical: 4 },
  rowIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  rowAvatar: { justifyContent: 'center', marginLeft: 4, marginRight: 4 },
  ownerChip: { alignSelf: 'center' },
  divider: { marginBottom: 4 },
  seeAll: { alignSelf: 'center' },
  dangerWrap: { paddingHorizontal: 16, paddingTop: 16 },
  dangerButton: { borderRadius: 24 },
  dangerContent: { paddingVertical: 6 },
  dialog: { borderRadius: 28 },
  input: { borderRadius: 16 },
  inputOutline: { borderRadius: 16 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32, maxHeight: '85%' },
  sheetList: { maxHeight: 320 },
  sheetState: { paddingVertical: 32, alignItems: 'center' },
  addRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  addRowBody: { flex: 1, marginLeft: 4 },
  sheetActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 12 },
});
