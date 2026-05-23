import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Image,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Colors, Radius, Spacing } from '@/src/theme/colors';
import { api } from '@/src/api/client';

const GENRES = ['All', 'Fantasy', 'Sci-Fi', 'Romance', 'Mystery', 'Drama', 'Adventure'];
const GENRE_ICONS: Record<string, any> = {
  All: 'sparkles',
  Fantasy: 'sparkles',
  'Sci-Fi': 'planet',
  Romance: 'heart',
  Mystery: 'eye',
  Drama: 'flame',
  Adventure: 'compass',
};

interface Character {
  id: string;
  name: string;
  tagline: string;
  avatar: string;
  genre: string;
  chat_count?: number;
  is_official?: boolean;
}

export default function Discover() {
  const router = useRouter();
  const [genre, setGenre] = useState('All');
  const [query, setQuery] = useState('');
  const [characters, setCharacters] = useState<Character[]>([]);
  const [featured, setFeatured] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (genre !== 'All') params.set('genre', genre);
      if (query.trim()) params.set('search', query.trim());
      const [list, feat] = await Promise.all([
        api<{ characters: Character[] }>(`/characters?${params.toString()}`, { auth: false }),
        api<{ characters: Character[] }>(`/characters/featured`, { auth: false }),
      ]);
      setCharacters(list.characters);
      setFeatured(feat.characters);
    } catch (e) {
      console.warn('load characters', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [genre, query]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const goCharacter = (id: string) => router.push(`/character/${id}`);

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="discover-screen">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl tintColor="#fff" refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.hello}>Discover</Text>
          <Text style={styles.headerSub}>Pick a character and start a story.</Text>
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={Colors.textSecondary} />
          <TextInput
            testID="discover-search-input"
            value={query}
            onChangeText={setQuery}
            placeholder="Search characters, tags, vibes…"
            placeholderTextColor={Colors.textSecondary}
            style={styles.search}
            returnKeyType="search"
            onSubmitEditing={load}
          />
        </View>

        {/* Featured carousel */}
        {featured.length > 0 && (
          <View style={{ marginTop: Spacing.lg }}>
            <Text style={styles.sectionTitle}>Featured</Text>
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={featured}
              keyExtractor={(c) => c.id}
              contentContainerStyle={{ paddingHorizontal: Spacing.lg, gap: 14 }}
              renderItem={({ item }) => (
                <Pressable
                  testID={`featured-card-${item.id}`}
                  style={styles.featuredCard}
                  onPress={() => goCharacter(item.id)}
                >
                  <Image source={{ uri: item.avatar }} style={styles.featuredImg} />
                  <LinearGradient
                    colors={['transparent', 'rgba(13,13,26,0.95)']}
                    style={styles.featuredOverlay}
                  />
                  <View style={styles.featuredText}>
                    <View style={styles.genrePill}>
                      <Text style={styles.genrePillText}>{item.genre}</Text>
                    </View>
                    <Text style={styles.featuredName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.featuredTag} numberOfLines={2}>{item.tagline}</Text>
                  </View>
                </Pressable>
              )}
            />
          </View>
        )}

        {/* Genres */}
        <View style={{ marginTop: Spacing.xl }}>
          <Text style={styles.sectionTitle}>Browse by genre</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: Spacing.lg, gap: 10 }}
          >
            {GENRES.map((g) => {
              const active = g === genre;
              return (
                <Pressable
                  key={g}
                  testID={`genre-chip-${g.toLowerCase()}`}
                  onPress={() => setGenre(g)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Ionicons
                    name={GENRE_ICONS[g] as any}
                    size={14}
                    color={active ? '#fff' : Colors.textSecondary}
                  />
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{g}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* List */}
        <View style={{ marginTop: Spacing.xl, paddingHorizontal: Spacing.lg }}>
          <Text style={styles.sectionTitle2}>
            {genre === 'All' ? 'All characters' : genre}
          </Text>
          {loading ? (
            <ActivityIndicator color={Colors.brandPrimary} style={{ marginTop: 24 }} />
          ) : characters.length === 0 ? (
            <Text style={styles.empty}>No characters yet.</Text>
          ) : (
            <View style={styles.grid}>
              {characters.map((c) => (
                <Pressable
                  key={c.id}
                  testID={`char-card-${c.id}`}
                  onPress={() => goCharacter(c.id)}
                  style={styles.card}
                >
                  <Image source={{ uri: c.avatar }} style={styles.cardImg} />
                  <LinearGradient
                    colors={['transparent', 'rgba(13,13,26,0.95)']}
                    style={styles.cardOverlay}
                  />
                  <View style={styles.cardText}>
                    <Text style={styles.cardName} numberOfLines={1}>{c.name}</Text>
                    <Text style={styles.cardTag} numberOfLines={2}>{c.tagline}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bgPrimary },
  header: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.md },
  hello: { color: Colors.textPrimary, fontSize: 32, fontWeight: '800', letterSpacing: -0.8 },
  headerSub: { color: Colors.textSecondary, fontSize: 14, marginTop: 4 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.inputBg, marginHorizontal: Spacing.lg,
    borderRadius: Radius.md, paddingHorizontal: 14, gap: 10,
    borderWidth: 1, borderColor: Colors.borderDefault,
  },
  search: { flex: 1, color: '#fff', paddingVertical: 12, fontSize: 15 },
  sectionTitle: { color: Colors.textPrimary, fontSize: 18, fontWeight: '700', paddingHorizontal: Spacing.lg, marginBottom: 12 },
  sectionTitle2: { color: Colors.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: 14 },
  featuredCard: {
    width: 260, height: 340, borderRadius: Radius.lg,
    overflow: 'hidden', backgroundColor: Colors.bgSecondary,
    borderWidth: 1, borderColor: Colors.borderSubtle,
  },
  featuredImg: { width: '100%', height: '100%' },
  featuredOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '60%' },
  featuredText: { position: 'absolute', left: 16, right: 16, bottom: 16, gap: 6 },
  featuredName: { color: '#fff', fontSize: 22, fontWeight: '700' },
  featuredTag: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  genrePill: {
    alignSelf: 'flex-start', backgroundColor: 'rgba(124,58,237,0.85)',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.pill, marginBottom: 4,
  },
  genrePillText: { color: '#fff', fontSize: 11, fontWeight: '600', letterSpacing: 0.4 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: Colors.inputBg, borderRadius: Radius.pill,
    borderWidth: 1, borderColor: Colors.borderDefault,
  },
  chipActive: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  chipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '500' },
  chipTextActive: { color: '#fff' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' },
  card: {
    width: '48%', aspectRatio: 0.72, borderRadius: Radius.md,
    overflow: 'hidden', backgroundColor: Colors.bgSecondary,
    borderWidth: 1, borderColor: Colors.borderSubtle, marginBottom: 4,
  },
  cardImg: { width: '100%', height: '100%' },
  cardOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '60%' },
  cardText: { position: 'absolute', left: 12, right: 12, bottom: 12 },
  cardName: { color: '#fff', fontSize: 15, fontWeight: '700' },
  cardTag: { color: Colors.textSecondary, fontSize: 12, lineHeight: 16, marginTop: 2 },
  empty: { color: Colors.textSecondary, textAlign: 'center', marginTop: 32 },
});
