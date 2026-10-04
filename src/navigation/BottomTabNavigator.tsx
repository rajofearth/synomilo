import React, { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import {
  createBottomTabNavigator,
  BottomTabBarButtonProps,
} from '@react-navigation/bottom-tabs';
import { useTheme as usePaperTheme } from 'react-native-paper';
import { useCometChatTranslation } from '@cometchat/chat-uikit-react-native';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';
import { SCREEN_CONSTANTS } from '../utils/AppConstants';
import { useIsKeyboardVisible } from '../hooks/useIsKeyboardVisible';
import Conversations from '../components/convex/ConversationsList';
import Calls from '../components/calls/Calls';
import Users from '../components/convex/UsersList';
import { BottomTabParamList } from './types';
import { useConfig } from '../config/store';

const Tab = createBottomTabNavigator<BottomTabParamList>();

type TabIconName = 'chat-outline' | 'phone-outline' | 'account-outline';

const icons: Record<string, TabIconName> = {
  Chats: 'chat-outline',
  Calls: 'phone-outline',
  Users: 'account-outline',
};

const CustomTabBarButton = ({ children, onPress }: BottomTabBarButtonProps) => (
  <TouchableWithoutFeedback onPress={onPress}>
    <View style={styles.tabButton}>{children}</View>
  </TouchableWithoutFeedback>
);

type TabIconProps = {
  focused: boolean;
  name: TabIconName;
};

const TabIcon = ({ focused, name }: TabIconProps) => {
  const { colors } = usePaperTheme();
  const progress = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(progress, {
      toValue: focused ? 1 : 0,
      stiffness: 380,
      damping: 26,
      mass: 0.9,
      useNativeDriver: true,
    }).start();
  }, [focused, progress]);

  return (
    <View style={styles.iconWrap}>
      <Animated.View
        style={[
          styles.indicator,
          {
            backgroundColor: colors.primaryContainer,
            opacity: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 1],
              extrapolate: 'clamp',
            }),
            transform: [{ scaleX: progress }],
          },
        ]}
      />
      <MaterialDesignIcons
        name={name}
        size={24}
        color={focused ? colors.onPrimaryContainer : colors.onSurfaceVariant}
      />
    </View>
  );
};

const TAB_COMPONENTS: Record<
  string,
  { name: string; component: React.ComponentType<any> }
> = {
  chats: { name: SCREEN_CONSTANTS.CHATS, component: Conversations },
  calls: { name: SCREEN_CONSTANTS.CALLS, component: Calls },
  users: { name: SCREEN_CONSTANTS.USERS, component: Users },
};

const BottomTabNavigator = () => {
  const paper = usePaperTheme();
  const tabs = useConfig(state => state.settings.layout.tabs);
  const { t } = useCometChatTranslation();
  const isKeyboardVisible = useIsKeyboardVisible();

  const visibleTabs = tabs.filter(key => key.toLowerCase() !== 'groups');

  return (
    <Tab.Navigator
      initialRouteName="Chats"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: isKeyboardVisible
          ? { display: 'none' }
          : [
              styles.tabBar,
              {
                backgroundColor: paper.colors.elevation.level2,
                borderTopColor: paper.colors.outlineVariant,
              },
            ],
        animation: 'none',
        tabBarIcon: ({ focused }) => {
          const iconName = icons[route.name];
          if (!iconName) {
            return null;
          }
          return <TabIcon focused={focused} name={iconName} />;
        },
        tabBarShowLabel: true,
        tabBarLabel: ({ focused }) => (
          <Text
            style={[
              paper.fonts.labelMedium,
              styles.tabLabel,
              {
                color: focused
                  ? paper.colors.onSurface
                  : paper.colors.onSurfaceVariant,
              },
            ]}
          >
            {t(route.name.toUpperCase())}
          </Text>
        ),
        tabBarButton: props => <CustomTabBarButton {...props} />,
      })}
    >
      {visibleTabs.map(tabKey => {
        const tab = TAB_COMPONENTS[tabKey.toLowerCase()];
        return tab ? (
          <Tab.Screen
            key={tab.name}
            name={tab.name as keyof BottomTabParamList}
            component={tab.component}
          />
        ) : null;
      })}
    </Tab.Navigator>
  );
};

const styles = StyleSheet.create({
  tabBar: {
    height: 76,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  tabLabel: {
    fontSize: 12,
    marginTop: 2,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    width: 56,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicator: {
    position: 'absolute',
    width: 56,
    height: 32,
    borderRadius: 16,
  },
});

export default BottomTabNavigator;
