import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  AppState,
  Linking,
  NativeModules,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';
import DeviceInfo from 'react-native-device-info';
import { Text, useTheme } from 'react-native-paper';
import { useSession } from '../../auth/SessionProvider';

/**
 * Everything the old version did, regrouped:
 *
 *   - open the OS notification settings for this app
 *   - read whether battery optimisation is exempt, re-read on every foreground
 *   - jump to the battery-optimisation exemption screen when it is not
 *   - show the app name and version
 *   - sign out, behind a confirm
 *
 * It also had a hardcoded `#E5484D` on the sign-out row — the one non-monochrome pixel
 * in a black & white app, and invisible-as-a-colour on the dark scheme where the same
 * hex reads as a dim maroon. Sign out is destructive by *position*, not by hue, so it is
 * now expressed with the `error` role from the monochrome palette.
 */
const SettingsScreen = ({ navigation }: any) => {
  const { colors } = useTheme();
  const { signOut } = useSession();
  const [batteryAllowed, setBatteryAllowed] = useState<boolean | null>(null);

  const refreshBatteryState = useCallback(() => {
    NativeModules.Installer?.isIgnoringBatteryOptimizations?.()
      ?.then((allowed: boolean) => setBatteryAllowed(allowed))
      ?.catch(() => {});
  }, []);

  useEffect(() => {
    refreshBatteryState();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        refreshBatteryState();
      }
    });
    return () => subscription.remove();
  }, [refreshBatteryState]);

  const openBatterySettings = useCallback(() => {
    NativeModules.Installer?.openBatterySettings?.();
  }, []);

  const confirmSignOut = useCallback(() => {
    Alert.alert('Sign out', 'This will sign you out on this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          signOut().catch(() => {});
        },
      },
    ]);
  }, [signOut]);

  const openSystemSettings = useCallback(() => {
    Linking.openSettings().catch(() => {});
  }, []);

  const card = {
    backgroundColor: colors.elevation.level1,
    borderRadius: 20,
  };

  const batteryDescription =
    batteryAllowed === null
      ? 'Checking...'
      : batteryAllowed
        ? 'Allowed'
        : 'Restricted, calls may be delayed';

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [
            styles.backButton,
            {
              backgroundColor: colors.surfaceVariant,
              opacity: pressed ? 0.6 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
          onPress={() => navigation.goBack()}
        >
          <MaterialDesignIcons
            name="arrow-left"
            size={22}
            color={colors.onSurface}
          />
        </Pressable>
        <Text variant="headlineMedium" style={styles.headerTitle}>
          Settings
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.card, card]}>
          <Text variant="labelLarge" style={styles.sectionLabel}>
            NOTIFICATIONS
          </Text>
          <Pressable
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
            onPress={openSystemSettings}
          >
            <View
              style={[styles.icon, { backgroundColor: colors.surfaceVariant }]}
            >
              <MaterialDesignIcons
                name="bell-outline"
                size={20}
                color={colors.onSurfaceVariant}
              />
            </View>
            <View style={styles.rowBody}>
              <Text
                variant="bodyLarge"
                style={[styles.rowTitle, { color: colors.onSurface }]}
              >
                App notification settings
              </Text>
              <Text
                variant="bodyMedium"
                style={{ color: colors.onSurfaceVariant }}
              >
                Open system settings for synomiló
              </Text>
            </View>
            <MaterialDesignIcons
              name="chevron-right"
              size={20}
              color={colors.outline}
            />
          </Pressable>
        </View>

        <View style={[styles.card, card]}>
          <Text variant="labelLarge" style={styles.sectionLabel}>
            CALLS
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.row,
              pressed && batteryAllowed === false && { opacity: 0.6 },
            ]}
            disabled={batteryAllowed !== false}
            onPress={openBatterySettings}
          >
            <View
              style={[styles.icon, { backgroundColor: colors.surfaceVariant }]}
            >
              <MaterialDesignIcons
                name="battery-heart-outline"
                size={20}
                color={colors.onSurfaceVariant}
              />
            </View>
            <View style={styles.rowBody}>
              <Text
                variant="bodyLarge"
                style={[styles.rowTitle, { color: colors.onSurface }]}
              >
                Battery optimization
              </Text>
              <Text
                variant="bodyMedium"
                style={{ color: colors.onSurfaceVariant }}
              >
                {batteryDescription}
              </Text>
            </View>
            {batteryAllowed === false ? (
              <Text variant="labelLarge" style={{ color: colors.onSurface }}>
                Fix
              </Text>
            ) : (
              <MaterialDesignIcons
                name="check"
                size={20}
                color={batteryAllowed ? colors.onSurface : colors.outline}
              />
            )}
          </Pressable>
        </View>

        <View style={[styles.card, card]}>
          <Text variant="labelLarge" style={styles.sectionLabel}>
            ABOUT
          </Text>
          <View style={styles.row}>
            <View
              style={[styles.icon, { backgroundColor: colors.surfaceVariant }]}
            >
              <MaterialDesignIcons
                name="information-outline"
                size={20}
                color={colors.onSurfaceVariant}
              />
            </View>
            <View style={styles.rowBody}>
              <Text
                variant="bodyLarge"
                style={[styles.rowTitle, { color: colors.onSurface }]}
              >
                synomiló
              </Text>
              <Text
                variant="bodyMedium"
                style={{ color: colors.onSurfaceVariant }}
              >
                Version {DeviceInfo.getVersion()} (
                {DeviceInfo.getBuildNumber()})
              </Text>
            </View>
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.signOutRow,
            { backgroundColor: colors.errorContainer, opacity: pressed ? 0.7 : 1 },
          ]}
          accessibilityRole="button"
          onPress={confirmSignOut}
        >
          <MaterialDesignIcons
            name="logout"
            size={20}
            color={colors.onErrorContainer}
          />
          <Text
            variant="bodyLarge"
            style={[styles.rowTitle, { color: colors.onErrorContainer }]}
          >
            Sign out
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
};

export default SettingsScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 12,
  },
  card: {
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  sectionLabel: {
    paddingTop: 12,
    paddingBottom: 4,
    opacity: 0.6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    flex: 1,
  },
  signOutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 20,
    marginTop: 4,
  },
});