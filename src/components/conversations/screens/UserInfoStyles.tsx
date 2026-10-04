import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
    headerContainer: {
      paddingTop: 15,
      paddingLeft: 10,
      flexDirection: 'row',
    },
    backButtonContainer: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    smallPaddingLeft: {
      paddingLeft: 5,
    },
    profileCard: {
      marginTop: 12,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      paddingVertical: 10,
    },
    profileInfo: {
      alignSelf: 'center',
      alignItems: 'center',
      marginTop: 20,
    },
    avatarContainer: {
      height: 120,
      width: 120,
    },
    avatarText: {
      fontSize: 28,
      lineHeight: 55,
    },
    avatarImage: {
      height: '100%',
      width: '100%',
    },
    mt10Centered: {
      marginTop: 10,
      alignSelf: 'center',
    },
    mt5Centered: {
      marginTop: 5,
      textAlign: 'center',
      alignSelf: 'center',
    },
    actionsRow: {
      flexDirection: 'row',
      paddingHorizontal: 20,
      justifyContent: 'space-between',
      marginVertical: 20,
    },
    callActionButton: {
      flex: 1,
      paddingVertical: 10,
      borderWidth: 1,
      borderRadius: 8,
      justifyContent: 'center',
      alignItems: 'center',
      marginHorizontal: 5,
    },
    optionsContainer: {
      paddingTop: 10,
      gap: 4,
    },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      paddingLeft: 20,
      width: '100%',
    },
    ml5: {
      marginLeft: 5,
    },
  });
  