import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Spacing } from '@/src/theme/colors';

interface ChapterTransition {
  title: string;
  summary: string;
}

export function ChapterCard({ transition }: { transition: ChapterTransition }) {
  return (
    <View style={styles.card}>
      <View style={styles.divider} />
      <View style={styles.iconRow}>
        <Ionicons name="book" size={16} color={Colors.brandPrimary} />
        <Text style={styles.title}>{transition.title}</Text>
      </View>
      <Text style={styles.summary}>{transition.summary}</Text>
      <View style={styles.divider} />
    </View>
  );
}

interface EndingCardProps {
  endingType: string;
  summary: string;
  onReplay?: () => void;
}

export function EndingCard({ endingType, summary }: EndingCardProps) {
  const icon = endingType === 'good' ? 'star' : endingType === 'secret' ? 'key' : 'skull';
  const color = endingType === 'good' ? '#10B981' : endingType === 'secret' ? '#F59E0B' : '#EF4444';
  const label = `${endingType.charAt(0).toUpperCase() + endingType.slice(1)} Ending`;

  return (
    <View style={[styles.card, styles.endingCard, { borderColor: color }]}>
      <View style={styles.iconRow}>
        <Ionicons name={icon as any} size={20} color={color} />
        <Text style={[styles.title, { color }]}>{label}</Text>
      </View>
      <Text style={styles.summary}>{summary}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'center',
    maxWidth: '90%',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    marginVertical: Spacing.sm,
    gap: 8,
  },
  endingCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.borderSubtle,
    alignSelf: 'stretch',
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: Colors.brandPrimary,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summary: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontStyle: 'italic',
  },
});
