import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, Pressable, Image,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { Colors, Radius, Spacing } from '@/src/theme/colors';
import { api } from '@/src/api/client';
import { MeterBar } from '@/src/components/MeterBar';
import { ChapterCard, EndingCard } from '@/src/components/ChapterCard';

interface Msg {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at?: string;
  _streaming?: boolean;
  type?: string;
  chapter_summary?: string;
  meters_snapshot?: { trust: number; affection: number; rivalry: number; fear: number };
}
interface StoryState {
  chapter: number;
  total_chapters: number;
  meters: { trust: number; affection: number; rivalry: number; fear: number };
  ending: string | null;
  completed: boolean;
  arc_title: string;
}
interface Character { id: string; name: string; avatar: string; tagline: string; }
interface Chat { id: string; scenario_title?: string | null; }

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [character, setCharacter] = useState<Character | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [regenIdx, setRegenIdx] = useState<number | null>(null);
  const [storyState, setStoryState] = useState<StoryState | null>(null);
  const listRef = useRef<FlatList<Msg>>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api<{ messages: Msg[]; character: Character; chat: Chat }>(`/chats/${id}`);
      setCharacter(data.character);
      setChat(data.chat);
      setMessages(data.messages);
      if ((data.chat as any)?.story_state) {
        setStoryState((data.chat as any).story_state);
      }
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Reveal a final assistant message word-by-word for streaming feel
  const revealStream = (finalText: string, replaceId: string) => {
    setMessages((m) => m.map((mm) => mm.id === replaceId ? { ...mm, content: '', _streaming: true } : mm));
    const words = finalText.split(/(\s+)/); // keep whitespace tokens
    let i = 0;
    const tick = () => {
      i = Math.min(i + 2, words.length); // 2 tokens per tick = fast but visible
      const partial = words.slice(0, i).join('');
      setMessages((m) => m.map((mm) => mm.id === replaceId ? { ...mm, content: partial } : mm));
      if (i < words.length) {
        setTimeout(tick, 28);
      } else {
        setMessages((m) => m.map((mm) => mm.id === replaceId ? { ...mm, _streaming: false } : mm));
      }
    };
    tick();
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const optimistic: Msg = { id: `tmp_${Date.now()}`, role: 'user', content: text };
    setMessages((m) => [...m, optimistic]);
    setSending(true);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    try {
      const data = await api<{ user_message: Msg; assistant_message: Msg; story_state?: any }>(
        `/chats/${id}/messages`,
        { method: 'POST', body: { content: text }, timeoutMs: 90000 },
      );
      const placeholderId = data.assistant_message.id;
      const newMsgs: Msg[] = [data.user_message];
      if (data.story_state) {
        setStoryState((prev) => prev ? { ...prev, ...data.story_state } : null);
        if (data.story_state.chapter_transition) {
          newMsgs.push({
            id: `transition_${Date.now()}`,
            role: 'system',
            content: data.story_state.chapter_transition.title,
            type: 'chapter_transition',
            chapter_summary: data.story_state.chapter_transition.summary,
            meters_snapshot: data.story_state.meters,
          });
        }
      }
      newMsgs.push({ ...data.assistant_message, content: '', _streaming: true });
      setMessages((m) => [...m.filter((mm) => mm.id !== optimistic.id), ...newMsgs]);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
      revealStream(data.assistant_message.content, placeholderId);
    } catch (e) {
      setMessages((m) => m.filter((mm) => mm.id !== optimistic.id));
      setDraft(text);
      Alert.alert('Could not send message', 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  const regenerate = async () => {
    if (sending || regenIdx !== null) return;
    // Find the last assistant message index
    let lastIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') { lastIdx = i; break; }
    }
    if (lastIdx < 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setRegenIdx(lastIdx);
    try {
      const data = await api<{ assistant_message: Msg }>(
        `/chats/${id}/regenerate`,
        { method: 'POST', timeoutMs: 90000 },
      );
      setMessages((m) => {
        const next = [...m];
        next[lastIdx] = { ...data.assistant_message, content: '', _streaming: true };
        return next;
      });
      revealStream(data.assistant_message.content, data.assistant_message.id);
    } catch (e) {
      Alert.alert('Could not regenerate', 'Please try again.');
    } finally {
      setRegenIdx(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}><ActivityIndicator color={Colors.brandPrimary} size="large" /></View>
    );
  }

  // Index of last assistant message (for showing regen button only on the latest)
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant' && !messages[i]._streaming) { lastAssistantIdx = i; break; }
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
            <View style={{ flex: 1 }}>
              <Text style={styles.charName}>{character.name}</Text>
              <Text style={styles.charStatus} numberOfLines={1}>
                {storyState && !storyState.completed
                  ? `Ch. ${storyState.chapter}/${storyState.total_chapters} · ${storyState.arc_title}`
                  : chat?.scenario_title ? `📖 ${chat.scenario_title}` : 'online · in character'}
              </Text>
            </View>
          </Pressable>
        )}
        <View style={{ width: 40 }} />
      </View>

      {storyState && !storyState.completed && (
        <MeterBar meters={storyState.meters} />
      )}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: Spacing.lg, paddingBottom: Spacing.md, gap: 10 }}
          renderItem={({ item, index }) => {
            if (item.type === 'chapter_transition') {
              if (storyState?.completed && storyState?.ending) {
                return <EndingCard endingType={storyState.ending} summary={item.chapter_summary || item.content} />;
              }
              return <ChapterCard transition={{ title: item.content, summary: item.chapter_summary || '' }} />;
            }
            return (
              <View>
                <View
                  testID={`msg-${item.role}`}
                  style={[styles.bubble, item.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant]}
                >
                  <Text style={item.role === 'user' ? styles.userText : styles.assistantText}>
                    {item.content}
                    {item._streaming && <Text style={styles.cursor}>▌</Text>}
                  </Text>
                </View>
                {item.role === 'assistant' && index === lastAssistantIdx && index > 0 && (
                  <View style={styles.msgActions}>
                    <Pressable
                      testID="msg-regen-btn"
                      onPress={regenerate}
                      style={styles.msgAction}
                      disabled={regenIdx !== null}
                    >
                      {regenIdx !== null ? (
                        <ActivityIndicator size="small" color={Colors.textSecondary} />
                      ) : (
                        <Ionicons name="refresh" size={14} color={Colors.textSecondary} />
                      )}
                      <Text style={styles.msgActionText}>Regenerate</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          }}
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
  bubble: { maxWidth: '85%', paddingHorizontal: 14, paddingVertical: 10 },
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
  cursor: { color: Colors.brandPrimary, fontWeight: '700' },
  msgActions: { flexDirection: 'row', marginTop: 4, marginLeft: 4, gap: 8 },
  msgAction: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: Colors.inputBg, borderRadius: Radius.pill,
    borderWidth: 1, borderColor: Colors.borderDefault,
  },
  msgActionText: { color: Colors.textSecondary, fontSize: 11, fontWeight: '500' },
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
