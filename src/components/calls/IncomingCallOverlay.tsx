import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { useSession } from '../../auth/SessionProvider';
import { navigate } from '../../navigation/NavigationService';
import { convexErrorMessage } from '../../utils/convexError';
import {
  dismissAllCallNotifications,
  dismissCallNotification,
} from '../../notifications/callNotifications';

const IncomingCallOverlay: React.FC = () => {
  const { token } = useSession();
  const incoming = useQuery(
    api.calls.incoming,
    token ? { token } : 'skip',
  ) as
    | {
        _id: string;
        type: 'audio' | 'video';
        caller: { displayName: string } | null;
      }
    | null
    | undefined;
  const acceptCall = useMutation(api.calls.accept);
  const rejectCall = useMutation(api.calls.reject);
  const [busy, setBusy] = useState(false);

  const accept = useCallback(async () => {
    if (!token || !incoming || busy) {
      return;
    }
    setBusy(true);
    try {
      await acceptCall({ token, callId: incoming._id as any });
      dismissCallNotification(incoming._id);
      const callerName = incoming.caller?.displayName ?? 'Unknown';
      navigate('CallScreen', {
        callId: incoming._id,
        type: incoming.type,
        role: 'callee',
        peerName: callerName,
      });
    } catch (error) {
      Alert.alert(
        'Could not answer',
        convexErrorMessage(error, 'The call may have ended.'),
      );
    } finally {
      setBusy(false);
    }
  }, [token, incoming, busy, acceptCall]);

  const decline = useCallback(async () => {
    if (!token || !incoming || busy) {
      return;
    }
    setBusy(true);
    try {
      await rejectCall({ token, callId: incoming._id as any });
      dismissCallNotification(incoming._id);
    } catch {
      // call already gone
    } finally {
      setBusy(false);
    }
  }, [token, incoming, busy, rejectCall]);

  useEffect(() => {
    if (!incoming) {
      dismissAllCallNotifications();
    }
  }, [incoming?._id]);

  if (!incoming) {
    return null;
  }

  const callerName = incoming.caller?.displayName ?? 'Unknown';

  return (
    <View style={styles.backdrop}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.body}>
          <Text style={styles.callingLabel}>
            Incoming {incoming.type === 'video' ? 'video' : 'voice'} call
          </Text>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {callerName
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map(part => part[0]?.toUpperCase() ?? '')
                .join('')}
            </Text>
          </View>
          <Text style={styles.name}>{callerName}</Text>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: '#E5484D' }]}
            onPress={decline}
            disabled={busy}
          >
            <MaterialDesignIcons name="phone-hangup" size={32} color="#FFFFFF" />
            <Text style={styles.actionLabel}>Decline</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: '#2FBF71' }]}
            onPress={accept}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <MaterialDesignIcons name="phone" size={32} color="#FFFFFF" />
            )}
            <Text style={styles.actionLabel}>Accept</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
};

export default IncomingCallOverlay;

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,10,16,0.96)',
    zIndex: 100,
  },
  safe: {
    flex: 1,
    justifyContent: 'space-between',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callingLabel: {
    color: '#C9C9D4',
    fontSize: 16,
    marginBottom: 24,
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#5B4BC4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#fff',
    fontSize: 40,
    fontWeight: '700',
  },
  name: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '700',
    marginTop: 20,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    paddingBottom: 48,
  },
  actionButton: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    color: '#fff',
    fontSize: 13,
    marginTop: 4,
  },
});
