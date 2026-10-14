import React, { useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from 'react-native-paper';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';
import { useCallStore } from './callStore';
import { navigate } from '../../navigation/NavigationService';
import { elapsedSeconds, formatElapsed } from '../../utils/callDuration';

/**
 * "You are still in a call" bar, shown when the user comes back to the app during
 * a live call from a screen that is not the call screen.
 *
 * It exists because the alternative is invisible state: the user minimises during a
 * call, reopens the app somewhere else, and gets a chat list that looks exactly
 * like the app with no call in it. Tapping it returns to the call.
 *
 * Rendered from App.tsx above the navigator so it survives navigation. Suppressed
 * while the call screen itself is on top - it would otherwise sit on top of the
 * call the user is already looking at.
 */
const OngoingCallBar: React.FC = () => {
  const theme = useTheme();
  const active = useCallStore(state => state.active);
  const screenVisible = useCallStore(state => state.screenVisible);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      setAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    const tick = () =>
      setElapsed(
        elapsedSeconds(active.answeredAt, Date.now(), active.clockOffset),
      );
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [active]);

  if (!active || screenVisible || !appActive) {
    return null;
  }

  const open = () =>
    navigate('CallScreen', {
      callId: active.callId,
      type: active.type,
      role: active.role,
      peerName: active.peerName,
    } as never);

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`Return to the call with ${active.peerName}`}
      style={[
        styles.bar,
        { backgroundColor: theme.colors.inverseSurface },
      ]}
      onPress={open}
    >
      <MaterialDesignIcons
        name="phone-in-talk"
        size={22}
        color={theme.colors.inverseOnSurface}
      />
      <View style={styles.body}>
        <Text
          numberOfLines={1}
          style={[styles.name, { color: theme.colors.inverseOnSurface }]}
        >
          {active.peerName}
        </Text>
        <Text style={[styles.meta, { color: theme.colors.inverseSurface }]}>
          {`In call · ${formatElapsed(elapsed)}`}
        </Text>
      </View>
      <Text style={[styles.cta, { color: theme.colors.inverseOnSurface }]}>
        Return
      </Text>
    </TouchableOpacity>
  );
};

export default OngoingCallBar;

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 18,
  },
  body: {
    flex: 1,
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
  },
  meta: {
    fontSize: 13,
    marginTop: 2,
    opacity: 0.8,
  },
  cta: {
    fontSize: 13,
    fontWeight: '700',
  },
});