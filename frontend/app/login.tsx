import React, { useState } from 'react';
import { View, Text, StyleSheet, Image, Alert, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Colors, Radius, Spacing } from '@/src/theme/colors';
import { Button } from '@/src/components/Button';
import { useAuth } from '@/src/context/auth';

export default function Login() {
  const { signIn, user } = useAuth();
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  React.useEffect(() => {
    if (user) router.replace('/(tabs)');
  }, [user, router]);

  const onSignIn = async () => {
    try {
      setLoading(true);
      await signIn();
    } catch (e: any) {
      Alert.alert('Sign-in failed', e?.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root} testID="login-screen">
      <LinearGradient
        colors={['rgba(124,58,237,0.25)', 'transparent']}
        style={styles.bgGlow}
      />
      <SafeAreaView style={styles.safe}>
        <View style={styles.hero}>
          <View style={styles.logoCircle}>
            <Ionicons name="sparkles" size={48} color={Colors.brandPrimary} />
          </View>
          <Text style={styles.brand}>Personae</Text>
          <Text style={styles.tagline}>Chat with characters from any universe.</Text>
        </View>

        <View style={styles.previewRow}>
          {[
            'https://images.unsplash.com/photo-1440589473619-3cde28941638?w=300',
            'https://images.unsplash.com/flagged/photo-1579451442952-f0365f3f0aed?w=300',
            'https://images.unsplash.com/photo-1775179182715-61dd143f7899?w=300',
          ].map((u, i) => (
            <Image
              key={i}
              source={{ uri: u }}
              style={[
                styles.previewAvatar,
                { transform: [{ rotate: `${(i - 1) * 6}deg` }, { translateY: i === 1 ? -12 : 0 }] },
              ]}
            />
          ))}
        </View>

        <View style={styles.footer}>
          <Button
            testID="login-google-btn"
            label="Continue with Google"
            onPress={onSignIn}
            loading={loading}
            icon={<Ionicons name="logo-google" size={18} color="#fff" />}
          />
          <Text style={styles.disclaimer}>
            By continuing you agree to our Terms & Privacy Policy.
          </Text>
          <Pressable onPress={() => router.replace('/onboarding')} hitSlop={10} testID="login-back-btn">
            <Text style={styles.back}>← Replay intro</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bgPrimary },
  bgGlow: { position: 'absolute', top: -100, left: 0, right: 0, height: 400 },
  safe: { flex: 1, justifyContent: 'space-between', paddingHorizontal: Spacing.lg },
  hero: { alignItems: 'center', marginTop: Spacing.xxl },
  logoCircle: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: Colors.bgSecondary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(124,58,237,0.4)',
    marginBottom: Spacing.lg,
  },
  brand: {
    color: Colors.textPrimary,
    fontSize: 38, fontWeight: '800', letterSpacing: -1,
  },
  tagline: {
    color: Colors.textSecondary,
    fontSize: 16,
    marginTop: Spacing.sm,
    textAlign: 'center',
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    marginVertical: Spacing.xl,
  },
  previewAvatar: {
    width: 92, height: 124, borderRadius: Radius.md,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.08)',
  },
  footer: { paddingBottom: Spacing.lg, gap: Spacing.md },
  disclaimer: {
    color: Colors.textSecondary, fontSize: 12, textAlign: 'center',
  },
  back: { color: Colors.brandSecondary, textAlign: 'center', fontSize: 14, marginTop: 4 },
});
