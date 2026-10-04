import {StyleSheet} from 'react-native';

export const styles = StyleSheet.create({
  headerSection: {
    paddingTop: 15,
    paddingLeft: 10,
    flexDirection: 'row',
  },
  backButtonContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  leftPaddingSmall: {
    paddingLeft: 5,
  },
  transferButtonWrapper: {
    alignContent: 'center',
    justifyContent: 'center',
    paddingVertical: 1,
    height: '7%',
    width: '100%',
    alignSelf: 'center',
  },
  transferButtonContent: {
    marginHorizontal: 20,
    alignSelf: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    height: '75%',
    width: '95%',
  },
  centerAligned: {
    alignSelf: 'center',
  },
});
