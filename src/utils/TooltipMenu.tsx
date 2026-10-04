import { Icon, useTheme } from "@cometchat/chat-uikit-react-native";
import { JSX, useMemo } from "react";
import {
  ColorValue,
  Dimensions,
  ImageSourcePropType,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";

const { width: screenWidth, height: screenHeight } = Dimensions.get("window");

type CometChatTooltipMenuProps = {
  visible?: boolean;
  onDismiss?: () => void;
  onClose?: () => void;
  event: {
    nativeEvent: {
      pageX: number;
      pageY: number;
    };
  };
  menuItems: {
    text: string;
    onPress: () => void;
    textColor?: ColorValue;
    iconColor?: ColorValue;
    icon?: ImageSourcePropType | JSX.Element;
  }[];
};

export const TooltipMenu = (props: CometChatTooltipMenuProps) => {
  const { visible = false, onDismiss = () => null, onClose = () => null, event, menuItems } = props;
  const theme = useTheme();

  const position = useMemo(() => {
    let x = event.nativeEvent.pageX;
    let y = event.nativeEvent.pageY;
    const position: {
      left?: number;
      right?: number;
      top?: number;
      bottom?: number;
    } = {};
    if (x <= screenWidth / 3) {
      position.left = x + 10;
    } else {
      position.right = 12;
    }

    if (y <= screenHeight / 2) {
      position.top = y + 20;
    } else if (y >= screenHeight / 2) {
      position.bottom = Math.max(screenHeight - y + 10, 40);
    }
    return position;
  }, [event]);

  return (
    <Modal
      presentationStyle='overFullScreen'
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
      onDismiss={onDismiss}
      animationType='fade'
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={tooltipStyles.overlay}>
          <View
            style={[
              tooltipStyles.menu,
              position,
              {
                backgroundColor: theme.color.background1,
                borderWidth: 1,
                borderColor: theme.color.borderLight,
                borderRadius: theme.spacing.radius.r2,
                shadowColor: theme.color.neutral900,
              },
            ]}
          >
            {menuItems.map((item, i) => {
              return (
                <TouchableOpacity
                  key={i} // Ensure each item has a unique key
                  onPress={() => {
                    item.onPress();
                    onClose();
                  }}
                  style={[
                    {
                      flexDirection: "row",
                      alignItems: "center",
                      paddingVertical: 10,
                      paddingHorizontal: 16,
                      gap: 8,
                      backgroundColor: theme.color.background1,
                      minWidth: 160,
                    },
                    i === 0
                      ? {
                          borderTopLeftRadius: theme.spacing.radius.r2,
                          borderTopRightRadius: theme.spacing.radius.r2,
                        }
                      : {},
                    i === menuItems.length - 1
                      ? {
                          borderBottomLeftRadius: theme.spacing.radius.r2,
                          borderBottomRightRadius: theme.spacing.radius.r2,
                        }
                      : {},
                  ]}
                >
                  <Icon
                    color={item.iconColor ?? theme.color.textSecondary}
                    size={theme.spacing.spacing.s6}
                    icon={item.icon}
                  />
                  <Text
                    style={[
                      {
                        color: item.textColor ?? theme.color.textPrimary,
                        ...theme.typography.heading4.regular,
                      },
                    ]}
                  >
                    {item.text}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const tooltipStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "transparent",
    justifyContent: "center",
    alignItems: "center",
  },
  menu: {
    position: "absolute",
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.025,
    shadowRadius: 4,
    elevation: 3,
  },
  menuItem: {
    fontSize: 16,
    paddingVertical: 5,
  },
});
