import {CometChatTheme, CometChatUIKit} from '@cometchat/chat-uikit-react-native';
import {CallMade, CallMissedOutgoingFill, CallReceived} from './icons';
import {JSX} from 'react';
import { getCometChatTranslation } from '@cometchat/chat-uikit-react-native';
const t = getCometChatTranslation();

type CallDirection = 'incoming' | 'outgoing';

export type CallStatus =
  | 'incoming'
  | 'outgoing'
  | 'incomingCallEnded'
  | 'outgoingCallEnded'
  | 'cancelledByMe'
  | 'cancelledByThem'
  | 'incomingRejected'
  | 'outgoingRejected'
  | 'incomingBusy'
  | 'outgoingBusy'
  | 'unansweredByMe'
  | 'unansweredByThem';

export class CallDetailHelper {
  static getFormattedInitiatedAt = (call: any): string => {
    const date = new Date(call.getInitiatedAt() * 1000);
    const now = new Date();

    // Extracting parts
    const day = date.getDate();
    const month = new Intl.DateTimeFormat('en-US', {month: 'long'}).format(
      date,
    );
    const year = date.getFullYear();
    const time = date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    // Determine if the year should be included
    const includeYear = now.getFullYear() !== year;

    return `${day} ${month}${includeYear ? `, ${year}` : ''}, ${time}`;
  };

  /** Returns the UI-facing callStatus plus the direction */
  static getCallType = (
    call: any,
  ): {type: CallDirection; callStatus: CallStatus} => {
    const myUid = CometChatUIKit.loggedInUser?.getUid();
    const type: CallDirection =
      call.getInitiator().getUid() === myUid ? 'outgoing' : 'incoming';

    const statusMap: Record<
      string,
      {incoming: CallStatus; outgoing: CallStatus}
    > = {
      ended: {
        incoming: 'incomingCallEnded',
        outgoing: 'outgoingCallEnded',
      },
      rejected: {
        incoming: 'incomingRejected',
        outgoing: 'outgoingRejected',
      },
      cancelled: {
        incoming: 'unansweredByMe',
        outgoing: 'cancelledByMe',
      },
      unanswered: {
        incoming: 'unansweredByMe',
        outgoing: 'unansweredByThem',
      },
      initiated: {
        incoming: 'incoming',
        outgoing: 'outgoing',
      },
      busy: {
        incoming: 'incomingBusy',
        outgoing: 'outgoingBusy',
      },
    };

    return {
      type,
      callStatus:
        statusMap[call.getStatus() as keyof typeof statusMap]?.[type] ??
        (type === 'incoming' ? 'incoming' : 'outgoing'),
    };
  };

  /** Which SVG to render for a given callStatus */
  static getCallStatusDisplayIcon = (
    callStatus: CallStatus,
    theme: CometChatTheme,
  ): JSX.Element | undefined => {
    const icons: Record<CallStatus, JSX.Element> = {
      outgoing: <CallMade height={24} width={24} color={theme.color.success} />,
      outgoingCallEnded: (
        <CallMade height={24} width={24} color={theme.color.success} />
      ),
      cancelledByMe: (
        <CallMade height={24} width={24} color={theme.color.success} />
      ),
      outgoingRejected: (
        <CallMade height={24} width={24} color={theme.color.success} />
      ),
      outgoingBusy: (
        <CallMade height={24} width={24} color={theme.color.success} />
      ),
      unansweredByThem: (
        <CallMade height={24} width={24} color={theme.color.success} />
      ),

      incoming: (
        <CallReceived height={24} width={24} color={theme.color.success} />
      ),
      incomingCallEnded: (
        <CallReceived height={24} width={24} color={theme.color.success} />
      ),
      cancelledByThem: (
        <CallMissedOutgoingFill
          height={24}
          width={24}
          color={theme.color.error}
        />
      ),
      incomingRejected: (
        <CallReceived height={24} width={24} color={theme.color.success} />
      ),
      incomingBusy: (
        <CallMissedOutgoingFill
          height={24}
          width={24}
          color={theme.color.error}
        />
      ),
      unansweredByMe: (
        <CallMissedOutgoingFill
          height={24}
          width={24}
          color={theme.color.error}
        />
      ),
    };

    return icons[callStatus];
  };

  static getCallStatusDisplayText = (callStatus: CallStatus): string => {
    const labels: Record<CallStatus, string> = {
      outgoing: t('OUTGOING_CALL'),
      outgoingCallEnded: t('OUTGOING_CALL'),
      cancelledByMe: t('OUTGOING_CALL'),
      outgoingRejected: t('OUTGOING_CALL'),
      outgoingBusy: t('OUTGOING_CALL'),
      unansweredByThem: t('OUTGOING_CALL'),

      incoming: t('INCOMING_CALL'),
      incomingCallEnded: t('INCOMING_CALL'),
      cancelledByThem: t('MISSED_CALL'),
      incomingRejected: t('INCOMING_CALL'),
      incomingBusy: t('MISSED_CALL'),
      unansweredByMe: t('MISSED_CALL'),
    };

    return labels[callStatus];
  };
}
