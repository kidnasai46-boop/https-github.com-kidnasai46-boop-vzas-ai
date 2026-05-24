import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Spacing } from '@/src/theme/colors';

interface Meters {
  trust: number;
  affection: number;
  rivalry: number;
  fear: number;
}

const METER_CONFIG = [
  { key: 'trust' as const, label: 'Trust', color: '#10B981' },
  { key: 'affection' as const, label: 'Affection', color: '#EC4899' },
  { key: 'rivalry' as const, label: 'Rivalry', color: '#F59E0B' },
  { key: 'fear' as const, label: 'Fear', color: '#EF4444' },
];

export function MeterBar({ meters }: { meters: Meters }) {
  return (
    <View style={styles.container}>
      {METER_CONFIG.map(({ key, label, color }) => (
        <View key={key} style={styles.row}>
          <Text style={styles.label}>{label}</Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${meters[key]}%`, backgroundColor: color }]} />
          </View>
          <Text style={styles.value}>{meters[key]}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: 4,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: '600',
    width: 58,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  track: {
    flex: 1,
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
  },
  value: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: '600',
    width: 24,
    textAlign: 'right',
  },
});
