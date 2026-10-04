import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  TextInput,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@cometchat/chat-uikit-react-native';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { useSession } from '../../auth/SessionProvider';
import { convexErrorMessage } from '../../utils/convexError';

type UserRow = {
  _id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
};

const initialsFor = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('');

const UsersList = ({ navigation }: any) => {
  const theme = useTheme();
  const { token } = useSession();
  const users = useQuery(api.users.list, token ? { token } : 'skip') as
    | UserRow[]
    | undefined;
  const createDM = useMutation(api.conversations.createDM);
  const [query, setQuery] = useState('');
  const [openingId, setOpeningId] = useState<string | null>(null);

  const data = useMemo(() => {
    const list = users ?? [];
    const q = query.trim().toLowerCase();
    if (!q) {
      return list;
    }
    return list.filter(
      user =>
        user.displayName.toLowerCase().includes(q) ||
        user.username.toLowerCase().includes(q),
    );
  }, [users, query]);

  const openChat = useCallback(
    async (user: UserRow) => {
      if (!token || openingId) {
        return;
      }
      setOpeningId(user._id);
      try {
        const conversationId = await createDM({
          token,
          otherUserId: user._id as any,
        });
        navigation.navigate('Messages', {
          conversationId,
          title: user.displayName,
        });
      } catch (error) {
        Alert.alert(
          'Could not open chat',
          convexErrorMessage(error, 'Please try again.'),
        );
      } finally {
        setOpeningId(null);
      }
    },
    [token, openingId, createDM, navigation],
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.color.background2 }]}
      edges={['top']}
    >
      <Text
        style={[
          theme.typography.heading1.bold,
          styles.title,
          { color: theme.color.textPrimary },
        ]}
      >
        Users
      </Text>
      <View
        style={[
          styles.searchWrap,
          { backgroundColor: theme.color.background3 },
        ]}
      >
        <MaterialDesignIcons
          name="magnify"
          size={20}
          color={theme.color.textTertiary}
        />
        <TextInput
          style={[styles.search, { color: theme.color.textPrimary }]}
          value={query}
          onChangeText={setQuery}
          placeholder="Search"
          placeholderTextColor={theme.color.textTertiary}
        />
      </View>

      {users === undefined ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.color.primary} />
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={item => item._id}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: theme.color.background3 },
              ]}
              onPress={() => openChat(item)}
              disabled={!!openingId}
            >
              <View
                style={[
                  styles.avatar,
                  { backgroundColor: theme.color.extendedPrimary50 },
                ]}
              >
                {item.avatarUrl ? (
                  <Image
                    source={{ uri: item.avatarUrl }}
                    style={styles.avatarImage}
                  />
                ) : (
                  <Text
                    style={[
                      styles.avatarText,
                      { color: theme.color.textPrimary },
                    ]}
                  >
                    {initialsFor(item.displayName)}
                  </Text>
                )}
              </View>
              <View style={styles.rowBody}>
                <Text
                  numberOfLines={1}
                  style={[
                    theme.typography.body.medium,
                    { color: theme.color.textPrimary },
                  ]}
                >
                  {item.displayName}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[
                    theme.typography.caption1.regular,
                    { color: theme.color.textSecondary },
                  ]}
                >
                  @{item.username}
                </Text>
              </View>
              {openingId === item._id && (
                <ActivityIndicator size="small" color={theme.color.primary} />
              )}
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text
                style={[
                  theme.typography.heading3.bold,
                  { color: theme.color.textPrimary },
                ]}
              >
                {query ? 'No users found' : 'No other users yet'}
              </Text>
              {!query && (
                <Text
                  style={[
                    theme.typography.body.medium,
                    styles.emptyHint,
                    { color: theme.color.textSecondary },
                  ]}
                >
                  Invite someone to join synomiló.
                </Text>
              )}
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
};

export default UsersList;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  title: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    borderRadius: 20,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  search: {
    flex: 1,
    paddingVertical: 10,
    marginLeft: 8,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 8,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  emptyHint: {
    textAlign: 'center',
    marginTop: 8,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 24,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '700',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
  },
});
