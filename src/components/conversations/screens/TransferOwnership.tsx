import React, {useState} from 'react';
import {View, Text, TouchableOpacity} from 'react-native';
import {RouteProp} from '@react-navigation/native';
import {
  CometChatGroupMembers,
  CometChatUIEventHandler,
  CometChatUIEvents,
  useCometChatTranslation,
  useTheme,
} from '@cometchat/chat-uikit-react-native';
import {Icon} from '@cometchat/chat-uikit-react-native';
import {CometChat} from '@cometchat/chat-sdk-react-native';
import {StackNavigationProp} from '@react-navigation/stack';
import {RootStackParamList} from '../../../navigation/types';
import {styles} from './TransferOwnershipStyles';
import ArrowBack from '../../../assets/icons/ArrowBack';
import {CommonUtils} from '../../../utils/CommonUtils';

type TransferOwnershipScreenProps = {
  route: RouteProp<RootStackParamList, 'TransferOwnershipSection'>;
  navigation: StackNavigationProp<
    RootStackParamList,
    'TransferOwnershipSection'
  >;
};

const TransferOwnership: React.FC<TransferOwnershipScreenProps> = ({
  route,
  navigation,
}) => {
  const {group} = route.params;
  const theme = useTheme();
  const {t}= useCometChatTranslation()
  const [selectedOwnershipMember, setSelectedOwnershipMember] =
    useState<CometChat.User | null>(null);

  const handleBack = () => {
    navigation.goBack();
  };

  // Function to leave the group after ownership transfer
  const leaveGroup = (group: CometChat.Group) => {
    CometChat.leaveGroup(group.getGuid())
      .then(() => {
        CometChatUIEventHandler.emitGroupEvent(CometChatUIEvents.ccGroupLeft, {
          leftGroup: CommonUtils.clone(group),
        });
        navigation.pop(3);
      })
      .catch(error => {
        console.log('Group leaving failed with exception:', error);
      });
  };

  const handleTransferOwnership = async () => {
    if (!selectedOwnershipMember || !group) return;
    try {
      await CometChat.transferGroupOwnership(
        group.getGuid(),
        selectedOwnershipMember.getUid(),
      );
      leaveGroup(group);
    } catch (error) {
      console.error('Ownership transfer failed:', error);
    }
  };

  return (
    <View style={{flex: 1, backgroundColor: theme.color.background1}}>
      {/* Header */}
      <View style={styles.headerSection}>
        <TouchableOpacity
          style={styles.backButtonContainer}
          onPress={handleBack}>
          <Icon
            icon={
              <ArrowBack
                color={theme.color.iconPrimary}
                height={24}
                width={24}
              />
            }
          />
        </TouchableOpacity>
        <Text
          style={[
            theme.typography.heading1.bold,
            styles.leftPaddingSmall,
            {color: theme.color.textPrimary},
          ]}>
          {t('TRANSFER_OWNERSHIP')}
        </Text>
      </View>

      {/* Group Members List */}
      {group && (
        <CometChatGroupMembers
          group={group}
          excludeOwner={true}
          onBack={handleBack}
          hideHeader={true}
          selectionMode="single"
          onSelection={members => {
            setSelectedOwnershipMember(
              members && members.length > 0 ? members[0] : null,
            );
          }}
        />
      )}

      {/* Transfer Ownership Button */}
      <TouchableOpacity
        onPress={handleTransferOwnership}
        style={styles.transferButtonWrapper}>
        <View
          style={[
            styles.transferButtonContent,
            {backgroundColor: theme.color.primaryButtonBackground},
          ]}>
          <Text
            style={[
              theme.typography.heading4.medium,
              styles.centerAligned,
              {color: theme.color.primaryButtonText},
            ]}>
            {t('TRANSFER_OWNERSHIP')}
          </Text>
        </View>
      </TouchableOpacity>
    </View>
  );
};

export default TransferOwnership;
