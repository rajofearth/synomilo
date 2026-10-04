import {StyleSheet} from 'react-native';

export const styles = StyleSheet.create({
  flexOne: {
    flex: 1,
  },
  headerContainer: {
    paddingTop: 15,
    paddingLeft: 10,
    flexDirection: 'row',
  },
  ellipseTail: {paddingHorizontal: 10, width: '80%'},
  iconContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pL5: {
    paddingLeft: 5,
  },
  groupInfoSection: {
    marginTop: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: 10,
  },
  infoTitleContainer: {
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
  titleName: {
    marginTop: 10,
    // width:'20%',
    alignSelf: 'center',
  },
  boxLabel: {
    marginTop: 5,
    textAlign: 'center',
    alignSelf: 'center',
  },
  boxContainerRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    justifyContent: 'space-between',
    marginVertical: 20,
  },
  buttonContainer: {
    flex: 1,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 5,
  },
  buttonIcon: {
    marginBottom: 5,
  },
  actionContainer: {
    paddingTop: 10,
    gap: 4,
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingLeft: 20,
    width: '100%',
  },
  mL5: {
    marginLeft: 5,
  },
});
