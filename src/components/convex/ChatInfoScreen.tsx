import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Dimensions, Image, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@cometchat/chat-uikit-react-native';
import { useMutation, useQuery } from 'convex/react';
import dayjs from 'dayjs';
import { ActivityIndicator, Appbar, Avatar, Chip, Divider, List, SegmentedButtons } from 'react-native-paper';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';
import { api } from '../../../convex/_generated/api';
import { useSession } from '../../auth/SessionProvider';
import { convexErrorMessage } from '../../utils/convexError';

const THUMB_SIZE = Dimensions.get('window').width / 3 - 8;
type Tab = 'photos' | 'files' | 'links';

const formatBytes = (bytes: number | null): string => {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const initialsFor = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('');

const mimeIcon = (mime: string | null): string =>
  mime?.startsWith('image/') ? 'file-image'
  : mime?.startsWith('video/') ? 'file-video'
  : mime?.startsWith('audio/') ? 'music'
  : mime === 'application/pdf' ? 'file-pdf-box'
  : 'file-document-outline';

const ChatInfoScreen = ({ route, navigation }: any) => {
  const theme = useTheme();
  const c = theme.color;
  const { token } = useSession();
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
  const setMuted = useMutation(api.conversations.setMuted);

  const [tab, setTab] = useState<Tab>('photos');
  const [mutedOverride, setMutedOverride] = useState<boolean | null>(null);
  const [togglingMute, setTogglingMute] = useState(false);

  const mutedRow = useMemo(() => (rows ?? []).find(r => r._id === conversationId), [rows, conversationId]);
  const muted = mutedOverride ?? mutedRow?.muted ?? false;
  const photos = useMemo(() => (shared?.photos ?? []).filter(p => !!p.fileUrl), [shared]);
  const files = useMemo(() => shared?.files ?? [], [shared]);
  const links = useMemo(() => shared?.links ?? [], [shared]);

  const title = conversation?.title ?? fallbackTitle;
  const isGroup = conversation?.type === 'group';
  const members = useMemo(() => conversation?.members ?? [], [conversation?.members]);

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

  const bodyStyle = [theme.typography.body.medium, { color: c.textPrimary }];
  const subStyle = [theme.typography.caption1.regular, { color: c.textSecondary }];

  const empty = (message: string) => (
    <View style={styles.emptyWrap}>
      <Text style={[theme.typography.body.medium, { color: c.textTertiary }]}>{message}</Text>
    </View>
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

  const quickActions = [
    { icon: muted ? 'bell-outline' : 'bell-off-outline', label: muted ? 'Unmute' : 'Mute', onPress: toggleMute },
    { icon: 'magnify', label: 'Search', onPress: () => Alert.alert('Coming soon', 'Search is coming soon.') },
    { icon: 'image-multiple-outline', label: 'Media', onPress: () => setTab('photos') },
  ];

  const renderPhotos = () => {
    if (photos.length === 0) return empty('No media yet');
    return (
      <View style={styles.photoGrid}>
        {photos.map(photo => (
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
    );
  };

  const renderTabs = () => {
    if (tab === 'photos') return renderPhotos();
    if (tab === 'files') {
      if (files.length === 0) return empty('No files yet');
      return files.map(f =>
        renderRow(f._id, mimeIcon(f.mimeType), f.fileName ?? 'File', [formatBytes(f.size), dayjs(f.createdAt).format('MMM D, YYYY')].filter(Boolean).join(' · '), () => openUrl(f.fileUrl)),
      );
    }
    if (links.length === 0) return empty('No links yet');
    return links.map(link => renderRow(link.messageId, 'link-variant', link.url, dayjs(link.createdAt).format('MMM D, YYYY'), () => openUrl(link.url)));
  };

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
            {isGroup && conversation.emoji ? (
              <View style={[styles.heroEmoji, { backgroundColor: c.extendedPrimary50 }]}>
                <Text style={styles.heroEmojiText}>{conversation.emoji}</Text>
              </View>
            ) : (
              <Avatar.Text size={80} label={initialsFor(title).toUpperCase()} color={c.textPrimary} style={{ backgroundColor: c.extendedPrimary50 }} />
            )}
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

          {isGroup && members.length > 0 && (
            <>
              <Text style={[theme.typography.caption1.medium, { color: c.textTertiary, marginTop: 20 }]}>Members</Text>
              <Divider style={[styles.divider, { backgroundColor: c.borderDefault }]} />
              {members.map(member => (
                <List.Item
                  key={member._id}
                  title={member.displayName}
                  titleStyle={bodyStyle as any}
                  style={styles.row}
                  left={() => (
                    <View style={styles.rowAvatar}>
                      <Avatar.Text size={40} label={initialsFor(member.displayName).toUpperCase()} color={c.textPrimary} style={{ backgroundColor: c.extendedPrimary50 }} />
                    </View>
                  )}
                  right={
                    member.role === 'owner'
                      ? () => (
                          <Chip compact style={[styles.ownerChip, { backgroundColor: c.extendedPrimary50 }]} textStyle={[theme.typography.caption2.regular, { color: c.primary }]}>
                            Owner
                          </Chip>
                        )
                      : undefined
                  }
                />
              ))}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

export default ChatInfoScreen;

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingBottom: 40 },
  hero: { alignItems: 'center', paddingTop: 24, paddingBottom: 20, paddingHorizontal: 16 },
  heroEmoji: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  heroEmojiText: { fontSize: 38 },
  quickRow: { flexDirection: 'row', justifyContent: 'space-evenly', paddingHorizontal: 12, marginBottom: 20 },
  quickAction: { alignItems: 'center', minWidth: 72 },
  quickActionIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  segments: { marginHorizontal: 16, marginBottom: 8 },
  emptyWrap: { alignItems: 'center', paddingVertical: 48 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 4 },
  photo: { margin: 4, borderRadius: 6 },
  playOverlay: { ...StyleSheet.absoluteFillObject, margin: 4, alignItems: 'center', justifyContent: 'center' },
  row: { paddingVertical: 4 },
  rowIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  rowAvatar: { justifyContent: 'center', marginLeft: 4, marginRight: 4 },
  ownerChip: { alignSelf: 'center' },
  divider: { marginBottom: 4 },
});
