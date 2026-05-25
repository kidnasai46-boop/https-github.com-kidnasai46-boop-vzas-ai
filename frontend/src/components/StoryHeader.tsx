import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, LayoutAnimation, Platform, UIManager,
  Animated, Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { Colors, Radius, Spacing } from '@/src/theme/colors';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export interface Meters {
  trust: number;
  affection: number;
  rivalry: number;
  fear: number;
}

export interface StoryStateBrief {
  arc_title?: string;
  chapter: number;
  total_chapters: number;
  meters: Meters;
  ending?: string;
  completed?: boolean;
}

interface Props {
  state: StoryStateBrief;
  chapterTitle?: string; // optional latest chapter title from last transition
  deltas?: Partial<Meters> | null;
}

const METER_CONFIG: Array<{
  key: keyof Meters;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}> = [
  { key: 'trust', label: 'Trust', icon: 'shield-checkmark', color: '#06B6D4' },
  { key: 'affection', label: 'Affection', icon: 'heart', color: '#EC4899' },
  { key: 'rivalry', label: 'Rivalry', icon: 'flash', color: '#F59E0B' },
  { key: 'fear', label: 'Fear', icon: 'warning', color: '#EF4444' },
];

export function StoryHeader({ state, chapterTitle, deltas }: Props) {
  const [expanded, setExpanded] = useState(false);

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.create(240, 'easeInEaseOut', 'opacity'));
    setExpanded((e) => !e);
  };

  if (state.completed) {
    // When completed, the EndingCard renders instead.
    return null;
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        testID="story-header-toggle"
        onPress={toggle}
        style={styles.bar}
      >
        <LinearGradient
          colors={['rgba(124,58,237,0.3)', 'rgba(6,182,212,0.18)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFillObject}
        />
        <Ionicons name="book" size={14} color={Colors.brandPrimary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.arcText} numberOfLines={1}>
            {state.arc_title || 'Story Arc'}
            <Text style={styles.chText}>  ·  Chapter {state.chapter}/{state.total_chapters}</Text>
          </Text>
          {!!chapterTitle && (
            <Text style={styles.chapterTitle} numberOfLines={1}>{chapterTitle}</Text>
          )}
        </View>
        <View style={styles.dots}>
          {METER_CONFIG.map((m) => (
            <View
              key={m.key}
              style={[styles.dot, { backgroundColor: m.color, opacity: 0.4 + state.meters[m.key] / 200 }]}
            />
          ))}
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={Colors.textSecondary}
        />
      </Pressable>

      {expanded && (
        <View style={styles.expanded}>
          {METER_CONFIG.map((m) => (
            <MeterBar
              key={m.key}
              icon={m.icon}
              label={m.label}
              color={m.color}
              value={state.meters[m.key]}
              delta={deltas ? deltas[m.key] : undefined}
            />
          ))}
        </View>
      )}
    </View>
  );
}

interface MeterBarProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  value: number;
  delta?: number;
}

function MeterBar({ icon, label, color, value, delta }: MeterBarProps) {
  const widthAnim = useRef(new Animated.Value(value)).current;
  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: value,
      duration: 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [value, widthAnim]);

  const widthInterp = widthAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={meterStyles.row} testID={`meter-${label.toLowerCase()}`}>
      <View style={[meterStyles.iconCircle, { backgroundColor: color + '22' }]}>
        <Ionicons name={icon} size={13} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={meterStyles.labelRow}>
          <Text style={meterStyles.label}>{label}</Text>
          <Text style={meterStyles.value}>
            {value}
            {delta !== undefined && delta !== 0 && (
              <Text style={[meterStyles.delta, { color: delta > 0 ? Colors.success : Colors.error }]}>
                {' '}{delta > 0 ? '+' : ''}{delta}
              </Text>
            )}
          </Text>
        </View>
        <View style={meterStyles.track}>
          <Animated.View style={[meterStyles.fill, { width: widthInterp, backgroundColor: color }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
    overflow: 'hidden',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
  },
  arcText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  chText: { color: Colors.textSecondary, fontWeight: '500' },
  chapterTitle: { color: Colors.textSecondary, fontSize: 11, marginTop: 1 },
  dots: { flexDirection: 'row', gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  expanded: {
    paddingHorizontal: Spacing.lg,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 8,
    backgroundColor: 'rgba(124,58,237,0.04)',
  },
});

const meterStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconCircle: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  label: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.4 },
  value: { color: '#fff', fontSize: 12, fontWeight: '700' },
  delta: { fontSize: 11, fontWeight: '700' },
  track: {
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 3 },
});
