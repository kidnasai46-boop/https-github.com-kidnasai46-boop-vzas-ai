import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Colors, Spacing } from '@/src/theme/colors';
import { Button } from '@/src/components/Button';
import { storage } from '@/src/utils/storage';

const { width } = Dimensions.get('window');

const SLIDES = [
  {
    icon: 'sparkles' as const,
    color: Colors.brandPrimary,
    title: 'Talk to characters\nfrom any world',
    body: 'Chat with hand-crafted heroes, villains and dreamers — or summon brand new ones from your imagination.',
  },
  {
    icon: 'create-outline' as const,
    color: Colors.brandSecondary,
    title: 'Build your own\nAI companions',
    body: 'Design their look, personality, backstory and voice. Generate a portrait in seconds with AI.',
  },
  {
    icon: 'compass-outline' as const,
    color: '#F59E0B',
    title: 'You write\nthe story',
    body: 'Full narrative control. Steer the plot, choose the genre, and lose yourself in the conversation.',
  },
];

export default function Onboarding() {
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== index) setIndex(i);
  };

  const next = async () => {
    if (index < SLIDES.length - 1) {
      scrollRef.current?.scrollTo({ x: (index + 1) * width, animated: true });
    } else {
      await storage.setItem('onboarded', true);
      router.replace('/login');
    }
  };

  const skip = async () => {
    await storage.setItem('onboarded', true);
    router.replace('/login');
  };

  return (
    <SafeAreaView style={styles.safe} testID="onboarding-screen">
      <View style={styles.header}>
        <Pressable testID="onboarding-skip" onPress={skip} hitSlop={12}>
          <Text style={styles.skip}>Skip</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        {SLIDES.map((s, i) => (
          <View key={i} style={[styles.slide, { width }]} testID={`onboarding-slide-${i}`}>
            <LinearGradient
              colors={[s.color + '40', 'transparent']}
              style={styles.iconWrap}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
            >
              <View style={[styles.iconCircle, { borderColor: s.color }]}>
                <Ionicons name={s.icon} size={56} color={s.color} />
              </View>
            </LinearGradient>
            <Text style={styles.title}>{s.title}</Text>
            <Text style={styles.body}>{s.body}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.dots}>
        {SLIDES.map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i === index && styles.dotActive]}
          />
        ))}
      </View>

      <View style={styles.footer}>
        <Button
          testID="onboarding-next-btn"
          label={index === SLIDES.length - 1 ? 'Get Started' : 'Next'}
          onPress={next}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bgPrimary },
  header: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, alignItems: 'flex-end' },
  skip: { color: Colors.textSecondary, fontSize: 15, fontWeight: '500' },
  slide: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    alignItems: 'center',
  },
  iconWrap: {
    width: 220, height: 220, borderRadius: 110,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.xl,
  },
  iconCircle: {
    width: 140, height: 140, borderRadius: 70,
    backgroundColor: Colors.bgSecondary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  title: {
    color: Colors.textPrimary,
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 36,
    marginBottom: Spacing.md,
    letterSpacing: -0.5,
  },
  body: {
    color: Colors.textSecondary,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    paddingHorizontal: Spacing.md,
  },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: Spacing.lg },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.2)' },
  dotActive: { backgroundColor: Colors.brandPrimary, width: 24 },
  footer: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg },
});
