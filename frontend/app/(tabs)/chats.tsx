import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Image, Pressable, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';

import { Colors, Radius, Spacing } from '@/src/theme/colors';
import { api } from '@/src/api/client';

interface ChatItem {
  id: string;
  character_id: string;
  last_message: string;
  last_message_at: string;
  character?: { name: string; avatar: string; tagline: string };
  story_state?: { chapter: number; total_chapters: number; completed: boolean; ending: string | null };
}

export default function Chats() {
  const router = useRouter();
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ chats: ChatItem[] }>('/chats');
      setChats(data.chats);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  const deleteChat = (id: string) => {
    Alert.alert('Delete chat?', 'Messages will be removed permanently.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await api(`/chats/${id}`, { method: 'DELETE' });
            setChats((c) => c.filter((ch) => ch.id !== id));
          } catch {}
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="chats-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Your Chats</Text>
        <Text style={styles.sub}>Pick up where you left off.</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={Colors.brandPrimary} style={{ marginTop: 60 }} />
      ) : chats.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="chatbubbles-outline" size={56} color={Colors.textSecondary} />
          <Text style={styles.emptyTitle}>No chats yet</Text>
          <Text style={styles.emptyBody}>Discover a character to start your first conversation.</Text>
          <Pressable
            testID="chats-go-discover"
            style={styles.emptyBtn}
            onPress={() => router.replace('/(tabs)')}
          >
            <Text style={styles.emptyBtnText}>Browse Characters</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={chats}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingBottom: 120, paddingHorizontal: Spacing.lg }}
          refreshControl={<RefreshControl tintColor="#fff" refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => (
            <Pressable
              testID={`chat-item-${item.id}`}
              style={styles.row}
              onPress={() => router.push(`/chat/${item.id}`)}
              onLongPress={() => deleteChat(item.id)}
            >
              <Image source={{ uri: item.character?.avatar }} style={styles.avatar} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.name} numberOfLines={1}>{item.character?.name}</Text>
                  {item.story_state && (
                    <Text style={{ color: Colors.brandPrimary, fontSize: 11, fontWeight: '600' }}>
                      {item.story_state.completed
                        ? `✓ ${(item.story_state.ending || 'done').charAt(0).toUpperCase() + (item.story_state.ending || 'done').slice(1)} Ending`
                        : `Ch. ${item.story_state.chapter}/${item.story_state.total_chapters}`}
                    </Text>
                  )}
                </View>
                <Text style={styles.last} numberOfLines={1}>
                  {item.last_message || item.character?.tagline}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={Colors.textSecondary} />
            </Pressable>
          )}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bgPrimary },
  header: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.lg },
  title: { color: Colors.textPrimary, fontSize: 32, fontWeight: '800', letterSpacing: -0.8 },
  sub: { color: Colors.textSecondary, fontSize: 14, marginTop: 4 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.bgSecondary, padding: 12, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.borderSubtle,
  },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#222' },
  name: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
  last: { color: Colors.textSecondary, fontSize: 13, marginTop: 2 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, marginTop: 80, gap: 12 },
  emptyTitle: { color: Colors.textPrimary, fontSize: 20, fontWeight: '700', marginTop: 8 },
  emptyBody: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  emptyBtn: {
    marginTop: 8, paddingHorizontal: 22, paddingVertical: 12,
    borderRadius: Radius.pill, backgroundColor: Colors.brandPrimary,
  },
  emptyBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
