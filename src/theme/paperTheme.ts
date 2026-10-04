import { MD3DarkTheme } from 'react-native-paper';

export const paperTheme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#5B4BC4',
    secondary: '#8B7CF6',
    background: '#0E0E14',
    surface: '#17171F',
    surfaceVariant: '#22222C',
    onSurface: '#F4F4F6',
    onSurfaceVariant: '#A9A9B8',
    outline: '#3A3A46',
    outlineVariant: '#2A2A34',
    error: '#E5484D',
    elevation: {
      level0: 'transparent',
      level1: '#17171F',
      level2: '#1C1C26',
      level3: '#20202A',
      level4: '#23232E',
      level5: '#262632',
    },
  },
};
