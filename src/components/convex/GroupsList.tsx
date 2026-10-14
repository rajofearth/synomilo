import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';
import { useQuery, useMutation } from 'convex/react';
import { Text, TextInput, useTheme } from 'react-native-paper';
import { api } from '../../../convex/_generated/api';
import { useSession } from '../../auth/SessionProvider';
import { convexErrorMessage } from '../../utils/convexError';
import UserAvatar from './UserAvatar';

type GroupRow = {
  _id: string;
  type: 'dm' | 'group';
  title: string;
  emoji: string | null;
  avatarUrl: string | null;
  memberCount: number;
  lastMessagePreview: string;
};

type UserRow = {
  _id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
};

/**
 * Colours and text styles come from react-native-paper's theme only.
 *
 * This file read the UIKit's `theme.color.*` / `theme.typography.*`, which
 * `App.tsx` freezes into a single palette (one object passed to both the UIKit's `light`
 * and `dark` slots), so it did not follow the OS colour scheme. Paper's theme is rebuilt
 * on every `useColorScheme()` change.
 *
 * Three hardcoded whites came out with it — `#FFFFFF` on the header "+", on the member
 * checkmark, and `#fff` on the create-group button text.
 */
const GroupsList = ({ navigation }: any) => {
  const { colors } = useTheme();
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
      Alert.alert('Name needed', 'Enter a group name.');
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
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      <View style={styles.header}>
        <Text variant="headlineMedium" style={{ color: colors.onSurface }}>
          Groups
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create a group"
          style={({ pressed }) => [
            styles.addButton,
            { backgroundColor: colors.primary, opacity: pressed ? 0.7 : 1 },
          ]}
          onPress={() => setCreateOpen(true)}
        >
          <MaterialDesignIcons name="plus" size={24} color={colors.onPrimary} />
        </Pressable>
      </View>

      {conversations === undefined ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.onSurfaceVariant} />
        </View>
      ) : groups.length === 0 ? (
        <View style={styles.center}>
          <Text variant="headlineSmall" style={{ color: colors.onSurface }}>
            No groups yet
          </Text>
          <Text
            variant="bodyMedium"
            style={[styles.emptyHint, { color: colors.onSurfaceVariant }]}
          >
            Create a group for your wedding party, family, or guests.
          </Text>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.ctaButton,
              { backgroundColor: colors.primary, opacity: pressed ? 0.7 : 1 },
            ]}
            onPress={() => setCreateOpen(true)}
          >
            <Text variant="labelLarge" style={{ color: colors.onPrimary }}>
              Create a group
            </Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={item => item._id}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: colors.surfaceVariant },
              ]}
              onPress={() =>
                navigation.navigate('Messages', {
                  conversationId: item._id,
                  title: item.title,
                })
              }
            >
              <UserAvatar
                entity={item}
                name={item.title}
                size={52}
                variant="text"
                shape="rounded"
                containerStyle={[
                  styles.groupAvatar,
                  { backgroundColor: colors.primaryContainer },
                ]}
                labelStyle={styles.groupInitials}
                labelColor={colors.onPrimaryContainer}
              />
              <View style={styles.rowBody}>
                <Text variant="bodyLarge" style={{ color: colors.onSurface }}>
                  {item.title}
                </Text>
                <Text
                  numberOfLines={1}
                  variant="bodySmall"
                  style={{ color: colors.onSurfaceVariant }}
                >
                  {item.memberCount}{' '}
                  {item.memberCount === 1 ? 'member' : 'members'} ·{' '}
                  {item.lastMessagePreview}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}

      <Modal
        visible={createOpen}
        transparent
        animationType="slide"
        onRequestClose={closeCreate}
      >
        <Pressable
          style={[styles.modalBackdrop, { backgroundColor: colors.scrim }]}
          onPress={closeCreate}
        >
          <Pressable
            style={[
              styles.createSheet,
              { backgroundColor: colors.surface },
            ]}
            onPress={() => {}}
          >
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text
                variant="headlineSmall"
                style={{ color: colors.onSurface, marginBottom: 12 }}
              >
                New group
              </Text>
              <TextInput
                mode="outlined"
                value={groupName}
                onChangeText={setGroupName}
                placeholder="Group name"
                outlineStyle={styles.input}
                outlineColor={colors.outlineVariant}
                activeOutlineColor={colors.onSurface}
              />
              <Text
                variant="labelMedium"
                style={{
                  color: colors.onSurfaceVariant,
                  marginTop: 16,
                  marginBottom: 8,
                }}
              >
                Add members
              </Text>
              <View style={styles.memberList}>
                {(users ?? []).map(item => {
                  const selected = selectedIds.includes(item._id);
                  return (
                    <Pressable
                      key={item._id}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      style={({ pressed }) => [
                        styles.memberRow,
                        pressed && { opacity: 0.6 },
                      ]}
                      onPress={() => toggleMember(item._id)}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          {
                            borderColor: selected
                              ? colors.primary
                              : colors.outlineVariant,
                            backgroundColor: selected
                              ? colors.primary
                              : 'transparent',
                          },
                        ]}
                      >
                        {selected && (
                          <MaterialDesignIcons
                            name="check"
                            size={14}
                            color={colors.onPrimary}
                          />
                        )}
                      </View>
                      <UserAvatar
                        entity={item}
                        name={item.displayName}
                        size={34}
                        variant="text"
                        containerStyle={[
                          styles.memberAvatar,
                          { backgroundColor: colors.primaryContainer },
                        ]}
                        labelStyle={styles.memberInitials}
                        labelColor={colors.onPrimaryContainer}
                      />
                      <Text variant="bodyLarge" style={{ color: colors.onSurface }}>
                        {item.displayName}
                      </Text>
                    </Pressable>
                  );
                })}
                {(users ?? []).length === 0 ? (
                  <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                    No other users yet.
                  </Text>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.ctaButton,
                  styles.sheetCta,
                  {
                    backgroundColor: colors.primary,
                    opacity: creating ? 0.6 : pressed ? 0.7 : 1,
                  },
                ]}
                onPress={submitCreate}
                disabled={creating}
              >
                {creating ? (
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                ) : (
                  <Text variant="labelLarge" style={{ color: colors.onPrimary }}>
                    Create group
                  </Text>
                )}
              </Pressable>
            </ScrollView>
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
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 8,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  groupAvatar: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupInitials: {
    fontSize: 18,
    fontWeight: '700',
  },
  memberAvatar: {
    marginRight: 12,
  },
  memberInitials: {
    fontSize: 13,
    fontWeight: '700',
  },
  rowBody: {
    flex: 1,
    marginLeft: 12,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  createSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 32,
    maxHeight: '85%',
  },
  input: {
    borderRadius: 16,
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
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  sheetCta: {
    marginTop: 12,
  },
});