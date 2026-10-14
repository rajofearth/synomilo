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
import { APP_NAME } from '../../utils/AppConstants';

const GITHUB_URL = 'https://github.com/rajofearth';
const SOURCE_URL = 'https://github.com/rajofearth/synomilo';
const EMAIL_URL = 'mailto:rajofearth@proton.me';

/**
 * Everything the old version did, regrouped:
 *
 *   - open the OS notification settings for this app
 *   - read whether battery optimisation is exempt, re-read on every foreground
 *   - jump to the battery-optimisation exemption screen when it is not
 *   - show the app name, its version, and the device it runs on
 * the maintainer's email
 *   - sign out, behind a confirm
 *
 * It also had a hardcoded `#E5484D` on the sign-out row — the one non-monochrome pixel
 * in a black & white app, and invisible-as-a-colour on the dark scheme where the same
 * hex reads as a dim maroon. Sign out is destructive by *position*, not by hue, so it is
 * now expressed with the `error` role from the monochrome palette.
 *
 * The version/platform and the GitHub / source / email rows used to live on the Profile
 * screen, which is about the person and nothing else. They came here rather than being
 * dropped: the version was already on this screen (it was rendered twice across the app
 * — see `AppConstants.versionNumber`'s comment), so only the platform row is new.
 */

/**
 * One row, one rhythm.
 *
 * Six rows across three cards plus the sign-out row is enough repetition that the
 * hand-written version of this markup drifted (the battery row's `disabled` dimmed
 * differently from every other row, the about row had no chevron because it is not
 * tappable). The `trailing` slot keeps those differences explicit instead of
 * accidental.
 */
const SettingRow = ({
  icon,
  title,
  description,
  trailing,
  onPress,
  disabled,
}: {
  icon: string;
  title: string;
  description?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
}) => {
  const { colors } = useTheme();
  const tappable = onPress != null && disabled !== true;
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        pressed && tappable && { opacity: 0.6 },
      ]}
      accessibilityRole={tappable ? 'button' : undefined}
      accessibilityState={{ disabled: tappable ? false : onPress != null }}
      disabled={!tappable}
      onPress={onPress}
    >
      <View style={[styles.icon, { backgroundColor: colors.surfaceVariant }]}>
        <MaterialDesignIcons
          name={icon as never}
          size={20}
          color={colors.onSurfaceVariant}
        />
      </View>
      <View style={styles.rowBody}>
        <Text variant="bodyLarge" style={{ color: colors.onSurface }}>
          {title}
        </Text>
        {description ? (
          <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
            {description}
          </Text>
        ) : null}
      </View>
      {trailing ?? null}
    </Pressable>
  );
};

const Chevron = () => {
  const { colors } = useTheme();
  return (
    <MaterialDesignIcons name="chevron-right" size={20} color={colors.outline} />
  );
};

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

  const openLink = useCallback((url: string) => {
    Linking.openURL(url).catch(() => {});
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

  const versionLabel = `${DeviceInfo.getVersion()} (${DeviceInfo.getBuildNumber()})`;
  const platformLabel = `${DeviceInfo.getSystemName()} ${DeviceInfo.getSystemVersion()}`;

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
          <SettingRow
            icon="bell-outline"
            title="App notification settings"
            description={`Open system settings for ${APP_NAME}`}
            trailing={<Chevron />}
            onPress={openSystemSettings}
          />
        </View>

        <View style={[styles.card, card]}>
          <Text variant="labelLarge" style={styles.sectionLabel}>
            CALLS
          </Text>
          <SettingRow
            icon="battery-heart-outline"
            title="Battery optimization"
            description={batteryDescription}
            trailing={
              batteryAllowed === false ? (
                <Text variant="labelLarge" style={{ color: colors.onSurface }}>
                  Fix
                </Text>
              ) : (
                <MaterialDesignIcons
                  name="check"
                  size={20}
                  color={batteryAllowed ? colors.onSurface : colors.outline}
                />
              )
            }
            onPress={openBatterySettings}
            disabled={batteryAllowed !== false}
          />
        </View>

        {/**
         * Where the Profile screen's APP card went. The version line already lived
         * here, so it is the platform row that is genuinely new here; the relocated
         * version row was the app's second rendering of the same `DeviceInfo` value.
         */}
        <View style={[styles.card, card]}>
          <Text variant="labelLarge" style={styles.sectionLabel}>
            ABOUT
          </Text>
          <SettingRow
            icon="information-outline"
            title={APP_NAME}
            description={`Version ${versionLabel}`}
          />
          <View
            style={[styles.divider, { backgroundColor: colors.outlineVariant }]}
          />
          <SettingRow
            icon="cellphone"
            title="Platform"
            description={platformLabel}
          />
        </View>

        <View style={[styles.card, card]}>
          <Text variant="labelLarge" style={styles.sectionLabel}>
            LINKS
          </Text>
          <SettingRow
            icon="github"
            title="GitHub"
            trailing={<Chevron />}
            onPress={() => openLink(GITHUB_URL)}
          />
          <View
            style={[styles.divider, { backgroundColor: colors.outlineVariant }]}
          />
          <SettingRow
            icon="source-repository"
            title="Source code"
            trailing={<Chevron />}
            onPress={() => openLink(SOURCE_URL)}
          />
          <View
            style={[styles.divider, { backgroundColor: colors.outlineVariant }]}
          />
          <SettingRow
            icon="email-outline"
            title="Email"
            trailing={<Chevron />}
            onPress={() => openLink(EMAIL_URL)}
          />
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
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 48,
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