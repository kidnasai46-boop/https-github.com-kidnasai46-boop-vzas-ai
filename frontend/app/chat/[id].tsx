import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, Pressable, Image,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Colors, Radius, Spacing } from '@/src/theme/colors';
import { api } from '@/src/api/client';

interface Msg { id: string; role: 'user' | 'assistant'; content: string; created_at?: string; }
interface Character { id: string; name: string; avatar: string; tagline: string; }

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [character, setCharacter] = useState<Character | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<Msg>>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api<{ messages: Msg[]; character: Character }>(`/chats/${id}`);
      setCharacter(data.character);
      setMessages(data.messages);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    const optimistic: Msg = {
      id: `tmp_${Date.now()}`,
      role: 'user',
      content: text,
    };
    setMessages((m) => [...m, optimistic]);
    setSending(true);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    try {
      const data = await api<{ user_message: Msg; assistant_message: Msg }>(
        `/chats/${id}/messages`,
        { method: 'POST', body: { content: text }, timeoutMs: 90000 },
      );
      setMessages((m) => [
        ...m.filter((mm) => mm.id !== optimistic.id),
        data.user_message,
        data.assistant_message,
      ]);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e) {
      // Re-show draft if failed
      setMessages((m) => m.filter((mm) => mm.id !== optimistic.id));
      setDraft(text);
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}><ActivityIndicator color={Colors.brandPrimary} size="large" /></View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']} testID="chat-screen">
      <View style={styles.topBar}>
        <Pressable testID="chat-back-btn" hitSlop={12} onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        {character && (
          <Pressable
            style={styles.charRow}
            onPress={() => router.push(`/character/${character.id}`)}
          >
            <Image source={{ uri: character.avatar }} style={styles.charAvatar} />
            <View>
              <Text style={styles.charName}>{character.name}</Text>
              <Text style={styles.charStatus}>online · in character</Text>
            </View>
          </Pressable>
        )}
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: Spacing.lg, paddingBottom: Spacing.md, gap: 10 }}
          renderItem={({ item }) => (
            <View
              testID={`msg-${item.role}`}
              style={[styles.bubble, item.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant]}
            >
              <Text style={item.role === 'user' ? styles.userText : styles.assistantText}>
                {item.content}
              </Text>
            </View>
          )}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListFooterComponent={
            sending ? (
              <View style={[styles.bubble, styles.bubbleAssistant, { flexDirection: 'row', gap: 6, alignItems: 'center' }]}>
                <ActivityIndicator size="small" color={Colors.textSecondary} />
                <Text style={styles.assistantText}>thinking…</Text>
              </View>
            ) : null
          }
        />

        <View style={styles.composer}>
          <TextInput
            testID="chat-input"
            value={draft}
            onChangeText={setDraft}
            placeholder={`Message ${character?.name?.split(' ')[0] || ''}…`}
            placeholderTextColor={Colors.textSecondary}
            style={styles.input}
            multiline
            maxLength={2000}
          />
          <Pressable
            testID="chat-send-btn"
            onPress={send}
            disabled={!draft.trim() || sending}
            style={[styles.sendBtn, (!draft.trim() || sending) && { opacity: 0.5 }]}
          >
            <Ionicons name="send" size={18} color="#fff" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bgPrimary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bgPrimary },
  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 10, gap: 8,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  charRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  charAvatar: { width: 38, height: 38, borderRadius: 19 },
  charName: { color: '#fff', fontSize: 15, fontWeight: '700' },
  charStatus: { color: Colors.success, fontSize: 11, marginTop: 2 },
  bubble: {
    maxWidth: '85%', paddingHorizontal: 14, paddingVertical: 10,
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.brandPrimary,
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
    borderBottomLeftRadius: 18, borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.bgSecondary,
    borderWidth: 1, borderColor: Colors.borderDefault,
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
    borderBottomRightRadius: 18, borderBottomLeftRadius: 4,
  },
  userText: { color: '#fff', fontSize: 15, lineHeight: 21 },
  assistantText: { color: Colors.textPrimary, fontSize: 15, lineHeight: 21 },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 12, paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 4 : 10,
    borderTopWidth: 1, borderTopColor: Colors.borderSubtle,
    backgroundColor: Colors.bgPrimary,
  },
  input: {
    flex: 1, color: '#fff',
    backgroundColor: Colors.inputBg, borderRadius: Radius.lg,
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10,
    borderWidth: 1, borderColor: Colors.borderDefault,
    maxHeight: 120, fontSize: 15,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
  },
});
