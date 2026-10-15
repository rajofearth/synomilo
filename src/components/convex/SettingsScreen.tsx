import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppState,
  Linking,
  Modal,
  NativeModules,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';
import DeviceInfo from 'react-native-device-info';
import { Button, Text, useTheme } from 'react-native-paper';
import { useSession } from '../../auth/SessionProvider';
import { APP_NAME } from '../../utils/AppConstants';
import { PinField, useAppLock } from '../security/AppLock';
import {
  APP_LOCK_GRACE_OPTIONS,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
} from '../../security/secureStore';
import { getBiometricAvailability } from '../../security/biometric';

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
 * It also had a hardcoded `#E5484D` on the sign-out row. That was the one
 * non-monochrome pixel in a black & white app, and it was invisible-as-a-colour on
 * the dark scheme where the same hex reads as a dim maroon. Sign out is destructive
 * by *position*, not by hue, so it is now expressed with the `error` role from the
 * monochrome palette.
 *
 * The version/platform and the GitHub / source / email rows used to live on the Profile
 * screen, which is about the person and nothing else. They came here rather than being
 * dropped: the version was already on this screen (it was rendered twice across the app;
 * see `AppConstants.versionNumber`'s comment), so only the platform row is new.
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

/**
 * Create-or-change PIN.
 *
 * Two stages, because a mistyped PIN that is accepted once is a lock nobody can
 * get back into. The confirm stage is what makes that a non-event.
 *
 * The PIN is never stored here. It is held in component state long enough to
 * hash, passed once to `SecureStore.setPin`, and dropped on close - it becomes a
 * PBKDF2-HMAC-SHA256 verifier over a 32-byte per-install salt inside the
 * encrypted store, and there is no read path that could return it.
 */
type PinSheetProps = {
  visible: boolean;
  mode: 'create' | 'change';
  busy: boolean;
  onCancel: () => void;
  onSubmit: (pin: string) => void;
};

const PinSheet = ({ visible, mode, busy, onCancel, onSubmit }: PinSheetProps) => {
  const { colors } = useTheme();
  const [stage, setStage] = useState<'enter' | 'confirm'>('enter');
  const [pin, setPin] = useState('');
  const [first, setFirst] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setStage('enter');
      setPin('');
      setFirst('');
      setError(null);
    }
  }, [visible]);

  const advance = useCallback(() => {
    if (pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) {
      setError(`Use ${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digits.`);
      return;
    }
    if (stage === 'enter') {
      setFirst(pin);
      setPin('');
      setError(null);
      setStage('confirm');
      return;
    }
    if (pin !== first) {
      // Deliberately not "the PINs did not match" - same thing, fewer characters,
      // and it does not restate what was typed.
      setError('Those did not match. Start again.');
      setPin('');
      setFirst('');
      setStage('enter');
      return;
    }
    onSubmit(pin);
  }, [pin, first, stage, onSubmit]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <Pressable
        style={[styles.sheetBackdrop, { backgroundColor: colors.scrim }]}
        onPress={onCancel}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
      />
      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.elevation.level2, borderColor: colors.outlineVariant },
        ]}
        accessibilityViewIsModal
      >
        <Text variant="titleMedium" style={{ color: colors.onSurface }}>
          {mode === 'create' ? 'Create a PIN' : 'Change your PIN'}
        </Text>
        <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
          {stage === 'enter'
            ? `Choose ${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digits. You will need it if biometrics ever fail.`
            : 'Enter it once more to confirm.'}
        </Text>

        <PinField
          label={stage === 'enter' ? 'New PIN' : 'Confirm PIN'}
          value={pin}
          onChange={next => {
            setPin(next);
            setError(null);
          }}
          onSubmit={advance}
          autoFocus
          disabled={busy}
        />

        {error ? (
          <Text
            variant="bodyMedium"
            accessibilityLiveRegion="polite"
            style={{ color: colors.onError }}
          >
            {error}
          </Text>
        ) : null}

        <View style={styles.sheetActions}>
          <Button
            onPress={onCancel}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            accessibilityState={{ disabled: busy }}
          >
            Cancel
          </Button>
          <Button
            mode="contained"
            onPress={advance}
            disabled={busy}
            loading={busy}
            accessibilityRole="button"
            accessibilityLabel={stage === 'enter' ? 'Continue' : 'Save PIN'}
            accessibilityState={{ disabled: busy, busy }}
          >
            {stage === 'enter' ? 'Continue' : 'Save'}
          </Button>
        </View>
      </View>
    </Modal>
  );
};

