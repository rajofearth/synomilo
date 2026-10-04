import React from 'react';
import { View, Text, StyleSheet, Appearance, Button } from 'react-native';

interface State {
  hasError: boolean;
  error: Error | null;
  colorScheme: 'light' | 'dark' | null;
}

interface Props {
  children: React.ReactNode;
}

class AppErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    const colorScheme = Appearance.getColorScheme() ?? null;
    this.state = { hasError: false, error: null, colorScheme };
  }

  static getDerivedStateFromError(error: Error) {
    // Update state so the next render shows the fallback UI.
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log error to an error reporting service here if needed.
    console.log('ErrorBoundary caught an error', error, errorInfo);
  }

  componentDidMount() {
    // Listen for changes in color scheme.
    Appearance.addChangeListener(({ colorScheme }) => {
      this.setState({ colorScheme: colorScheme ?? null });
    });
  }

  // Reset error state to allow retrying
  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const styles = createStyles(this.state.colorScheme);
      return (
        <View style={styles.container}>
          <View style={styles.card}>
            <Text style={styles.title}>Something went wrong</Text>
             {/* Uncomment the next line to show the error message */}
            {/* <Text style={styles.errorText}>
              {this.state.error ? this.state.error.toString() : 'Unknown error'}
            </Text> */}
            <View style={styles.buttonContainer}>
              <Button title="Retry" onPress={this.handleRetry} color={this.state.colorScheme === 'dark' ? "#bbbbbb" : "#333333"} />
            </View>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const createStyles = (colorScheme: 'light' | 'dark' | null) => {
  const isDark = colorScheme === 'dark';
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDark ? '#121212' : '#f2f2f2',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 16,
    },
    card: {
      backgroundColor: isDark ? '#1e1e1e' : '#ffffff',
      padding: 24,
      borderRadius: 12,
      alignItems: 'center',
      shadowColor: isDark ? '#000000' : '#aaa',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.3,
      shadowRadius: 4,
      elevation: 5,
      width: '100%',
      maxWidth: 400,
    },
    title: {
      fontSize: 20,
      fontWeight: '700',
      marginBottom: 12,
      color: isDark ? '#ffffff' : '#333333',
    },
    errorText: {
      fontSize: 16,
      textAlign: 'center',
      color: isDark ? '#cccccc' : '#666666',
      marginBottom: 20,
    },
    buttonContainer: {
      width: '100%',
    },
  });
};

export default AppErrorBoundary;
