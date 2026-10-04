import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RouteProp } from '@react-navigation/native';
import {
  useTheme,
  CometChatUsers,
  useCometChatTranslation,
} from '@cometchat/chat-uikit-react-native';
import { RootStackParamList } from '../../../navigation/types';
import Groups from '../../groups/Groups';
import { Icon } from '@cometchat/chat-uikit-react-native';
import { CometChat } from '@cometchat/chat-sdk-react-native';
import ArrowBack from '../../../assets/icons/ArrowBack';

// Define prop types for the component using React Navigation's types
type Props = {
  route: RouteProp<RootStackParamList, 'CreateConversation'>;
  navigation: StackNavigationProp<RootStackParamList, 'CreateConversation'>;
};

const CreateConversation: React.FC<Props> = ({ route, navigation }) => {
  const theme = useTheme();
  const { t } = useCometChatTranslation();

  const {
    background1,
    background3,
    iconPrimary,
    textPrimary,
    textSecondary,
    primary,
  } = theme.color;
  const { heading1 } = theme.typography;
  const [selectedTab, setSelectedTab] = useState<'Users' | 'Groups'>('Users');

  return (
    <View style={[styles.container, { backgroundColor: background1 }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.rowCenter} onPress={navigation.goBack}>
          <Icon
            icon={<ArrowBack color={iconPrimary} height={24} width={24} />}
          />
        </TouchableOpacity>
        <Text
          style={[heading1.bold, styles.headerText, { color: textPrimary }]}
        >
          {t('NEW_CHAT')}
        </Text>
      </View>

      {/* Tab Bar */}
      <View style={[styles.tabContainer, { backgroundColor: background3 }]}>
        {['Users', 'Groups'].map(tab => (
          <TouchableOpacity
            key={tab}
            style={[
              styles.tabButton,
              selectedTab === tab && styles.activeTab,
              selectedTab === tab && { backgroundColor: background1 },
            ]}
            onPress={() => setSelectedTab(tab as 'Users' | 'Groups')}
          >
            <Text
              style={[
                styles.tabText,
                { color: selectedTab === tab ? primary : textSecondary },
              ]}
            >
              {t(tab.toUpperCase())}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      <View style={styles.content}>
        {selectedTab === 'Users' ? (
          <CometChatUsers
            usersRequestBuilder={new CometChat.UsersRequestBuilder()
              .setLimit(30)
              .hideBlockedUsers(false)
              .setRoles([])
              .friendsOnly(false)
              .setStatus('')
              .setTags([])
              .sortBy('name')
              .setUIDs([])}
            hideHeader
            onItemPress={(user: CometChat.User) =>
              navigation.navigate('Messages', { user })
            }
          />
        ) : (
          <Groups hideHeader />
        )}
      </View>
    </View>
  );
};

export default CreateConversation;

// Style definitions for the component
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingTop: 15,
    paddingLeft: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowCenter: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerText: {
    paddingLeft: 5,
  },
  tabContainer: {
    marginTop: 20,
    flexDirection: 'row',
    marginHorizontal: 20,
    borderRadius: 30,
    padding: 5,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 30,
  },
  activeTab: {
    borderRadius: 30,
  },
  tabText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
  },
});
