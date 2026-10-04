import React, { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@cometchat/chat-uikit-react-native';
import { useMutation, useQuery } from 'convex/react';
import { ActivityIndicator, Appbar, Avatar, Button, Divider, List } from 'react-native-paper';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';
import { api } from '../../../convex/_generated/api';
import { useSession } from '../../auth/SessionProvider';
import { convexErrorMessage } from '../../utils/convexError';

const initialsFor = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('');

const ContactInfoScreen = ({ route, navigation }: any) => {
  const theme = useTheme();
  const c = theme.color;
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
  const bodyStyle = [theme.typography.body.medium, { color: c.textPrimary }];
  const subStyle = [theme.typography.body.regular, { color: c.textSecondary }];

  const renderCallButton = (kind: 'audio' | 'video', label: string, color: string, icon: string) => (
    <Button
      mode="contained"
      buttonColor={color}
      textColor="#FFFFFF"
      style={styles.callButton}
      contentStyle={styles.callButtonContent}
      loading={calling === kind}
      disabled={!otherMember || calling !== null}
      icon={({ size }) => <MaterialDesignIcons name={icon as any} size={size} color="#FFFFFF" />}
      onPress={() => handleCall(kind)}
    >
      {label}
    </Button>
  );

  const renderInfoRow = (icon: string, header: string, description: string) => (
    <List.Item
      title={header}
      description={description}
      titleStyle={bodyStyle as any}
      descriptionStyle={subStyle as any}
      style={styles.row}
      left={() => (
        <View style={styles.rowIcon}>
          <MaterialDesignIcons name={icon as any} size={26} color={c.textSecondary} />
        </View>
      )}
    />
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background1 }]} edges={['top']}>
      <Appbar.Header statusBarHeight={0} elevated={false} style={{ backgroundColor: c.background2 }}>
        <Appbar.BackAction onPress={() => navigation.goBack()} color={c.textPrimary} />
        <Appbar.Content title="Contact info" titleStyle={{ color: c.textPrimary }} />
      </Appbar.Header>

      {conversation === undefined ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.hero}>
            <Avatar.Text size={96} label={initialsFor(displayName).toUpperCase()} color={c.textPrimary} style={{ backgroundColor: c.extendedPrimary50 }} />
            <Text style={[theme.typography.heading3.bold, { color: c.textPrimary, marginTop: 16 }]}>{displayName}</Text>
            {!!otherMember?.username && (
              <Text style={[theme.typography.body.medium, { color: c.textSecondary, marginTop: 4 }]}>@{otherMember.username}</Text>
            )}
          </View>

          <View style={styles.actions}>
            {renderCallButton('audio', 'Audio call', '#16A34A', 'phone')}
            {renderCallButton('video', 'Video call', '#7C3AED', 'video')}
          </View>

          <Divider style={[styles.divider, { backgroundColor: c.borderDefault }]} />

          <List.Item
            title="Media, files & links"
            titleStyle={bodyStyle as any}
            style={styles.row}
            left={() => (
              <View style={styles.rowIcon}>
                <MaterialDesignIcons name="folder-multiple-image" size={26} color={c.primary} />
              </View>
            )}
            right={() => <MaterialDesignIcons name="chevron-right" size={24} color={c.textTertiary} />}
            onPress={() => navigation.navigate('ChatInfo', { conversationId })}
          />

          <Divider style={[styles.divider, { backgroundColor: c.borderDefault }]} />

          <Text style={[theme.typography.caption1.medium, { color: c.textTertiary, marginHorizontal: 16, marginTop: 8 }]}>Info</Text>

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
  actions: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, marginBottom: 20 },
  callButton: { flex: 1, borderRadius: 24 },
  callButtonContent: { paddingVertical: 6 },
  divider: { marginHorizontal: 16 },
  row: { paddingVertical: 4 },
  rowIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
