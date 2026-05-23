import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Image, Pressable,
  RefreshControl, ActivityIndicator, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { Colors, Radius, Spacing } from '@/src/theme/colors';
import { api } from '@/src/api/client';

const CATEGORIES = [
  { key: 'Trending', label: 'Trending', icon: 'flame' as const },
  { key: 'Favorites', label: 'Favorites', icon: 'heart' as const },
  { key: 'All', label: 'All', icon: 'sparkles' as const },
  { key: 'Anime', label: 'Anime', icon: 'star' as const },
  { key: 'Romance', label: 'Romance', icon: 'heart-circle' as const },
  { key: 'Helpers', label: 'Helpers', icon: 'medkit' as const },
  { key: 'Heroes', label: 'Heroes', icon: 'shield' as const },
  { key: 'Mystery', label: 'Mystery', icon: 'eye' as const },
  { key: 'Gaming', label: 'Gaming', icon: 'game-controller' as const },
  { key: 'Historical', label: 'Historical', icon: 'library' as const },
  { key: 'Original', label: 'Original', icon: 'planet' as const },
];

interface Character {
  id: string;
  name: string;
  tagline: string;
  avatar: string;
  genre: string;
  category?: string;
  chat_count?: number;
  is_favorited?: boolean;
}

export default function Discover() {
  const router = useRouter();
  const [active, setActive] = useState<string>('Trending');
  const [query, setQuery] = useState('');
  const [characters, setCharacters] = useState<Character[]>([]);
  const [featured, setFeatured] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      let chars: Character[] = [];
      if (active === 'Trending') {
        const data = await api<{ characters: Character[] }>('/characters/trending');
        chars = data.characters;
      } else if (active === 'Favorites') {
        const data = await api<{ characters: Character[] }>('/characters?favorites_only=true&limit=200');
        chars = data.characters;
      } else {
        const params = new URLSearchParams();
        if (active !== 'All') params.set('category', active);
        if (query.trim()) params.set('search', query.trim());
        const data = await api<{ characters: Character[] }>(`/characters?${params.toString()}`);
        chars = data.characters;
      }
      setCharacters(chars);
      // Featured only on Trending / All
      if (active === 'Trending' || active === 'All') {
        const feat = await api<{ characters: Character[] }>('/characters/featured');
        setFeatured(feat.characters.slice(0, 6));
      } else {
        setFeatured([]);
      }
    } catch (e) {
      console.warn('load characters', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [active, query]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Reload immediately when category changes (no debounce needed for tab clicks)
  useEffect(() => { load(); }, [active, load]);

  const onRefresh = () => { setRefreshing(true); load(); };
  const goCharacter = (id: string) => {
    Haptics.selectionAsync().catch(() => {});
    router.push(`/character/${id}`);
  };

  const onPickCategory = (key: string) => {
    Haptics.selectionAsync().catch(() => {});
    setActive(key);
  };

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
            onSubmitEditing={() => { if (active !== 'Trending' && active !== 'Favorites') load(); else setActive('All'); }}
          />
          {!!query && (
            <Pressable onPress={() => { setQuery(''); load(); }} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={Colors.textSecondary} />
            </Pressable>
          )}
        </View>

        {/* Category tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.catRow}
          style={{ marginTop: Spacing.md }}
        >
          {CATEGORIES.map((c) => {
            const isActive = active === c.key;
            return (
              <Pressable
                key={c.key}
                testID={`cat-${c.key.toLowerCase()}`}
                onPress={() => onPickCategory(c.key)}
                style={[styles.catChip, isActive && styles.catChipActive]}
              >
                <Ionicons
                  name={c.icon}
                  size={14}
                  color={isActive ? '#fff' : Colors.textSecondary}
                />
                <Text style={[styles.catText, isActive && styles.catTextActive]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

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
                  {item.is_favorited && (
                    <View style={styles.heartBadge}>
                      <Ionicons name="heart" size={14} color={Colors.error} />
                    </View>
                  )}
                  <View style={styles.featuredText}>
                    <View style={styles.genrePill}>
                      <Text style={styles.genrePillText}>{item.category || item.genre}</Text>
                    </View>
                    <Text style={styles.featuredName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.featuredTag} numberOfLines={2}>{item.tagline}</Text>
                  </View>
                </Pressable>
              )}
            />
          </View>
        )}

        {/* Character grid */}
        <View style={{ marginTop: Spacing.xl, paddingHorizontal: Spacing.lg }}>
          <View style={styles.gridHeader}>
            <Text style={styles.sectionTitle2}>
              {active === 'Trending' ? '🔥 Trending now' : active === 'Favorites' ? '❤ Your favorites' : active === 'All' ? 'All characters' : active}
            </Text>
            <Text style={styles.count}>{characters.length}</Text>
          </View>
          {loading ? (
            <ActivityIndicator color={Colors.brandPrimary} style={{ marginTop: 24 }} />
          ) : characters.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons
                name={active === 'Favorites' ? 'heart-outline' : 'search'}
                size={42}
                color={Colors.textSecondary}
              />
              <Text style={styles.emptyText}>
                {active === 'Favorites'
                  ? 'No favorites yet — tap the heart on any character.'
                  : 'No characters found. Try another category.'}
              </Text>
            </View>
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
                  {c.is_favorited && (
                    <View style={styles.heartBadgeSmall}>
                      <Ionicons name="heart" size={11} color={Colors.error} />
                    </View>
                  )}
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
  catRow: { paddingHorizontal: Spacing.lg, gap: 8 },
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 9,
    backgroundColor: Colors.inputBg, borderRadius: Radius.pill,
    borderWidth: 1, borderColor: Colors.borderDefault,
  },
  catChipActive: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  catText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '500' },
  catTextActive: { color: '#fff' },
  sectionTitle: { color: Colors.textPrimary, fontSize: 18, fontWeight: '700', paddingHorizontal: Spacing.lg, marginBottom: 12 },
  gridHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 },
  sectionTitle2: { color: Colors.textPrimary, fontSize: 18, fontWeight: '700' },
  count: { color: Colors.textSecondary, fontSize: 12 },
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
  heartBadge: {
    position: 'absolute', top: 10, right: 10,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },
  heartBadgeSmall: {
    position: 'absolute', top: 8, right: 8,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },
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
  empty: { alignItems: 'center', gap: 12, marginTop: 32, paddingHorizontal: Spacing.lg },
  emptyText: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
