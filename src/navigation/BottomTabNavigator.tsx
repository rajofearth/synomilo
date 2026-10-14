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
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';
import { useIsKeyboardVisible } from '../hooks/useIsKeyboardVisible';
import Conversations from '../components/convex/ConversationsList';
import Calls from '../components/calls/Calls';
import Profile from '../components/convex/ProfileScreen';
import { BottomTabParamList } from './types';

const Tab = createBottomTabNavigator<BottomTabParamList>();

type TabIconName = 'chat-outline' | 'phone-outline' | 'account-outline';

const icons: Record<keyof BottomTabParamList, TabIconName> = {
  Chats: 'chat-outline',
  Calls: 'phone-outline',
  Profile: 'account-outline',
};

/**
 * Tab labels are literal, not translated.
 *
 * This used to be `t(route.name.toUpperCase())` against the CometChat i18n bundle.
 * That bundle has `CHATS` and `CALLS` but no `PROFILE`, and `CometChatLocalizationHelper`
 * returns the key itself when a lookup misses — so adding Profile as a tab would have
 * rendered the label as a shouted `PROFILE` sitting under two sentence-case siblings.
 */
const labels: Record<keyof BottomTabParamList, string> = {
  Chats: 'Chats',
  Calls: 'Calls',
  Profile: 'Profile',
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

/**
 * The tab set is fixed, and that is the point.
 *
 * This used to read `settings.layout.tabs` out of the no-code config store and map it
 * over a `TAB_COMPONENTS` record, silently dropping any key with no component behind
 * it. In practice the store shipped `groups`, which had no entry, so the
 * "configurable" tab bar was a fixed three-tab bar wearing a filter as a disguise —
 * and the filter was the only thing the config could actually influence. `Groups` and
 * `Users` are gone now (groups are gone from the app; the user directory became the
 * Add Contact screen and Profile became a tab), so the store lookup is gone with them.
 * `settings.layout` still exists for `compactMessageComposer`, which ThreadView reads.
 */
const TABS: {
  name: keyof BottomTabParamList;
  component: React.ComponentType<any>;
}[] = [
  { name: 'Chats', component: Conversations },
  { name: 'Calls', component: Calls },
  { name: 'Profile', component: Profile },
];

const BottomTabNavigator = () => {
  const paper = usePaperTheme();
  const isKeyboardVisible = useIsKeyboardVisible();

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
        tabBarIcon: ({ focused }) => (
          <TabIcon focused={focused} name={icons[route.name]} />
        ),
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
            {labels[route.name]}
          </Text>
        ),
        tabBarButton: props => <CustomTabBarButton {...props} />,
      })}
    >
      {TABS.map(tab => (
        <Tab.Screen
          key={tab.name}
          name={tab.name}
          component={tab.component}
        />
      ))}
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
