import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
    toastTextStyle: {
      color: '#fff',
      fontSize: 16,
    },
    toastContainer: {
      position: 'absolute',
      bottom: 20,
      left: 20,
      right: 20,
      paddingVertical: 10,
      borderRadius: 5,
      alignItems: 'center',
    },
    addMemberContainer: {
      paddingTop: 15,
      paddingLeft: 10,
      flexDirection: 'row',
      paddingBottom: 15,
      borderBottomWidth: 1,
    },
    addMemberText: {
      paddingLeft: 10,
    },
    iconContainer: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    addMembersButton: {
      alignContent: 'center',
      justifyContent: 'center',
      paddingVertical: 1,
      height: 50,
      width: '100%',
      alignSelf: 'center',
    },
    addMembersButtonContainer: {
      marginHorizontal: 20,
      alignSelf: 'center',
      justifyContent: 'center',
      borderRadius: 6,
      height: '75%',
      width: '95%',
    },
  });
  