import {Platform, StyleSheet} from 'react-native';

export const styles = StyleSheet.create({
  safeAreaContainer: {
    flex: 1,
  },
  bottomSheetContainer: {
    paddingHorizontal: 20,
    paddingBottom: Platform.OS==='android'  ? 10: 30,
    flex: 1,
  },
  marginBottom20: {
    marginBottom: 20,
  },
  toastContainer: {
    alignItems: 'flex-start',
  },
  toastMessage: {
    paddingVertical: 10,
  },
  passwordInputContainer: {
    borderWidth: 1,
    flexDirection: 'row',
    borderRadius: 12,
    paddingLeft: 10,
    paddingTop: Platform.select({android: 0, ios: 8}),
    paddingBottom: Platform.select({android: 0, ios: 12}),
  },
  avatarIconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 80,
    height: 80,
    borderRadius: 50,
  },
  optionTabsContainer: {
    borderWidth: 1,
    flexDirection: 'row',
    borderRadius: 12,
    padding: Platform.OS === 'ios' ? 5 : 2,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  createButton: {
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  joinGroupButton: {
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  joiningGroup: {
    paddingHorizontal: 20,
    flex: 1,
    marginBottom: 20,
  },
});
