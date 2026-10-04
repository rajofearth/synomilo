import {CometChat} from '@cometchat/chat-sdk-react-native';
import {CometChatUsers, useTheme} from '@cometchat/chat-uikit-react-native';
import React, {useCallback, useLayoutEffect} from 'react';
import {SafeAreaView} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {RootStackParamList} from '../../navigation/types';
import {StackNavigationProp} from '@react-navigation/stack';

type AIAgentNavigationProp = StackNavigationProp<RootStackParamList, 'AIAgents'>;

const AIAgents: React.FC = () => {
  const theme = useTheme();
  const navigation = useNavigation<AIAgentNavigationProp>();
  const [shouldHide, setShouldHide] = React.useState(false);

  // Focus effect to manage component visibility
  useFocusEffect(
    useCallback(() => {
      setShouldHide(false);
      return () => {
        setShouldHide(true);
      };
    }, []),
  );

  // Configure header with back button
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: false,
      title: 'AI Assistants',
      headerStyle: {
        backgroundColor: theme.color.background1,
      },
      headerTitleStyle: {
        color: theme.color.textPrimary,
      },
    });
  }, [navigation, theme]);

  const handleUserPress = (user: CometChat.User) => {
    navigation.navigate('Messages', { user });
  };

  return shouldHide ? null : (
    <SafeAreaView style={{flex: 1, backgroundColor: theme.color.background1}}>
      <CometChatUsers
        onItemPress={handleUserPress}
        title='Assistants'
        showBackButton={true}
        onBack={() => navigation.goBack()}
        usersRequestBuilder={new CometChat.UsersRequestBuilder()
          .setLimit(30)
          .hideBlockedUsers(false)
          .setRoles(['@agentic'])
          .friendsOnly(false)
          .setStatus('')
          .setTags([])
          .sortBy('name')
          .setUIDs([])}
      />
    </SafeAreaView>
  );
};

export default AIAgents;