import { CometChatListItem, useTheme, useCometChatTranslation, localizedDateHelperInstance, useLocalizedDate, LocalizedDateHelper } from '@cometchat/chat-uikit-react-native';
import React, { useCallback, useMemo } from 'react';
import { View, FlatList, Text } from 'react-native';
import { CallDetailHelper } from './CallDetailHelper';

export const CallParticipants = (props: {
  /**
   * Participant list
   */
  data: any[];
  call: any;
}) => {
  const { call, data } = props;

  const theme = useTheme();
  const { language, t } = useCometChatTranslation();
  const { formatDate } = useLocalizedDate();

  const getCallDetails = (item: any) => {
    return {
      title: item['name'],
      avatarUrl: item['avatar'],
    };
  };

  // Updated to use proper localization
  const formattedInitiatedAt = useMemo(() => {
    if (!call || !call.getInitiatedAt()) return '';

    // Use formatDate for proper localization of date/time
    return formatDate(
      call.getInitiatedAt() * 1000,
      LocalizedDateHelper.patterns.dayDateTimeFormat
    );
  }, [call, formatDate]);

  const _style = useMemo(() => {
    return {
      headerContainerStyle: {
        alignItems: 'flex-start',
        justifyContent: 'center',
        width: '100%',
        borderRadius: 0,
        paddingHorizontal: 0,
      },
      titleSeparatorStyle: {
        borderBottomWidth: 1,
        borderBottomColor: theme.color.borderLight,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: '100%',
      },
      containerStyle: {
        backgroundColor: theme.color.background1,
        flex: 1,
      },
      itemStyle: {
        containerStyle: {
          flexDirection: 'row' as const,
          paddingHorizontal: theme.spacing.padding.p4,
          paddingVertical: theme.spacing.padding.p2,
          gap: theme.spacing.spacing.s3,
        },
        titleStyle: {
          color: theme.color.textPrimary,
          flex: 1,
          ...theme.typography.heading4.medium,
        },
        subtitleStyle: {
          color: theme.color.textSecondary,
          ...theme.typography.body.regular,
        },
        tailViewTextStyle: {
          color: theme.color.textPrimary,
          ...theme.typography.caption1.medium,
        },
        avatarStyle: {
          containerStyle: {},
          textStyle: {},
          imageStyle: {
            height: 48,
            width: 48,
          },
        },
      },
    };
  }, [theme]);
  
  const convertMinutesToTime = useCallback((decimalMinutes: number) => {
    const totalSeconds = Math.round(decimalMinutes * 60); // Convert to seconds
    const minutes = Math.floor(totalSeconds / 60); // Get whole minutes
    const seconds = totalSeconds % 60; // Get remaining seconds

    return `${minutes} min  ${seconds} sec`;
  }, []);

 

  const _render = ({ item, index }: any) => {
    const { title, avatarUrl } = getCallDetails(item);

    return (
      <React.Fragment key={index}>
        <CometChatListItem
          id={item.sessionId}
          avatarStyle={_style.itemStyle.avatarStyle}
          containerStyle={_style.itemStyle.containerStyle}
          headViewContainerStyle={{ flexDirection: 'row' }}
          titleStyle={_style.itemStyle.titleStyle}
          trailingViewContainerStyle={{
            alignSelf: 'center',
          }}
          SubtitleView={
            <Text
              style={{
                ...theme.typography.body.regular,
                color: theme.color.textSecondary,
              }}>
              {formattedInitiatedAt}
            </Text>
          }
          // avatarName={title}
          title={title}
          // subtitle={'8 August, 8:14 pm'}
          avatarURL={avatarUrl}
          TrailingView={
            <Text style={_style.itemStyle.tailViewTextStyle}>
              {convertMinutesToTime(item.getTotalDurationInMinutes())}
            </Text>
          }
        />
      </React.Fragment>
    );
  };

  return (
    <View style={{ backgroundColor: theme.color.background1 }}>
      {data.length && (
        <FlatList
          data={data}
          keyExtractor={(item, index) => item.sessionId + '_' + index}
          renderItem={_render}
        />
      )}
    </View>
  );
};