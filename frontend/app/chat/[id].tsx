import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, Pressable, Image,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { Colors, Radius, Spacing } from '@/src/theme/colors';
import { api } from '@/src/api/client';
import { streamMessage } from '@/src/api/sse';
import { StoryHeader, StoryStateBrief, Meters } from '@/src/components/StoryHeader';
import { ChapterTransitionCard } from '@/src/components/ChapterTransitionCard';
import { PaywallModal, PaywallKind } from '@/src/components/PaywallModal';
import { useAuth } from '@/src/context/auth';

interface Msg {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at?: string;
  type?: string; // 'chapter_transition' for system messages
  chapter_summary?: string;
  meters_snapshot?: Partial<Meters>;
  _streaming?: boolean;
}
interface Character { id: string; name: string; avatar: string; tagline: string; }
interface Chat {
  id: string;
  scenario_title?: string | null;
  story_state?: StoryStateBrief;
}

interface SendMessageResponseStoryState {
  chapter: number;
  meters: Meters;
  chapter_transition?: {
    title: string;
    summary: string;
    previous_chapter?: string;
  } | null;
  ending?: string;
  completed?: boolean;
}

const ENDING_VARIANT: Record<string, 'ending-good' | 'ending-bad' | 'ending-secret'> = {
  good: 'ending-good',
  bad: 'ending-bad',
  secret: 'ending-secret',
};

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
  const [storyState, setStoryState] = useState<StoryStateBrief | null>(null);
  const [meterDeltas, setMeterDeltas] = useState<Partial<Meters> | null>(null);
  const [latestChapterTitle, setLatestChapterTitle] = useState<string | undefined>(undefined);
  const [showEnding, setShowEnding] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [paywall, setPaywall] = useState<{ kind: PaywallKind; used: number; limit: number } | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [showImageHint, setShowImageHint] = useState(false);
  const [imageHint, setImageHint] = useState('');
  const { user: authUser, refresh: refreshUser } = useAuth();

  // Track mount + the in-flight stream's cancel function. If the user
  // navigates away mid-stream we abort the request and stop firing setState
  // on an unmounted component (would otherwise leak + log RN warnings).
  const mountedRef = useRef(true);
  const cancelStreamRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelStreamRef.current?.();
      cancelStreamRef.current = null;
    };
  }, []);
  const listRef = useRef<FlatList<Msg>>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api<{ messages: Msg[]; character: Character; chat: Chat }>(`/chats/${id}`);
      setCharacter(data.character);
      setChat(data.chat);
      setMessages(data.messages);
      if (data.chat?.story_state) {
        setStoryState(data.chat.story_state);
      }
      // Derive latest chapter title from messages
      const lastTransition = [...data.messages].reverse().find((m) => m.type === 'chapter_transition');
      if (lastTransition?.content) {
        // content is like "Chapter 2: The Library Whispers" or "Story Complete: ..."
        const m = lastTransition.content.match(/^Chapter \d+:\s*(.+)$/);
        if (m) setLatestChapterTitle(m[1]);
      }
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const revealStream = (finalText: string, replaceId: string) => {
    setMessages((m) => m.map((mm) => mm.id === replaceId ? { ...mm, content: '', _streaming: true } : mm));
    const words = finalText.split(/(\s+)/);
    let i = 0;
    const tick = () => {
      i = Math.min(i + 2, words.length);
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

  const applyStoryStateUpdate = (newState: SendMessageResponseStoryState) => {
    if (!storyState) {
      // No story_state yet (chat was started before arc gen succeeded, etc.).
      // Re-fetch the chat doc to get the canonical total_chapters / arc_title
      // rather than guessing (the previous fallback set total_chapters =
      // current chapter which made the UI show "Ch 1/1" forever).
      load();
      return;
    }
    // Compute deltas vs current
    const deltas: Partial<Meters> = {};
    (['trust', 'affection', 'rivalry', 'fear'] as const).forEach((k) => {
      const before = storyState.meters[k];
      const after = newState.meters[k];
      const d = after - before;
      if (d !== 0) deltas[k] = d;
    });
    setMeterDeltas(Object.keys(deltas).length ? deltas : null);
    setTimeout(() => setMeterDeltas(null), 3500);

    setStoryState({
      ...storyState,
      chapter: newState.chapter,
      meters: newState.meters,
      completed: newState.completed ?? storyState.completed,
      ending: newState.ending ?? storyState.ending,
    });

    if (newState.chapter_transition) {
      // Backend has already inserted the system message — we'll get it on next get_chat,
      // but for instant UX we synthesize and append it locally too.
      const synthetic: Msg = {
        id: `transition_${Date.now()}`,
        role: 'system',
        content: newState.chapter_transition.title,
        type: 'chapter_transition',
        chapter_summary: newState.chapter_transition.summary,
        meters_snapshot: newState.meters,
      };
      setMessages((m) => [...m, synthetic]);
      const m = newState.chapter_transition.title.match(/^Chapter \d+:\s*(.+)$/);
      if (m) setLatestChapterTitle(m[1]);
      if (newState.completed) {
        setShowEnding(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      }
    }
  };

  const send = () => {
    const text = draft.trim();
    if (!text || sending || !id) return;
    setDraft('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const optimisticId = `tmp_${Date.now()}`;
    setMessages((m) => [...m, { id: optimisticId, role: 'user', content: text }]);
    setSending(true);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);

    // Track the assistant id once `meta` arrives so subsequent delta events
    // know which bubble to append to.
    let assistantId: string | null = null;
    let receivedAny = false;

    streamMessage(id as string, text, {
      onMeta: ({ user_message, assistant_message_id }) => {
        if (!mountedRef.current) return;
        receivedAny = true;
        assistantId = assistant_message_id;
        setMessages((m) => [
          ...m.filter((mm) => mm.id !== optimisticId),
          user_message as Msg,
          { id: assistant_message_id, role: 'assistant', content: '', _streaming: true },
        ]);
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
      },
      onDelta: ({ text: chunk }) => {
        if (!mountedRef.current || !assistantId) return;
        const aid = assistantId;
        setMessages((m) =>
          m.map((mm) => (mm.id === aid ? { ...mm, content: mm.content + chunk } : mm)),
        );
      },
      onStory: (story) => {
        if (!mountedRef.current) return;
        applyStoryStateUpdate(story as any);
      },
      onDone: () => {
        cancelStreamRef.current = null;
        if (!mountedRef.current) return;
        if (assistantId) {
          const aid = assistantId;
          setMessages((m) =>
            m.map((mm) => (mm.id === aid ? { ...mm, _streaming: false } : mm)),
          );
        }
        setSending(false);
        refreshUser().catch(() => {});
      },
      onError: (err: any) => {
        cancelStreamRef.current = null;
        if (!mountedRef.current) return;
        const aid = assistantId;
        setMessages((m) =>
          m.filter((mm) => mm.id !== optimisticId && (aid ? mm.id !== aid : true)),
        );
        if (!receivedAny) setDraft(text);
        const pw = err?.status === 402 ? err?.data?.detail?.paywall : null;
        if (pw && (pw.kind === 'nsfw' || pw.kind === 'sfw_daily')) {
          setPaywall({ kind: pw.kind, used: pw.used, limit: pw.limit });
        } else {
          console.warn('Stream error', err);
          Alert.alert('Could not send message', err?.message || 'Please try again.');
        }
        setSending(false);
      },
    }).then((cancel) => {
      // streamMessage returns a Promise<cancel>. Keep the cancel so we can
      // abort if the user navigates away.
      cancelStreamRef.current = cancel;
    }).catch(() => {});
  };

  // Camera-button tap → either pop the paywall (if not subscribed) or open
  // the "what do you want her to show you?" prompt sheet.
  const openImageHint = () => {
    if (!authUser?.is_subscribed) {
      setPaywall({ kind: 'image_premium', used: 0, limit: 0 });
      return;
    }
    setImageHint('');
    setShowImageHint(true);
  };

  // Submit the (optional) hint to the backend and stream a placeholder until
  // the image arrives. Empty hint = a generic in-scene selfie.
  const submitImageHint = async () => {
    if (!id || imageLoading) return;
    const hint = imageHint.trim();
    setShowImageHint(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setImageLoading(true);
    const placeholderId = `img_tmp_${Date.now()}`;
    setMessages((m) => [
      ...m,
      { id: placeholderId, role: 'assistant', content: '', type: 'image', _streaming: true } as Msg,
    ]);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    try {
      const data = await api<{ assistant_message: Msg }>(
        `/chats/${id}/image`,
        // 5-minute timeout to absorb Replicate cold starts on first call.
        // Warm calls return in ~10-20s; the cap only matters on first hit.
        { method: 'POST', body: { hint }, timeoutMs: 300000 },
      );
      if (!mountedRef.current) return;
      setMessages((m) =>
        m.map((mm) => (mm.id === placeholderId ? { ...data.assistant_message, _streaming: false } : mm)),
      );
    } catch (e: any) {
      if (!mountedRef.current) return;
      setMessages((m) => m.filter((mm) => mm.id !== placeholderId));
      const msg = e?.message || '';
      if (msg.includes('paywall') || msg.includes('402')) {
        setPaywall({ kind: 'image_premium', used: 0, limit: 0 });
      } else {
        Alert.alert('Could not generate photo', msg || 'Please try again.');
      }
    } finally {
      if (mountedRef.current) setImageLoading(false);
    }
  };

  const regenerate = async () => {
    if (sending || regenIdx !== null) return;
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

  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant' && !messages[i]._streaming) { lastAssistantIdx = i; break; }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']} testID="chat-screen">
      {character?.avatar ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Image
            source={{ uri: character.avatar }}
            style={styles.backdropImg}
            blurRadius={Platform.OS === 'web' ? 0 : 45}
            resizeMode="cover"
          />
          <BlurView intensity={55} tint="dark" style={StyleSheet.absoluteFill} />
          <LinearGradient
            colors={['rgba(13,13,26,0.35)', 'rgba(13,13,26,0.72)', '#0D0D1A']}
            locations={[0, 0.55, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>
      ) : null}

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
                {chat?.scenario_title ? `📖 ${chat.scenario_title}` : 'online · in character'}
              </Text>
            </View>
          </Pressable>
        )}
        <View style={{ width: 40 }} />
      </View>

      {storyState && !storyState.completed && (
        <StoryHeader
          state={storyState}
          chapterTitle={latestChapterTitle}
          deltas={meterDeltas}
        />
      )}
      {storyState?.completed && storyState.ending && (
        <Pressable style={styles.endingBar} onPress={() => setShowEnding(true)} testID="ending-replay-btn">
          <LinearGradient
            colors={
              storyState.ending === 'good' ? ['rgba(16,185,129,0.4)', 'rgba(6,182,212,0.2)']
              : storyState.ending === 'bad' ? ['rgba(239,68,68,0.4)', 'rgba(124,58,237,0.2)']
              : ['rgba(245,158,11,0.4)', 'rgba(124,58,237,0.2)']
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFillObject}
          />
          <Ionicons
            name={storyState.ending === 'good' ? 'sparkles' : storyState.ending === 'bad' ? 'flame' : 'eye'}
            size={14}
            color="#fff"
          />
          <Text style={styles.endingText}>
            Story Complete · {storyState.ending.charAt(0).toUpperCase() + storyState.ending.slice(1)} Ending
          </Text>
          <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />
        </Pressable>
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
            if (item.role === 'system' && item.type === 'chapter_transition') {
              const isEnding = item.content.toLowerCase().startsWith('story complete');
              const endingType = isEnding && storyState?.ending ? storyState.ending : 'good';
              return (
                <ChapterTransitionCard
                  title={item.content}
                  summary={item.chapter_summary}
                  meters={item.meters_snapshot}
                  variant={isEnding ? ENDING_VARIANT[endingType] || 'ending-good' : 'chapter'}
                />
              );
            }
            if (item.role === 'system') {
              // Generic system message fallback
              return <Text style={styles.systemText}>{item.content}</Text>;
            }
            // In-chat image — a "selfie" the character sent.
            if (item.type === 'image') {
              return (
                <View style={styles.imageBubble} testID="msg-image">
                  {item._streaming || !item.content ? (
                    <View style={styles.imagePlaceholder}>
                      <ActivityIndicator color={Colors.brandPrimary} />
                      <Text style={styles.imagePlaceholderText}>Generating photo…</Text>
                    </View>
                  ) : (
                    <Image source={{ uri: item.content }} style={styles.imageMedia} resizeMode="cover" />
                  )}
                </View>
              );
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
          <View style={[styles.inputBar, inputFocused && styles.inputBarFocused]}>
            <TextInput
              testID="chat-input"
              value={draft}
              onChangeText={setDraft}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder={
                storyState?.completed
                  ? 'The story has ended.'
                  : `Message ${character?.name?.split(' ')[0] || ''}…`
              }
              placeholderTextColor={Colors.textSecondary}
              style={styles.input}
              multiline
              maxLength={2000}
              editable={!storyState?.completed}
            />
            <Pressable
              testID="chat-image-btn"
              onPress={openImageHint}
              disabled={imageLoading || sending || !!storyState?.completed}
              style={[styles.iconChip, (imageLoading || sending || !!storyState?.completed) && { opacity: 0.4 }]}
            >
              {imageLoading
                ? <ActivityIndicator size="small" color={Colors.textSecondary} />
                : <Ionicons name="camera" size={18} color={Colors.textSecondary} />}
            </Pressable>
            <Pressable
              testID="chat-send-btn"
              onPress={send}
              disabled={!draft.trim() || sending || !!storyState?.completed}
              style={[styles.sendBtn, (!draft.trim() || sending || !!storyState?.completed) && styles.sendBtnDisabled]}
            >
              <Ionicons name="arrow-up" size={20} color="#fff" />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Story-complete ending overlay */}
      <Modal
        visible={showEnding}
        transparent
        animationType="fade"
        onRequestClose={() => setShowEnding(false)}
      >
        <Pressable style={styles.endingBackdrop} onPress={() => setShowEnding(false)}>
          <Pressable style={styles.endingSheet} onPress={(e) => e.stopPropagation()}>
            <LinearGradient
              colors={
                storyState?.ending === 'good' ? ['rgba(16,185,129,0.35)', 'rgba(13,13,26,1)']
                : storyState?.ending === 'bad' ? ['rgba(239,68,68,0.35)', 'rgba(13,13,26,1)']
                : ['rgba(245,158,11,0.35)', 'rgba(13,13,26,1)']
              }
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
            <View style={styles.endingHeader}>
              <Ionicons
                name={storyState?.ending === 'good' ? 'sparkles'
                  : storyState?.ending === 'bad' ? 'flame'
                  : 'eye'}
                size={42}
                color={
                  storyState?.ending === 'good' ? Colors.success
                  : storyState?.ending === 'bad' ? Colors.error
                  : Colors.warning
                }
              />
              <Text style={styles.endingTitle}>Story Complete</Text>
              <Text style={styles.endingSub}>
                {storyState?.ending === 'good' ? 'A heartfelt ending earned through trust and kindness.'
                  : storyState?.ending === 'bad' ? 'A bitter ending shaped by your choices.'
                  : "A path most never find — you uncovered the secret ending."}
              </Text>
              <View style={[styles.endingBadge, {
                backgroundColor:
                  storyState?.ending === 'good' ? Colors.success
                  : storyState?.ending === 'bad' ? Colors.error
                  : Colors.warning,
              }]}>
                <Text style={styles.endingBadgeText}>
                  {(storyState?.ending || 'good').toUpperCase()} ENDING
                </Text>
              </View>
            </View>

            {storyState && (
              <View style={styles.endingMeters}>
                {(['trust', 'affection', 'rivalry', 'fear'] as const).map((k) => (
                  <View key={k} style={styles.endingMeterChip}>
                    <Text style={styles.endingMeterLabel}>{k}</Text>
                    <Text style={styles.endingMeterValue}>{storyState.meters[k]}</Text>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.endingActions}>
              <Pressable
                testID="ending-back-btn"
                style={styles.endingBtn}
                onPress={() => { setShowEnding(false); router.back(); }}
              >
                <Text style={styles.endingBtnText}>Back to Chats</Text>
              </Pressable>
              <Pressable
                testID="ending-close-btn"
                style={[styles.endingBtn, styles.endingBtnPrimary]}
                onPress={() => setShowEnding(false)}
              >
                <Text style={[styles.endingBtnText, { color: '#fff' }]}>View Conversation</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <PaywallModal
        visible={!!paywall}
        kind={paywall?.kind ?? 'nsfw'}
        used={paywall?.used}
        limit={paywall?.limit}
        onClose={() => setPaywall(null)}
      />

      {/* "What do you want her to show you?" sheet — subscribers only. */}
      <Modal
        visible={showImageHint}
        transparent
        animationType="fade"
        onRequestClose={() => setShowImageHint(false)}
      >
        <View style={styles.endingBackdrop}>
          <View style={styles.imageSheet}>
            <View style={styles.imageSheetHeader}>
              <Ionicons name="camera" size={22} color={Colors.brandPrimary} />
              <Text style={styles.imageSheetTitle}>Ask {character?.name?.split(' ')[0] || 'her'} for a photo</Text>
            </View>
            <Text style={styles.imageSheetBody}>
              Describe what you want her to show you — outfit, pose, setting, mood. Or leave it blank for a candid in-scene selfie.
            </Text>
            <TextInput
              testID="chat-image-hint-input"
              value={imageHint}
              onChangeText={setImageHint}
              placeholder="e.g. mirror selfie in her dorm, lingerie, looking back over her shoulder"
              placeholderTextColor={Colors.textSecondary}
              style={styles.imageHintInput}
              multiline
              maxLength={300}
              autoFocus
            />
            <View style={styles.imageSheetRow}>
              <Pressable
                testID="chat-image-cancel"
                onPress={() => setShowImageHint(false)}
                style={styles.imageBtnSecondary}
              >
                <Text style={styles.imageBtnSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                testID="chat-image-submit"
                onPress={submitImageHint}
                style={styles.imageBtnPrimary}
              >
                <Ionicons name="sparkles" size={16} color="#fff" />
                <Text style={styles.imageBtnPrimaryText}>
                  {imageHint.trim() ? 'Generate' : 'Send a selfie'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bgPrimary },
  backdropImg: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%', opacity: 0.55 },
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
  endingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
    overflow: 'hidden',
  },
  endingText: { flex: 1, color: '#fff', fontSize: 13, fontWeight: '700' },
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
  systemText: {
    color: Colors.textSecondary, fontSize: 12, fontStyle: 'italic',
    textAlign: 'center', paddingVertical: 4,
  },
  msgActions: { flexDirection: 'row', marginTop: 4, marginLeft: 4, gap: 8 },
  msgAction: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: Colors.inputBg, borderRadius: Radius.pill,
    borderWidth: 1, borderColor: Colors.borderDefault,
  },
  msgActionText: { color: Colors.textSecondary, fontSize: 11, fontWeight: '500' },
  composer: {
    paddingHorizontal: 12, paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 8 : 12,
    borderTopWidth: 1, borderTopColor: Colors.borderSubtle,
    backgroundColor: Colors.bgPrimary,
  },
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end',
    backgroundColor: Colors.inputBg,
    borderRadius: 24,
    borderWidth: 1, borderColor: Colors.borderDefault,
    paddingLeft: 16, paddingRight: 6, paddingVertical: 6,
  },
  inputBarFocused: {
    borderColor: Colors.brandPrimary,
  },
  input: {
    flex: 1, color: '#fff',
    fontSize: 15, lineHeight: 20,
    paddingTop: 8, paddingBottom: 8, paddingRight: 8,
    maxHeight: 120,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
  },
  iconChip: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center', justifyContent: 'center',
    marginRight: 4,
  },
  imageSheet: {
    width: '100%', maxWidth: 460,
    backgroundColor: Colors.bgSecondary,
    borderRadius: Radius.lg, padding: Spacing.xl,
    borderWidth: 1, borderColor: Colors.borderDefault,
    gap: 14,
  },
  imageSheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  imageSheetTitle: { color: '#fff', fontSize: 18, fontWeight: '700', flex: 1 },
  imageSheetBody: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19 },
  imageHintInput: {
    color: '#fff', fontSize: 14, lineHeight: 20,
    backgroundColor: Colors.inputBg,
    borderWidth: 1, borderColor: Colors.borderDefault, borderRadius: Radius.md,
    padding: 14, minHeight: 80,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
  },
  imageSheetRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  imageBtnSecondary: {
    paddingHorizontal: 16, paddingVertical: 12,
    borderRadius: Radius.pill,
  },
  imageBtnSecondaryText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '500' },
  imageBtnPrimary: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: Radius.pill,
    backgroundColor: Colors.brandPrimary,
  },
  imageBtnPrimaryText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  imageBubble: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.bgSecondary,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.borderDefault,
    maxWidth: '70%',
  },
  imageMedia: { width: 240, height: 240 },
  imagePlaceholder: {
    width: 240, height: 240,
    alignItems: 'center', justifyContent: 'center',
    gap: 8,
  },
  imagePlaceholderText: { color: Colors.textSecondary, fontSize: 12 },
  sendBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: Colors.borderDefault,
  },
  endingBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center', justifyContent: 'center',
    padding: Spacing.lg,
  },
  endingSheet: {
    width: '100%', maxWidth: 420,
    backgroundColor: Colors.bgSecondary,
    borderRadius: Radius.lg, padding: Spacing.xl,
    overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.borderDefault,
  },
  endingHeader: { alignItems: 'center', gap: 8, marginBottom: Spacing.lg },
  endingTitle: { color: '#fff', fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  endingSub: { color: Colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  endingBadge: {
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: Radius.pill, marginTop: 4,
  },
  endingBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  endingMeters: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    justifyContent: 'center', marginBottom: Spacing.lg,
  },
  endingMeterChip: {
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.borderSubtle, alignItems: 'center',
    minWidth: 70,
  },
  endingMeterLabel: { color: Colors.textSecondary, fontSize: 10, fontWeight: '600', textTransform: 'uppercase' },
  endingMeterValue: { color: '#fff', fontSize: 16, fontWeight: '800' },
  endingActions: { flexDirection: 'row', gap: 8 },
  endingBtn: {
    flex: 1, paddingVertical: 12, borderRadius: Radius.pill,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: Colors.borderDefault,
  },
  endingBtnPrimary: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  endingBtnText: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
});
