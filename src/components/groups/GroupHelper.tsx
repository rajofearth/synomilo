import React, {useEffect, useState} from 'react';
import {
  Dimensions,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  TouchableWithoutFeedback,
} from 'react-native';
import {
  CometChatAvatar,
  CometChatBottomSheet,
  CometChatUIKitHelper,
  Icon,
  useCometChatTranslation,
  useTheme,
} from '@cometchat/chat-uikit-react-native';
import {styles} from './styles';
import {CometChat} from '@cometchat/chat-sdk-react-native';
import GroupAdd from '../../assets/icons/GroupAdd';
import Group from '../../assets/icons/Group';

/**
 * Subcomponent for the default AppBar Options
 * (e.g., the "Add Group" button/icon on the header).
 */
export const GroupScreenAppBarOptions: React.FC<{
  onPress: () => void;
}> = ({onPress}) => {
  const theme = useTheme();
  const {t}= useCometChatTranslation()

  return (
    <View style={{paddingRight: 10}}>
      <TouchableOpacity onPress={onPress}>
        <Icon
          icon={<GroupAdd color={theme.color.primary} height={28} width={28} />}
          size={28}
        />
      </TouchableOpacity>
    </View>
  );
};

/**
 * Bottom sheet for creating a new group.
 */
interface CreateGroupBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  onGroupCreated: (group: CometChat.Group) => void;
}

