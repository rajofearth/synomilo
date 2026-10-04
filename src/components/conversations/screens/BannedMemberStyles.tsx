import {StyleSheet} from 'react-native';
import {
  CometChatListStylesInterface,
  CometChatTheme,
} from '@cometchat/chat-uikit-react-native';
import {deepMerge} from '@cometchat/chat-uikit-react-native/src/shared/helper/helperFunctions';
import {DeepPartial} from '@cometchat/chat-uikit-react-native/src/shared/helper/types';
import {ColorValue, ViewStyle} from 'react-native';

export const styles = StyleSheet.create({
  flexContainer: {
    flex: 1,
  },
  emptyViewContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: '10%',
  },

  /* Modal Styles */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContainer: {
    position: 'absolute',
    top: '30%',
    left: '2%',
    right: '2%',
    borderRadius: 10,
    padding: 20,
    elevation: 5,
  },
  modalIconContainer: {
    alignSelf: 'center',
    marginBottom: 10,
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContentContainer: {
    alignItems: 'center',
  },
  modalTitle: {
    marginBottom: 15,
  },
  modalDesc: {
    textAlign: 'center',
    marginBottom: 20,
  },
  buttonContainer: {
    flexDirection: 'row',
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 10,
    marginHorizontal: 5,
    borderRadius: 5,
    borderWidth: 1,
    alignItems: 'center',
  },
  unbanButton: {
    flex: 1,
    paddingVertical: 10,
    marginHorizontal: 5,
    borderRadius: 5,
    alignItems: 'center',
  },
});

export type BannedMemberStyle = CometChatListStylesInterface & {
  skeletonStyle: {
    backgroundColor: ColorValue;
    linearGradientColors: [string, string];
    shimmerBackgroundColor: ColorValue;
    shimmerOpacity: number;
    speed: number;
  };
  headerContainerStyle: ViewStyle;
};

export const getBannedMemberStyleLight = (
  theme: CometChatTheme,
): DeepPartial<BannedMemberStyle> => {
  const {color, spacing, typography} = theme;
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
      borderBottomColor: color.borderLight,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      width: '100%',
    },
    containerStyle: {
      backgroundColor: color.background1,
      flex: 1,
    },
    itemStyle: {
      containerStyle: {
        flexDirection: 'row',
        paddingHorizontal: spacing.padding.p4,
        paddingVertical: spacing.padding.p2,
        gap: spacing.spacing.s3,
      },
      titleStyle: {
        color: color.textPrimary,
        ...typography.heading4.medium,
      },
      subtitleStyle: {
        color: color.textSecondary,
        ...typography.body.regular,
      },
      statusIndicatorStyle: {},
      avatarStyle: {
        containerStyle: {},
        textStyle: {},
        imageStyle: {},
      },
      headViewContainerStyle: {},
      titleSubtitleContainerStyle: {
        alignSelf: 'center',
      },
      trailingViewContainerStyle: {
        alignSelf: 'center',
      },
    },
    confirmSelectionStyle: {},
    selectionCancelStyle: {},
    loadingIconTint: color.primary,
    sectionHeaderTextStyle: {
      marginHorizontal: spacing.spacing.s5,
      color: color.primary,
      ...typography.heading4.medium,
    },
    onlineStatusColor: color.success,
    titleViewStyle: {
      paddingVertical: spacing.spacing.s3,
      paddingLeft: spacing.spacing.s3,
      margin: spacing.spacing.s0,
    },
    titleStyle: {
      color: color.textPrimary,
      ...typography.heading1.bold,
    },
    backButtonIconStyle: {
      tintColor: color.iconPrimary,
      height: spacing.spacing.s6,
      width: spacing.spacing.s6,
    },
    searchStyle: {
      textStyle: {
        color: color.textPrimary,
        ...typography.heading4.regular,
        textAlignVertical: 'center',
        paddingVertical: 0,
        height: spacing.spacing.s7,
      },
      containerStyle: {
        backgroundColor: color.background3,
        paddingVertical: spacing.spacing.s3,
        marginTop: spacing.spacing.s3,
        width: '95%',
        gap: spacing.spacing.s1,
        alignContent: 'space-around',
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
      },
      icon: undefined,
      iconStyle: {
        tintColor: color.iconSecondary,
      },
      placehodlerTextStyle: {
        color: color.textTertiary,
      },
    },
    emptyStateStyle: {
      titleStyle: {
        color: color.textPrimary,
        ...typography.heading3.bold,
        marginBottom: spacing.margin.m1,
      },
      subTitleStyle: {
        color: color.textSecondary,
        textAlign: 'center' as const,
        ...typography.body.regular,
      },
      containerStyle: {
        justifyContent: 'center',
        display: 'none',
        alignItems: 'center',
        padding: spacing.padding.p3,
      },
    },
    errorStateStyle: {
      titleStyle: {
        color: color.textPrimary,
        ...typography.heading3.bold,
        marginBottom: spacing.margin.m1,
      },
      subTitleStyle: {
        color: color.textSecondary,
        textAlign: 'center' as const,
        ...typography.body.regular,
      },
      containerStyle: {
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.padding.p3,
      },
    },
    skeletonStyle: {
      backgroundColor: color.background3,
      linearGradientColors: ['#E8E8E8', '#F5F5F5'] as [string, string],
      shimmerBackgroundColor: color.staticBlack,
      shimmerOpacity: 0.01,
      speed: 1,
    },
  };
};

export const getBannedMemberStyleDark = (
  theme: CometChatTheme,
): DeepPartial<BannedMemberStyle> => {
  const {color, spacing, typography} = theme;
  return deepMerge(getBannedMemberStyleLight(theme), {
    skeletonStyle: {
      backgroundColor: color.background3,
      linearGradientColors: ['#383838', '#272727'] as [string, string],
      shimmerBackgroundColor: color.staticWhite,
      shimmerOpacity: 0.01,
      speed: 1,
    },
  });
};
