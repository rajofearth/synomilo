import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from 'react-native-paper';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';
import { useMutation, useQuery } from 'convex/react';
import dayjs from 'dayjs';
import { api } from '../../../convex/_generated/api';
import { useSession } from '../../auth/SessionProvider';
import { convexErrorMessage } from '../../utils/convexError';

type CallStatus = 'ringing' | 'active' | 'rejected' | 'missed' | 'ended';

type CallRow = {
  _id: string;
  type: 'audio' | 'video';
  status: CallStatus;
  createdAt: number;
  direction: 'outgoing' | 'incoming';
  peer: {
    _id: string;
    displayName: string;
    username: string;
    avatarUrl: string | null;
  } | null;
};

const formatTime = (ts: number): string => {
  const d = dayjs(ts);
  return d.isSame(dayjs(), 'day') ? d.format('h:mm A') : d.format('MMM D');
};

const initialsFor = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('');

const isMissed = (status: CallStatus): boolean =>
  status === 'missed' || status === 'rejected';

const callLabel = (call: CallRow): string => {
  const typeWord = call.type === 'audio' ? 'voice' : 'video';
  if (isMissed(call.status)) {
    return `Missed ${typeWord} call`;
  }
  const directionWord = call.direction === 'outgoing' ? 'Outgoing' : 'Incoming';
  return `${directionWord} ${typeWord} call`;
};

const Calls = () => {
  const theme = useTheme();
  const navigation = useNavigation<any>();
  const { token } = useSession();
  const calls = useQuery(
    api.calls.history,
    token ? { token } : 'skip',
  ) as CallRow[] | undefined;
  const startCall = useMutation(api.calls.start);
  const [startingId, setStartingId] = useState<string | null>(null);

  const data = useMemo(() => calls ?? [], [calls]);

  const callBack = useCallback(
    async (item: CallRow) => {
      if (!token || !item.peer || startingId) {
        return;
      }
      setStartingId(item._id);
      try {
        const callId = await startCall({
          token,
          calleeId: item.peer._id as any,
          type: item.type,
        });
        navigation.navigate('CallScreen', {
          callId,
          type: item.type,
          role: 'caller',
          peerName: item.peer.displayName,
        });
      } catch (error) {
        Alert.alert(
          'Call failed',
          convexErrorMessage(error, 'Could not start the call.'),
        );
      } finally {
        setStartingId(null);
      }
    },
    [token, startingId, startCall, navigation],
  );

  const renderItem = useCallback(
    ({ item }: { item: CallRow }) => {
      const missed = isMissed(item.status);
      const name = item.peer?.displayName ?? 'Unknown';
      const starting = startingId === item._id;
      const iconName = missed
        ? 'phone-missed'
        : item.type === 'audio'
        ? 'phone-outline'
        : 'video-outline';

      return (
        <TouchableOpacity
          style={[styles.row, { backgroundColor: theme.colors.surface }]}
          activeOpacity={0.7}
          disabled={startingId !== null || !item.peer}
          onPress={() => callBack(item)}
        >
          <View
            style={[
              styles.avatar,
              { backgroundColor: theme.colors.primaryContainer },
            ]}
          >
            <Text
              style={[
                styles.avatarText,
                { color: theme.colors.onPrimaryContainer },
              ]}
            >
              {initialsFor(name) || '?'}
            </Text>
          </View>
          <View style={styles.body}>
            <View style={styles.bodyTop}>
              <Text
                numberOfLines={1}
                style={[
                  theme.fonts.bodyLarge,
                  styles.title,
                  { color: theme.colors.onSurface },
                ]}
              >
                {name}
              </Text>
              <Text
                style={[
                  theme.fonts.bodySmall,
                  { color: theme.colors.onSurfaceVariant },
                ]}
              >
                {formatTime(item.createdAt)}
              </Text>
            </View>
            <Text
              numberOfLines={1}
              style={[
                theme.fonts.bodyMedium,
                {
                  color: missed
                    ? theme.colors.error
                    : theme.colors.onSurfaceVariant,
                },
              ]}
            >
              {callLabel(item)}
            </Text>
          </View>
          <View style={styles.trailing}>
            {starting ? (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : (
              <MaterialDesignIcons
                name={iconName as any}
                size={24}
                color={
                  missed ? theme.colors.error : theme.colors.onSurfaceVariant
                }
              />
            )}
          </View>
        </TouchableOpacity>
      );
    },
    [theme, startingId, callBack],
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      edges={['top']}
    >
      <View style={styles.header}>
        <Text
          style={[theme.fonts.headlineSmall, { color: theme.colors.onSurface }]}
        >
          Calls
        </Text>
      </View>

      {calls === undefined ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : data.length === 0 ? (
        <View style={styles.center}>
          <MaterialDesignIcons
            name="phone-off-outline"
            size={48}
            color={theme.colors.onSurfaceVariant}
          />
          <Text
            style={[
              theme.fonts.titleMedium,
              styles.emptyTitle,
              { color: theme.colors.onSurface },
            ]}
          >
            No calls yet
          </Text>
          <Text
            style={[
              theme.fonts.bodyMedium,
              styles.emptyHint,
              { color: theme.colors.onSurfaceVariant },
            ]}
          >
            Calls you make and receive show up here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={item => item._id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
        />
      )}
    </SafeAreaView>
  );
};

export default Calls;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '700',
  },
  body: {
    flex: 1,
    marginLeft: 12,
  },
  bodyTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    flex: 1,
    marginRight: 8,
  },
  trailing: {
    width: 32,
    marginLeft: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    marginTop: 12,
  },
  emptyHint: {
    textAlign: 'center',
    marginTop: 8,
  },
});
