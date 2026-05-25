import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { Colors, Radius, Spacing } from '@/src/theme/colors';

interface MetersSnapshot {
  trust?: number;
  affection?: number;
  rivalry?: number;
  fear?: number;
}

interface Props {
  /** Title shown on the divider (e.g. "Chapter 2: The Whispering Library" or "Story Complete — Good Ending") */
  title: string;
  summary?: string;
  meters?: MetersSnapshot;
  variant?: 'chapter' | 'ending-good' | 'ending-bad' | 'ending-secret';
}

const VARIANT_CONFIG = {
  chapter: {
    icon: 'bookmark' as const,
    colors: ['rgba(124,58,237,0.25)', 'rgba(6,182,212,0.18)'] as const,
    accent: Colors.brandPrimary,
    badge: 'CHAPTER',
  },
  'ending-good': {
    icon: 'sparkles' as const,
    colors: ['rgba(16,185,129,0.35)', 'rgba(6,182,212,0.20)'] as const,
    accent: Colors.success,
    badge: 'GOOD ENDING',
  },
  'ending-bad': {
    icon: 'flame' as const,
    colors: ['rgba(239,68,68,0.30)', 'rgba(124,58,237,0.18)'] as const,
    accent: Colors.error,
    badge: 'BAD ENDING',
  },
  'ending-secret': {
    icon: 'eye' as const,
    colors: ['rgba(245,158,11,0.30)', 'rgba(124,58,237,0.18)'] as const,
    accent: Colors.warning,
    badge: 'SECRET ENDING',
  },
};

export function ChapterTransitionCard({ title, summary, meters, variant = 'chapter' }: Props) {
  const cfg = VARIANT_CONFIG[variant];
  return (
    <View style={styles.wrap} testID={`transition-${variant}`}>
      <LinearGradient
        colors={cfg.colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        <View style={styles.head}>
          <View style={[styles.iconCircle, { backgroundColor: cfg.accent + '33' }]}>
            <Ionicons name={cfg.icon} size={18} color={cfg.accent} />
          </View>
          <View style={[styles.badge, { backgroundColor: cfg.accent }]}>
            <Text style={styles.badgeText}>{cfg.badge}</Text>
          </View>
        </View>
        <Text style={styles.title}>{title}</Text>
        {!!summary && <Text style={styles.summary}>{summary}</Text>}
        {meters && (
          <View style={styles.metersRow}>
            <MeterChip label="Trust" value={meters.trust} color="#06B6D4" />
            <MeterChip label="Affection" value={meters.affection} color="#EC4899" />
            <MeterChip label="Rivalry" value={meters.rivalry} color="#F59E0B" />
            <MeterChip label="Fear" value={meters.fear} color="#EF4444" />
          </View>
        )}
      </LinearGradient>
    </View>
  );
}

function MeterChip({ label, value, color }: { label: string; value?: number; color: string }) {
  if (value === undefined) return null;
  return (
    <View style={[styles.meterChip, { borderColor: color + '55' }]}>
      <View style={[styles.meterDot, { backgroundColor: color }]} />
      <Text style={styles.meterLabel}>{label}</Text>
      <Text style={[styles.meterValue, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    paddingVertical: 6,
  },
  card: {
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconCircle: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
  },
  badge: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: Radius.pill,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  title: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  summary: { color: Colors.textPrimary, fontSize: 13, lineHeight: 19, opacity: 0.92 },
  metersRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  meterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  meterDot: { width: 6, height: 6, borderRadius: 3 },
  meterLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600' },
  meterValue: { fontSize: 11, fontWeight: '800' },
});