export const CreateGroupBottomSheet: React.FC<CreateGroupBottomSheetProps> = ({
  visible,
  onClose,
  onGroupCreated,
}) => {
  const theme = useTheme();
  const { t } = useCometChatTranslation()

  // Group state
  const [groupName, setGroupName] = useState('');
  const [groupPassword, setGroupPassword] = useState('');
  const [selectedOption, setSelectedOption] = useState('Public');
  const [showPasswordField, setShowPasswordField] = useState(false);
  const [showError, setShowError] = useState('');
  const groupTypes = [
    { display: t('PUBLIC'), value: 'Public' },
    { display: t('PRIVATE'), value: 'Private' },
    { display: t('PASSWORD'), value: 'Password' }
  ];

  const resetFields = () => {
    setGroupName('');
    setGroupPassword('');
    setSelectedOption('Public');
    setShowPasswordField(false);
    setShowError('');
  };

  const handleDismiss = () => {
    resetFields(); // clear everything the user typed/selected
    onClose(); // let the parent know the sheet closed
  };

  useEffect(() => {
    if (!showError) return;
    const timer = setTimeout(() => setShowError(''), 3000);
    return () => clearTimeout(timer);
  }, [showError]);

  const handleOptionPress = (option: { display: string, value: string }) => {
    setSelectedOption(option.value);
    setShowPasswordField(option.value === 'Password');
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim()) {
      setShowError('Group name cannot be empty');
      return;
    }
    const GUID = 'group_' + Date.now();
    let groupType = CometChat.GROUP_TYPE.PUBLIC;
    let password = '';

    switch (selectedOption) {
      case 'Private':
        groupType = CometChat.GROUP_TYPE.PRIVATE;
        break;
      case 'Password':
        groupType = CometChat.GROUP_TYPE.PASSWORD;
        break;
      default:
        groupType = CometChat.GROUP_TYPE.PUBLIC;
    }

    if (groupType === CometChat.GROUP_TYPE.PASSWORD) {
      if (!groupPassword.trim()) {
        setShowError('Password is mandatory for password-protected groups');
        return;
      }
      password = groupPassword;
    }

    const newGroup = new CometChat.Group(GUID, groupName, groupType, password);

    try {
      const createdGroup = await CometChat.createGroup(newGroup);
      CometChatUIKitHelper.onGroupCreated(createdGroup);
      onGroupCreated(createdGroup);

      // Reset fields after creation
      resetFields();
      onClose();
    } catch (error) {
      console.log('Group creation failed with exception:', error);
    }
  };

  return (
    <CometChatBottomSheet
      isOpen={visible}
      onClose={handleDismiss}
      doNotOccupyEntireHeight={true}
      scrollEnabled={true}
      style={{maxHeight: Dimensions.get('window').height * 0.8}}>
      <View style={styles.bottomSheetContainer}>
        {/* Header / Icon */}
        <View style={{alignItems: 'center'}}>
          <View
            style={[
              styles.avatarIconContainer,
              {backgroundColor: theme.color.background3},
            ]}>
            <Icon
              icon={
                <Group color={theme.color.primary} height={44} width={44} />
              }
              size={44}
            />
          </View>
          <Text
            style={[
              {color: theme.color.textPrimary, marginTop: 15},
              theme.typography.heading2.regular,
            ]}>
            {t('NEW__GROUP')}
          </Text>
        </View>

        {/* Group Type Tabs */}
        <View style={{marginVertical: 20}}>
          <Text
            style={[
              theme.typography.caption1.medium,
              {marginBottom: 10, color: theme.color.textPrimary},
            ]}>
            {t('TYPE')}
          </Text>
          <View
            style={[
              styles.optionTabsContainer,
              {
                borderColor: theme.color.borderLight,
                backgroundColor: theme.color.background3,
              },
            ]}>
            {groupTypes.map(option => {
              const isSelected = selectedOption === option.value;
              return (
                <TouchableOpacity
                  key={option.value}
                  onPress={() => handleOptionPress(option)}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    paddingVertical: 8,
                    borderRadius: 12,
                    backgroundColor: isSelected
                      ? theme.color.background1
                      : 'transparent',
                  }}>
                  <Text
                    style={[
                      theme.typography.body.medium,
                      {
                        color: isSelected
                          ? theme.color.textHighlight
                          : theme.color.textSecondary,
                        fontWeight: isSelected ? 'bold' : 'normal',
                      },
                    ]}>
                    {option.display}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Group Name Input */}
        <View style={styles.marginBottom20}>
          <Text
            style={[
              theme.typography.caption1.medium,
              {marginBottom: 10, color: theme.color.textPrimary},
            ]}>
            {t('NAME')}
          </Text>
          <View
            style={[
              styles.passwordInputContainer,
              {
                borderColor: theme.color.borderLight,
                backgroundColor: theme.color.background3,
              },
            ]}>
            <TextInput
              value={groupName}
              onChangeText={setGroupName}
              style={[
                theme.typography.body.regular,
                {
                  flex: 1,
                  color: theme.color.textPrimary,
                },
              ]}
              placeholder={t("ENTER_GROUP_NAME")}
              placeholderTextColor={theme.color.textTertiary}
            />
          </View>
        </View>

        {/* Group Password (if needed) */}
        {showPasswordField && (
          <View style={styles.marginBottom20}>
            <Text
              style={[
                theme.typography.caption1.medium,
                {marginBottom: 10, color: theme.color.textPrimary},
              ]}>
              {t('PASSWORD')}
            </Text>
            <View
              style={[
                styles.passwordInputContainer,
                {
                  borderColor: theme.color.borderLight,
                  backgroundColor: theme.color.background3,
                },
              ]}>
              <TextInput
                value={groupPassword}
                onChangeText={setGroupPassword}
                style={[
                  theme.typography.body.regular,
                  {flex: 1, color: theme.color.textPrimary},
                ]}
                placeholder={t("ENTER_PASSWORD")}
                placeholderTextColor={theme.color.textTertiary}
                secureTextEntry
              />
            </View>
          </View>
        )}

        {showError !== '' && (
          <View style={styles.toastContainer}>
            <Text style={[styles.toastMessage, {color: theme.color.error}]}>
              {showError}
            </Text>
          </View>
        )}

        {/* Create Group Button */}
        <TouchableWithoutFeedback onPress={handleCreateGroup}>
          <View
            style={[
              styles.createButton,
              {backgroundColor: theme.color.primaryButtonBackground},
            ]}>
            <Text
              style={[
                theme.typography.button.medium,
                {color: theme.color.primaryButtonText},
              ]}>
              {t('CREATE_GROUP')}
            </Text>
          </View>
        </TouchableWithoutFeedback>
      </View>
    </CometChatBottomSheet>
  );
};

/**
 * Bottom sheet for joining a password-protected group.
 */
interface JoinGroupBottomSheetProps {
  visible: boolean;
  groupToJoin: CometChat.Group | null;
  onClose: () => void;
  onJoinSuccess: (joinedGroup: CometChat.Group) => void;
}

