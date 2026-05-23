import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, Image, ScrollView, ActivityIndicator,
  Pressable, Alert, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { Colors, Radius, Spacing } from '@/src/theme/colors';
import { Button } from '@/src/components/Button';
import { api } from '@/src/api/client';

interface Scenario {
  id: string;
  title: string;
  description: string;
  first_message: string;
}

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
  category?: string;
  tags: string[];
  scenarios?: Scenario[];
  chat_count?: number;
  favorite_count?: number;
  is_favorited?: boolean;
}

export default function CharacterScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [character, setCharacter] = useState<Character | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [favBusy, setFavBusy] = useState(false);
  const [scenariosOpen, setScenariosOpen] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api<{ character: Character }>(`/characters/${id}`);
      setCharacter(data.character);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleFav = async () => {
    if (!character || favBusy) return;
    try {
      setFavBusy(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      const willFav = !character.is_favorited;
      if (willFav) {
        await api(`/characters/${character.id}/favorite`, { method: 'POST' });
      } else {
        await api(`/characters/${character.id}/favorite`, { method: 'DELETE' });
      }
      setCharacter((c) => c ? { ...c, is_favorited: willFav, favorite_count: (c.favorite_count || 0) + (willFav ? 1 : -1) } : c);
    } catch (e) {
      console.warn(e);
    } finally {
      setFavBusy(false);
    }
  };

  const startChat = async (scenarioId?: string) => {
    if (!character) return;
    try {
      setStarting(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      const data = await api<{ chat: { id: string } }>(
        `/chats/start/${character.id}`,
        { method: 'POST', body: { scenario_id: scenarioId || null, fresh: !!scenarioId } },
      );
      setScenariosOpen(false);
      router.push(`/chat/${data.chat.id}`);
    } catch (e: any) {
      Alert.alert('Could not start chat', e?.message || 'Try again');
    } finally {
      setStarting(false);
    }
  };

  const onStartPress = () => {
    if (character?.scenarios && character.scenarios.length > 0) {
      setScenariosOpen(true);
    } else {
      startChat();
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
            <View style={styles.heroBar}>
              <Pressable testID="character-back-btn" hitSlop={12} style={styles.iconBtn} onPress={() => router.back()}>
                <Ionicons name="chevron-back" size={22} color="#fff" />
              </Pressable>
              <View style={{ flex: 1 }} />
              <Pressable
                testID="character-fav-btn"
                hitSlop={12}
                style={[styles.iconBtn, character.is_favorited && styles.iconBtnFav]}
                onPress={toggleFav}
                disabled={favBusy}
              >
                <Ionicons
                  name={character.is_favorited ? 'heart' : 'heart-outline'}
                  size={20}
                  color={character.is_favorited ? Colors.error : '#fff'}
                />
              </Pressable>
            </View>
          </SafeAreaView>
          <View style={styles.heroBottom}>
            <View style={styles.genrePill}>
              <Text style={styles.genrePillText}>{character.category || character.genre}</Text>
            </View>
            <Text style={styles.title}>{character.name}</Text>
            <Text style={styles.tagline}>{character.tagline}</Text>
            <View style={styles.statsRow}>
              <View style={styles.statPill}>
                <Ionicons name="chatbubble" size={11} color={Colors.textSecondary} />
                <Text style={styles.statText}>{character.chat_count || 0} chats</Text>
              </View>
              <View style={styles.statPill}>
                <Ionicons name="heart" size={11} color={Colors.error} />
                <Text style={styles.statText}>{character.favorite_count || 0} likes</Text>
              </View>
            </View>
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

          {character.scenarios && character.scenarios.length > 0 && (
            <Section title="Scenarios">
              <Text style={[styles.paragraph, { marginBottom: 8 }]}>
                Different ways to begin your story.
              </Text>
              {character.scenarios.map((s) => (
                <View key={s.id} style={styles.scenarioCard}>
                  <Text style={styles.scenarioTitle}>{s.title}</Text>
                  <Text style={styles.scenarioDesc}>{s.description}</Text>
                </View>
              ))}
            </Section>
          )}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          testID="character-start-chat-btn"
          label={character.scenarios && character.scenarios.length > 0 ? 'Choose & Start' : 'Start Conversation'}
          onPress={onStartPress}
          loading={starting}
          icon={<Ionicons name="chatbubble-ellipses" size={18} color="#fff" />}
        />
      </View>

      {/* Scenario picker modal */}
      <Modal visible={scenariosOpen} transparent animationType="slide" onRequestClose={() => setScenariosOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setScenariosOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Choose a scenario</Text>
            <Text style={styles.sheetSub}>Pick a starting point — or use the default greeting.</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              <Pressable
                testID="scenario-default"
                style={styles.scenarioRow}
                onPress={() => startChat()}
              >
                <View style={styles.scenarioRowIcon}>
                  <Ionicons name="sparkles" size={18} color={Colors.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.scenarioRowTitle}>Default opening</Text>
                  <Text style={styles.scenarioRowDesc} numberOfLines={2}>
                    {character.greeting?.replace(/\*[^*]+\*/g, '').trim() || 'Start a free-form conversation.'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
              </Pressable>
              {character.scenarios?.map((s) => (
                <Pressable
                  key={s.id}
                  testID={`scenario-${s.id}`}
                  style={styles.scenarioRow}
                  onPress={() => startChat(s.id)}
                >
                  <View style={styles.scenarioRowIcon}>
                    <Ionicons name="play-circle" size={18} color={Colors.brandSecondary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.scenarioRowTitle}>{s.title}</Text>
                    <Text style={styles.scenarioRowDesc} numberOfLines={2}>{s.description}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
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
  heroBar: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 8, alignItems: 'center', gap: 8 },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  iconBtnFav: { borderColor: Colors.error },
  heroBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: Spacing.lg },
  genrePill: {
    alignSelf: 'flex-start', backgroundColor: 'rgba(124,58,237,0.9)',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.pill, marginBottom: 10,
  },
  genrePillText: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  title: { color: '#fff', fontSize: 34, fontWeight: '800', letterSpacing: -0.8 },
  tagline: { color: Colors.textSecondary, fontSize: 15, marginTop: 6, lineHeight: 22 },
  statsRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  statPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: Radius.pill,
  },
  statText: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600' },
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
  scenarioCard: {
    backgroundColor: Colors.bgSecondary, borderRadius: Radius.md,
    padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: Colors.borderSubtle,
  },
  scenarioTitle: { color: '#fff', fontSize: 14, fontWeight: '700' },
  scenarioDesc: { color: Colors.textSecondary, fontSize: 13, marginTop: 4, lineHeight: 18 },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: Spacing.lg, paddingTop: 14, paddingBottom: 28,
    backgroundColor: Colors.bgPrimary,
    borderTopWidth: 1, borderTopColor: Colors.borderSubtle,
  },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.bgSecondary,
    borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg,
    padding: Spacing.lg, paddingBottom: 36, gap: 8,
  },
  sheetHandle: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)', marginBottom: 8,
  },
  sheetTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  sheetSub: { color: Colors.textSecondary, fontSize: 13, marginBottom: 12 },
  scenarioRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 8, borderRadius: Radius.md,
    backgroundColor: Colors.bgPrimary, borderWidth: 1, borderColor: Colors.borderSubtle,
    marginBottom: 8,
  },
  scenarioRowIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(124,58,237,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  scenarioRowTitle: { color: '#fff', fontSize: 14, fontWeight: '700' },
  scenarioRowDesc: { color: Colors.textSecondary, fontSize: 12, marginTop: 2, lineHeight: 16 },
});