const SettingsScreen = ({ navigation }: any) => {
  const { colors } = useTheme();
  const { signOut } = useSession();
  const [batteryAllowed, setBatteryAllowed] = useState<boolean | null>(null);

  const lockStatus = useAppLock(state => state.status);
  const lockEnabled = useAppLock(state => state.enabled);
  const lockGraceMs = useAppLock(state => state.graceMs);
  const lockPinSet = useAppLock(state => state.pinSet);
  const lockBusy = useAppLock(state => state.busy);
  const lockError = useAppLock(state => state.error);
  const lockAvailability = useAppLock(state => state.availability);
  const lockBackend = useAppLock(state => state.backend);
  const refreshLock = useAppLock(state => state.refresh);
  const enableLock = useAppLock(state => state.enable);
  const changeLockPin = useAppLock(state => state.changePin);
  const disableLock = useAppLock(state => state.disable);
  const setLockGrace = useAppLock(state => state.setGrace);

  const [pinSheet, setPinSheet] = useState<'create' | 'change' | null>(null);

  /**
   * Re-read the lock when this screen comes back into view.
   *
   * Settings is reachable while the gate is armed, and the gate can change state
   * underneath (the user may have just been re-locked on foreground). Refreshing
   * on focus means the rows describe reality rather than what was true when the
   * screen mounted.
   */
  useEffect(() => {
    refreshLock();
    getBiometricAvailability()
      .then(found => useAppLock.getState().setAvailability(found))
      .catch(() => {});
    const subscription = navigation.addListener?.('focus', () => {
      refreshLock().catch(() => {});
    });
    return () => subscription?.remove?.();
  }, [navigation, refreshLock]);

  const biometricLabel = useMemo(() => {
    if (lockAvailability?.available) {
      return 'On: biometrics, with PIN fallback';
    }
    if (lockAvailability?.reason === 'noneEnrolled') {
      return 'On: PIN only (no biometrics enrolled)';
    }
    if (lockAvailability?.reason === 'permissionMissing') {
      return 'On: PIN only (biometrics unavailable)';
    }
    return 'On: PIN only (biometrics unavailable)';
  }, [lockAvailability]);

  const lockDescription = (() => {
    if (lockStatus === 'unsupported') {
      return 'Not available on this platform';
    }
    if (lockStatus === 'unknown') {
      return 'Checking…';
    }
    if (lockStatus === 'storeBroken') {
      return 'On: secure storage unreadable, reset required';
    }
    return lockEnabled ? biometricLabel : 'Off';
  })();

  const submitPin = useCallback(
    async (pin: string) => {
      const ok =
        pinSheet === 'create' ? await enableLock(pin) : await changeLockPin(pin);
      if (ok) {
        setPinSheet(null);
      }
    },
    [pinSheet, enableLock, changeLockPin],
  );

  const confirmDisable = useCallback(() => {
    Alert.alert(
      'Turn off the app lock?',
      `${APP_NAME} will stop asking for a fingerprint or PIN when it opens. Your PIN will be erased from this device.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Turn off',
          style: 'destructive',
          onPress: () => {
            disableLock().catch(() => {});
          },
        },
      ],
    );
  }, [disableLock]);

  const confirmGraceChange = useCallback(
    (ms: number) => {
      Alert.alert(
        'Lock when returning to the app',
        ms === 0
          ? `${APP_NAME} will lock the moment it goes into the background.`
          : `${APP_NAME} will lock if you are away for more than ${
              APP_LOCK_GRACE_OPTIONS.find(option => option.ms === ms)?.label.replace(
                /^After /,
                '',
              ) ?? `${Math.round(ms / 1000)} seconds`
            }.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Set', onPress: () => { setLockGrace(ms).catch(() => {}); } },
        ],
      );
    },
    [setLockGrace],
  );

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
          * APP LOCK. Placed above ABOUT because it is the one row on this screen
          * that changes what the app shows on open, and it is the section people
          * look for when they are worried about someone else picking up the phone.
          */}
        {lockStatus !== 'unsupported' ? (
          <View style={[styles.card, card]}>
            <Text variant="labelLarge" style={styles.sectionLabel}>
              APP LOCK
            </Text>

            <SettingRow
              icon="shield-lock-outline"
              title="Require unlock"
              description={lockDescription}
              trailing={
                lockEnabled ? (
                  <MaterialDesignIcons name="check" size={20} color={colors.onSurface} />
                ) : (
                  <MaterialDesignIcons name="check" size={20} color={colors.outline} />
                )
              }
              onPress={() => {
                if (lockEnabled) {
                  confirmDisable();
                } else {
                  setPinSheet('create');
                }
              }}
              disabled={lockBusy || lockStatus === 'unknown' || lockStatus === 'storeBroken'}
            />

            {lockEnabled ? (
              <>
                <View
                  style={[styles.divider, { backgroundColor: colors.outlineVariant }]}
                />
                <SettingRow
                  icon="pin-outline"
                  title="Change PIN"
                  description={
                    lockPinSet
                      ? 'Requires biometrics to be off, or your current PIN'
                      : 'Set a PIN to unlock without biometrics'
                  }
                  trailing={<Chevron />}
                  onPress={() => setPinSheet('change')}
                  disabled={lockBusy || lockStatus === 'storeBroken'}
                />
                <View
                  style={[styles.divider, { backgroundColor: colors.outlineVariant }]}
                />
                <SettingRow
                  icon="timer-sand"
                  title="Lock when returning"
                  description={
                    APP_LOCK_GRACE_OPTIONS.find(
                      option => option.ms === lockGraceMs,
                    )?.label ?? 'After 30 seconds'
                  }
                  trailing={<Chevron />}
                  onPress={() => {
                    const index = APP_LOCK_GRACE_OPTIONS.findIndex(
                      option => option.ms === lockGraceMs,
                    );
                    const next =
                      APP_LOCK_GRACE_OPTIONS[
                        (index + 1) % APP_LOCK_GRACE_OPTIONS.length
                      ];
                    confirmGraceChange(next.ms);
                  }}
                  disabled={lockBusy || lockStatus === 'storeBroken'}
                />
              </>
            ) : null}

            {lockError ? (
              <Text
                variant="bodyMedium"
                accessibilityLiveRegion="polite"
                style={[styles.lockError, { color: colors.onError }]}
              >
                {lockError}
              </Text>
            ) : null}

            <Text variant="bodySmall" style={[styles.lockNote, { color: colors.onSurfaceVariant }]}>
              Two wrong PINs are free; after that the app waits 30 seconds, doubling up to
              15 minutes. It never locks you out permanently. If you forget the PIN, the
              lock screen signs you out and erases it so you can sign in again.
              {lockBackend ? ` Storage: ${lockBackend}.` : ''}
            </Text>
          </View>
        ) : null}

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

      <PinSheet
        visible={pinSheet !== null}
        mode={pinSheet === 'change' ? 'change' : 'create'}
        busy={lockBusy}
        onCancel={() => setPinSheet(null)}
        onSubmit={submitPin}
      />
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
  lockError: {
    paddingVertical: 8,
  },
  lockNote: {
    paddingTop: 10,
    paddingBottom: 12,
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
    gap: 14,
  },
  sheetActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
});