export const JoinGroupBottomSheet: React.FC<JoinGroupBottomSheetProps> = ({
  visible,
  groupToJoin,
  onClose,
  onJoinSuccess,
}) => {
  const theme = useTheme();
  const { t } = useCometChatTranslation()
  const [enteredPassword, setEnteredPassword] = useState('');
  const [isPasswordErrorVisible, setIsPasswordErrorVisible] = useState(false);

  useEffect(() => {
    if (!isPasswordErrorVisible) return;
    const timer = setTimeout(() => setIsPasswordErrorVisible(false), 3000);
    return () => clearTimeout(timer);
  }, [isPasswordErrorVisible]);

  const joinPasswordGroup = async () => {
    if (!groupToJoin || !enteredPassword.trim()) return;

    try {
      const joinedGroup = await CometChat.joinGroup(
        groupToJoin.getGuid(),
        groupToJoin.getType() as CometChat.GroupType,
        enteredPassword,
      );
      onJoinSuccess(joinedGroup);
      handleClose();
    } catch (error) {
      setIsPasswordErrorVisible(true);
      console.log('Error joining password group:', error);
    }
  };

  const handleClose = () => {
    setEnteredPassword('');
    setIsPasswordErrorVisible(false);
    onClose();
  };

  return (
    <CometChatBottomSheet
      isOpen={visible}
      onClose={handleClose}
      scrollEnabled={true}
      doNotOccupyEntireHeight={true}>
      {groupToJoin && (
        <View style={styles.joiningGroup}>
          {/* Header */}
          <Text
            style={[
              theme.typography.heading3.bold,
              {
                marginBottom: 20,
                textAlign: 'center',
                color: theme.color.textPrimary,
              },
            ]}>
            {t('JOIN_GROUP')}
          </Text>

          {/* Group Info */}
          <View style={{alignItems: 'center', marginBottom: 20}}>
            <CometChatAvatar
              name={groupToJoin.getName()}
              image={{uri: groupToJoin.getIcon()}}
            />
            <Text
              style={[
                theme.typography.body.medium,
                {marginTop: 10, color: theme.color.textPrimary},
              ]}>
              {groupToJoin.getName()}
            </Text>
            <Text
              style={[
                theme.typography.caption1.medium,
                {marginTop: 5, color: theme.color.textSecondary},
              ]}>
              {groupToJoin.getMembersCount()} {t('MEMBERS')}
            </Text>
          </View>

          {/* Password Input */}
          <View style={styles.marginBottom20}>
            <Text
              style={[
                theme.typography.caption1.medium,
                {marginBottom: 10, color: theme.color.textPrimary},
              ]}>
              {t('ENTER_PASSWORD')}
            </Text>
            <View
              style={[
                styles.passwordInputContainer,
                {
                  borderColor: theme.color.borderLight,
                  backgroundColor: theme.color.background3,
                },
              ]}>
              <TextInput
                value={enteredPassword}
                onChangeText={setEnteredPassword}
                style={[
                  theme.typography.body.regular,
                  {flex: 1, color: theme.color.textPrimary},
                ]}
                placeholder={t('ENTER_PASSWORD')}
                placeholderTextColor={theme.color.textTertiary}
                secureTextEntry
              />
            </View>
          </View>

          {/* Incorrect Password Toast */}
          {isPasswordErrorVisible && (
            <View style={styles.toastContainer}>
              <Text style={[styles.toastMessage, {color: theme.color.error}]}>
                {t('PASSWORD_INCORRECT_GROUP')}
              </Text>
            </View>
          )}

          {/* Join Button */}
          <TouchableWithoutFeedback onPress={joinPasswordGroup}>
            <View
              style={[
                styles.joinGroupButton,
                {backgroundColor: theme.color.primaryButtonBackground},
              ]}>
              <Text
                style={[
                  theme.typography.button.medium,
                  {color: theme.color.primaryButtonText},
                ]}>
                {t('JOIN_GROUP')}
              </Text>
            </View>
          </TouchableWithoutFeedback>
        </View>
      )}
    </CometChatBottomSheet>
  );
};
