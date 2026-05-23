import React from 'react';
import { Pressable, Text, StyleSheet, ActivityIndicator, View, ViewStyle, StyleProp } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, Radius, Spacing } from '@/src/theme/colors';

interface Props {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  icon?: React.ReactNode;
}

export function Button({ label, onPress, variant = 'primary', loading, disabled, testID, style, icon }: Props) {
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      testID={testID}
      onPress={disabled || loading ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        !isPrimary && styles.secondary,
        pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
        (disabled || loading) && { opacity: 0.6 },
        style,
      ]}
    >
      {isPrimary ? (
        <LinearGradient
          colors={[Colors.brandPrimary, Colors.brandPrimaryLight]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.gradient}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <View style={styles.row}>
              {icon}
              <Text style={styles.label}>{label}</Text>
            </View>
          )}
        </LinearGradient>
      ) : (
        <View style={styles.secondaryInner}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <View style={styles.row}>
              {icon}
              <Text style={styles.label}>{label}</Text>
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  secondary: {
    borderRadius: Radius.md,
  },
  gradient: {
    paddingVertical: 14,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryInner: {
    paddingVertical: 14,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: Radius.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
