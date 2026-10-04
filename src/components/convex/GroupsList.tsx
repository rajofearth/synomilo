import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@cometchat/chat-uikit-react-native';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { useSession } from '../../auth/SessionProvider';
import { convexErrorMessage } from '../../utils/convexError';

type GroupRow = {
  _id: string;
  type: 'dm' | 'group';
  title: string;
  emoji: string | null;
  memberCount: number;
  lastMessagePreview: string;
};

type UserRow = {
  _id: string;
  username: string;
  displayName: string;
};

const GroupsList = ({ navigation }: any) => {
  const theme = useTheme();
  const { token } = useSession();
  const conversations = useQuery(
    api.conversations.list,
    token ? { token } : 'skip',
  ) as GroupRow[] | undefined;
  const users = useQuery(api.users.list, token ? { token } : 'skip') as
    | UserRow[]
    | undefined;
  const createGroup = useMutation(api.conversations.createGroup);

  const [createOpen, setCreateOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const groups = useMemo(
    () => (conversations ?? []).filter(item => item.type === 'group'),
    [conversations],
  );

  const toggleMember = useCallback((id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    );
  }, []);

  const closeCreate = useCallback(() => {
    setCreateOpen(false);
    setGroupName('');
    setSelectedIds([]);
  }, []);

  const submitCreate = useCallback(async () => {
    if (!token || creating) {
      return;
    }
    const name = groupName.trim();
    if (name.length < 2) {
      Alert.alert('Name needed', 'Please give the wedding group a name.');
      return;
    }
    setCreating(true);
    try {
      const conversationId = await createGroup({
        token,
        name,
        memberIds: selectedIds as any,
      });
      closeCreate();
      navigation.navigate('Messages', { conversationId, title: name });
    } catch (error) {
      Alert.alert(
        'Could not create group',
        convexErrorMessage(error, 'Please try again.'),
      );
    } finally {
      setCreating(false);
    }
  }, [token, creating, groupName, selectedIds, createGroup, closeCreate, navigation]);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.color.background2 }]}
      edges={['top']}
    >
      <View style={styles.header}>
        <Text
          style={[
            theme.typography.heading1.bold,
            { color: theme.color.textPrimary },
          ]}
        >
          Wedding Groups
        </Text>
        <TouchableOpacity
          style={[
            styles.addButton,
            { backgroundColor: theme.color.primary },
          ]}
          onPress={() => setCreateOpen(true)}
        >
          <Text style={styles.addButtonText}>+</Text>
        </TouchableOpacity>
      </View>

      {conversations === undefined ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.color.primary} />
        </View>
      ) : groups.length === 0 ? (
        <View style={styles.center}>
          <Text
            style={[
              theme.typography.heading3.bold,
              { color: theme.color.textPrimary },
            ]}
          >
            No wedding groups yet
          </Text>
          <Text
            style={[
              theme.typography.body.medium,
              styles.emptyHint,
              { color: theme.color.textSecondary },
            ]}
          >
            Create a group for your wedding party, family or guests.
          </Text>
          <TouchableOpacity
            style={[
              styles.ctaButton,
              { backgroundColor: theme.color.primary },
            ]}
            onPress={() => setCreateOpen(true)}
          >
            <Text style={styles.ctaButtonText}>Create a group</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={item => item._id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              onPress={() =>
                navigation.navigate('Messages', {
                  conversationId: item._id,
                  title: item.title,
                })
              }
            >
              <View
                style={[
                  styles.groupAvatar,
                  { backgroundColor: theme.color.extendedPrimary50 },
                ]}
              >
                <Text style={styles.groupEmoji}>{item.emoji ?? '💍'}</Text>
              </View>
              <View style={styles.rowBody}>
                <Text
                  style={[
                    theme.typography.body.medium,
                    { color: theme.color.textPrimary },
                  ]}
                >
                  {item.title}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[
                    theme.typography.caption1.regular,
                    { color: theme.color.textSecondary },
                  ]}
                >
                  {item.memberCount}{' '}
                  {item.memberCount === 1 ? 'member' : 'members'} ·{' '}
                  {item.lastMessagePreview}
                </Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}

      <Modal
        visible={createOpen}
        transparent
        animationType="slide"
        onRequestClose={closeCreate}
      >
        <Pressable style={styles.modalBackdrop} onPress={closeCreate}>
          <Pressable
            style={[
              styles.createSheet,
              { backgroundColor: theme.color.background1 },
            ]}
            onPress={() => {}}
          >
            <Text
              style={[
                theme.typography.heading3.bold,
                { color: theme.color.textPrimary, marginBottom: 12 },
              ]}
            >
              New wedding group
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  borderColor: theme.color.borderLight,
                  color: theme.color.textPrimary,
                },
              ]}
              value={groupName}
              onChangeText={setGroupName}
              placeholder="Group name (e.g. Sharma Wedding)"
              placeholderTextColor={theme.color.textTertiary}
            />
            <Text
              style={[
                theme.typography.caption1.medium,
                { color: theme.color.textSecondary, marginTop: 16, marginBottom: 8 },
              ]}
            >
              Add members
            </Text>
            <FlatList
              style={styles.memberList}
              data={users ?? []}
              keyExtractor={item => item._id}
              renderItem={({ item }) => {
                const selected = selectedIds.includes(item._id);
                return (
                  <TouchableOpacity
                    style={styles.memberRow}
                    onPress={() => toggleMember(item._id)}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        {
                          borderColor: selected
                            ? theme.color.primary
                            : theme.color.borderDefault,
                          backgroundColor: selected
                            ? theme.color.primary
                            : 'transparent',
                        },
                      ]}
                    >
                      {selected && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                    <Text
                      style={[
                        theme.typography.body.medium,
                        { color: theme.color.textPrimary },
                      ]}
                    >
                      {item.displayName}
                    </Text>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text
                  style={[
                    theme.typography.caption1.regular,
                    { color: theme.color.textTertiary },
                  ]}
                >
                  No other users yet.
                </Text>
              }
            />
            <TouchableOpacity
              style={[
                styles.ctaButton,
                { backgroundColor: theme.color.primary, marginTop: 12 },
                creating && { opacity: 0.6 },
              ]}
              onPress={submitCreate}
              disabled={creating}
            >
              {creating ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.ctaButtonText}>Create group</Text>
              )}
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
};

export default GroupsList;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: {
    color: '#fff',
    fontSize: 24,
    lineHeight: 28,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyHint: {
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  ctaButton: {
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  groupAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupEmoji: {
    fontSize: 24,
  },
  rowBody: {
    flex: 1,
    marginLeft: 12,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  createSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 32,
    maxHeight: '85%',
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  memberList: {
    maxHeight: 260,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkmark: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});
