import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Image, ScrollView, ActivityIndicator, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { Colors, Radius, Spacing } from '@/src/theme/colors';
import { Button } from '@/src/components/Button';
import { api } from '@/src/api/client';

interface Character {
  id: string;
  name: string;
  tagline: string;
  description: string;
  personality: string;
  backstory: string;
  greeting: string;
  avatar: string;
  genre: string;
  tags: string[];
  chat_count?: number;
  is_official?: boolean;
}

export default function CharacterScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [character, setCharacter] = useState<Character | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api<{ character: Character }>(`/characters/${id}`, { auth: false });
      setCharacter(data.character);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const startChat = async () => {
    if (!character) return;
    try {
      setStarting(true);
      const data = await api<{ chat: { id: string } }>(`/chats/start/${character.id}`, { method: 'POST' });
      router.push(`/chat/${data.chat.id}`);
    } catch (e: any) {
      Alert.alert('Could not start chat', e?.message || 'Try again');
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center} testID="character-loading">
        <ActivityIndicator color={Colors.brandPrimary} size="large" />
      </View>
    );
  }
  if (!character) {
    return (
      <View style={styles.center}>
        <Text style={{ color: '#fff' }}>Character not found.</Text>
      </View>
    );
  }

  return (
    <View style={styles.safe} testID="character-screen">
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
        <View style={styles.heroWrap}>
          <Image source={{ uri: character.avatar }} style={styles.heroImg} />
          <LinearGradient
            colors={['rgba(13,13,26,0.3)', 'rgba(13,13,26,0.95)']}
            style={styles.heroOverlay}
          />
          <SafeAreaView edges={['top']} style={styles.heroSafe}>
            <Pressable
              testID="character-back-btn"
              hitSlop={12}
              style={styles.backBtn}
              onPress={() => router.back()}
            >
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </Pressable>
          </SafeAreaView>
          <View style={styles.heroBottom}>
            <View style={styles.genrePill}>
              <Text style={styles.genrePillText}>{character.genre}</Text>
            </View>
            <Text style={styles.title}>{character.name}</Text>
            <Text style={styles.tagline}>{character.tagline}</Text>
          </View>
        </View>

        <View style={styles.body}>
          <Section title="About">
            <Text style={styles.paragraph}>{character.description}</Text>
          </Section>

          <Section title="Personality">
            <Text style={styles.paragraph}>{character.personality}</Text>
          </Section>

          {!!character.backstory && (
            <Section title="Backstory">
              <Text style={styles.paragraph}>{character.backstory}</Text>
            </Section>
          )}

          {character.tags?.length > 0 && (
            <Section title="Tags">
              <View style={styles.tagsRow}>
                {character.tags.map((t) => (
                  <View key={t} style={styles.tag}>
                    <Text style={styles.tagText}>#{t}</Text>
                  </View>
                ))}
              </View>
            </Section>
          )}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          testID="character-start-chat-btn"
          label="Start Conversation"
          onPress={startChat}
          loading={starting}
          icon={<Ionicons name="chatbubble-ellipses" size={18} color="#fff" />}
        />
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: Spacing.lg }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bgPrimary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bgPrimary },
  heroWrap: { width: '100%', height: 520, backgroundColor: Colors.bgSecondary },
  heroImg: { width: '100%', height: '100%' },
  heroOverlay: { ...StyleSheet.absoluteFillObject },
  heroSafe: { position: 'absolute', top: 0, left: 0, right: 0 },
  backBtn: {
    marginTop: 8, marginLeft: 16,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  heroBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: Spacing.lg },
  genrePill: {
    alignSelf: 'flex-start', backgroundColor: 'rgba(124,58,237,0.9)',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.pill, marginBottom: 10,
  },
  genrePillText: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  title: { color: '#fff', fontSize: 34, fontWeight: '800', letterSpacing: -0.8 },
  tagline: { color: Colors.textSecondary, fontSize: 15, marginTop: 6, lineHeight: 22 },
  body: { padding: Spacing.lg },
  sectionTitle: { color: Colors.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: 8 },
  paragraph: { color: Colors.textSecondary, fontSize: 15, lineHeight: 22 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: {
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: Colors.inputBg, borderRadius: Radius.pill,
    borderWidth: 1, borderColor: Colors.borderDefault,
  },
  tagText: { color: Colors.textPrimary, fontSize: 12, fontWeight: '500' },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: Spacing.lg, paddingTop: 14, paddingBottom: 28,
    backgroundColor: Colors.bgPrimary,
    borderTopWidth: 1, borderTopColor: Colors.borderSubtle,
  },
});
