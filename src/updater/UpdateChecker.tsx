import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  DeviceEventEmitter,
  NativeModules,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  Button,
  Dialog,
  Portal,
  ProgressBar,
  Text,
  useTheme,
} from 'react-native-paper';
import { useAction } from 'convex/react';
import DeviceInfo from 'react-native-device-info';
import { api } from '../../convex/_generated/api';
import { useSession } from '../auth/SessionProvider';

type UpdateInfo = {
  version: string;
  notes: string;
  url: string;
  size: number;
};

type Phase = 'prompt' | 'settings' | 'downloading' | 'done' | 'error';

const UpdateChecker = () => {
  const theme = useTheme();
  const { token } = useSession();
  const check = useAction(api.updates.check);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [phase, setPhase] = useState<Phase>('prompt');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const updateRef = useRef<UpdateInfo | null>(null);
  const dismissedVersion = useRef<string | null>(null);
  const checking = useRef(false);

  const showUpdate = useCallback((info: UpdateInfo) => {
    updateRef.current = info;
    setUpdate(info);
    setPhase('prompt');
    setProgress(0);
    setError(null);
  }, []);

  const checkForUpdate = useCallback(async () => {
    if (!token || checking.current) {
      return;
    }
    checking.current = true;
    try {
      const result = await check({
        currentVersion: DeviceInfo.getVersion(),
      });
      if (
        result &&
        result.version !== dismissedVersion.current &&
        !updateRef.current
      ) {
        showUpdate(result);
      }
    } catch (checkError) {
      console.warn('update check failed', checkError);
    } finally {
      checking.current = false;
    }
  }, [check, token, showUpdate]);

  useEffect(() => {
    if (!token) {
      updateRef.current = null;
      setUpdate(null);
      return;
    }
    checkForUpdate();
    const interval = setInterval(checkForUpdate, 60000);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        checkForUpdate();
      }
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [token, checkForUpdate]);

  const close = () => {
    if (updateRef.current) {
      dismissedVersion.current = updateRef.current.version;
    }
    updateRef.current = null;
    setUpdate(null);
    setPhase('prompt');
    setProgress(0);
    setError(null);
  };

  const startUpdate = async () => {
    const info = updateRef.current;
    if (!info) {
      return;
    }
    setError(null);
    try {
      const allowed = await NativeModules.Installer.canInstall();
      if (!allowed) {
        setPhase('settings');
        NativeModules.Installer.openInstallSettings().catch(() => {});
        return;
      }
      setPhase('downloading');
      setProgress(0);
      const subscription = DeviceEventEmitter.addListener(
        'synomilo_update_progress',
        (event: { progress?: number }) => {
          const value = Number(event?.progress ?? 0);
          setProgress(Math.max(0, Math.min(100, value)));
        },
      );
      try {
        const path = await NativeModules.Installer.download(
          info.url,
          `synomilo-${info.version}.apk`,
        );
        setProgress(100);
        setPhase('done');
        await NativeModules.Installer.install(path);
      } finally {
        subscription.remove();
      }
    } catch {
      setPhase('error');
      setError('The update could not be completed. Tap Update to try again.');
    }
  };

  if (!update) {
    return null;
  }

  return (
    <Portal>
      <Dialog
        visible
        onDismiss={phase === 'downloading' ? undefined : close}
        style={[
          styles.dialog,
          { backgroundColor: theme.colors.elevation.level3 },
        ]}
      >
        <Dialog.Title style={{ color: theme.colors.onSurface }}>
          {`Version ${update.version} available`}
        </Dialog.Title>
        <Dialog.Content>
          <ScrollView style={styles.notes}>
            <Text
              variant="bodyMedium"
              style={{ color: theme.colors.onSurfaceVariant }}
            >
              {update.notes || 'No release notes.'}
            </Text>
          </ScrollView>
          {phase === 'downloading' ? (
            <View style={styles.progressBlock}>
              <Text
                variant="bodyMedium"
                style={{ color: theme.colors.onSurfaceVariant }}
              >
                Downloading update.
              </Text>
              <ProgressBar
                progress={progress / 100}
                color={theme.colors.primary}
                style={styles.progress}
              />
              <Text
                variant="bodySmall"
                style={{ color: theme.colors.onSurfaceVariant }}
              >
                {`${progress}%`}
              </Text>
            </View>
          ) : null}
          {phase === 'settings' ? (
            <Text
              variant="bodyMedium"
              style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}
            >
              Allow installs from synomiló in the next screen, then tap Update
              again.
            </Text>
          ) : null}
          {phase === 'done' ? (
            <Text
              variant="bodyMedium"
              style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}
            >
              Downloaded, starting installer
            </Text>
          ) : null}
          {error ? (
            <Text
              variant="bodyMedium"
              style={[styles.hint, { color: theme.colors.error }]}
            >
              {error}
            </Text>
          ) : null}
        </Dialog.Content>
        <Dialog.Actions>
          {phase === 'done' ? (
            <Button textColor={theme.colors.onSurfaceVariant} onPress={close}>
              Done
            </Button>
          ) : (
            <>
              <Button textColor={theme.colors.onSurfaceVariant} onPress={close}>
                Later
              </Button>
              <Button
                onPress={startUpdate}
                loading={phase === 'downloading'}
                disabled={phase === 'downloading'}
              >
                Update
              </Button>
            </>
          )}
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
};

const styles = StyleSheet.create({
  dialog: {
    borderRadius: 28,
  },
  notes: {
    maxHeight: 220,
  },
  progress: {
    marginTop: 8,
  },
  progressBlock: {
    marginTop: 12,
  },
  hint: {
    marginTop: 12,
  },
});

export default UpdateChecker;
