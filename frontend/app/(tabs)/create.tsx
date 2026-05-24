import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, Image, Alert, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Colors, Radius, Spacing } from '@/src/theme/colors';
import { Button } from '@/src/components/Button';
import { api } from '@/src/api/client';

const GENRES = ['Fantasy', 'Sci-Fi', 'Romance', 'Horror', 'Comedy', 'Anime', 'Slice of Life', 'Historical', 'Mystery', 'Drama', 'Adventure'];

interface FormState {
  name: string;
  tagline: string;
  description: string;
  personality: string;
  backstory: string;
  greeting: string;
  avatar: string;
  genre: string;
  tags: string;
}

const empty: FormState = {
  name: '', tagline: '', description: '', personality: '',
  backstory: '', greeting: '', avatar: '', genre: 'Fantasy', tags: '',
};

export default function Create() {
  const router = useRouter();
  const [step, setStep] = useState(0); // 0: basics, 1: avatar, 2: personality
  const [form, setForm] = useState<FormState>(empty);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  const update = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const canNext0 = form.name.trim().length > 1 && form.tagline.trim().length > 3 && form.genre;
  const canNext1 = !!form.avatar;
  const canSave = canNext0 && canNext1 && form.personality.trim().length > 3 && form.greeting.trim().length > 3;

  const generateAvatar = async () => {
    const prompt = (form.description || form.tagline || form.name).trim();
    if (!prompt) {
      Alert.alert('Add some details', 'Write a short description (or tagline) first so we can imagine your character.');
      return;
    }
    try {
      setGenerating(true);
      const data = await api<{ avatar: string }>('/characters/generate-avatar', {
        method: 'POST',
        body: { prompt },
        timeoutMs: 90000,
      });
      update('avatar', data.avatar);
    } catch (e: any) {
      Alert.alert('Image generation failed', e?.message || 'Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const save = async () => {
    if (!canSave) return;
    try {
      setSaving(true);
      const payload = {
        ...form,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
        backstory: form.backstory || form.description,
      };
      const data = await api<{ character: { id: string } }>('/characters', { method: 'POST', body: payload });
      setForm(empty);
      setStep(0);
      router.push(`/character/${data.character.id}`);
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Try again');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="create-screen">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Create</Text>
          <Text style={styles.sub}>Bring your own AI character to life.</Text>
          <View style={styles.steps}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={[styles.stepBar, i <= step && styles.stepBarActive]} />
            ))}
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 180 }} keyboardShouldPersistTaps="handled">
          {step === 0 && (
            <View style={{ gap: 16 }}>
              <Field label="Character name" value={form.name} onChange={(v) => update('name', v)} placeholder="e.g. Lyra Ashenvale" testID="create-name-input" />
              <Field label="Tagline" value={form.tagline} onChange={(v) => update('tagline', v)} placeholder="A one-line hook" testID="create-tagline-input" />
              <Field
                label="Short description"
                value={form.description}
                onChange={(v) => update('description', v)}
                placeholder="Who are they? What's their world?"
                multiline
                testID="create-description-input"
              />
              <Text style={styles.label}>Genre</Text>
              <View style={styles.chipsRow}>
                {GENRES.map((g) => {
                  const active = form.genre === g;
                  return (
                    <Pressable
                      key={g}
                      testID={`create-genre-${g.toLowerCase()}`}
                      onPress={() => update('genre', g)}
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{g}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {step === 1 && (
            <View style={{ gap: 16 }}>
              <Text style={styles.label}>Character avatar</Text>
              <Text style={styles.help}>We&apos;ll use your description to imagine them. You can regenerate as many times as you like.</Text>
              <View style={styles.avatarPreview}>
                {generating ? (
                  <View style={styles.previewLoading}>
                    <ActivityIndicator color={Colors.brandPrimary} size="large" />
                    <Text style={styles.previewLoadingText}>Painting your character…</Text>
                  </View>
                ) : form.avatar ? (
                  <Image source={{ uri: form.avatar }} style={styles.previewImg} />
                ) : (
                  <View style={styles.previewPlaceholder}>
                    <Ionicons name="image-outline" size={48} color={Colors.textSecondary} />
                    <Text style={styles.previewLoadingText}>Tap below to generate</Text>
                  </View>
                )}
              </View>
              <Button
                testID="create-generate-avatar-btn"
                label={form.avatar ? 'Regenerate' : 'Generate Avatar'}
                onPress={generateAvatar}
                loading={generating}
                icon={<Ionicons name="sparkles" size={16} color="#fff" />}
              />
            </View>
          )}

          {step === 2 && (
            <View style={{ gap: 16 }}>
              <Field
                label="Personality"
                value={form.personality}
                onChange={(v) => update('personality', v)}
                placeholder="e.g. Mysterious, wise, gently flirtatious"
                multiline
                testID="create-personality-input"
              />
              <Field
                label="Backstory (optional)"
                value={form.backstory}
                onChange={(v) => update('backstory', v)}
                placeholder="Where they came from, what shaped them"
                multiline
                testID="create-backstory-input"
              />
              <Field
                label="Opening greeting"
                value={form.greeting}
                onChange={(v) => update('greeting', v)}
                placeholder="The first message they send"
                multiline
                testID="create-greeting-input"
              />
              <Field
                label="Tags (comma-separated)"
                value={form.tags}
                onChange={(v) => update('tags', v)}
                placeholder="e.g. fantasy, sorceress, roleplay"
                testID="create-tags-input"
              />
            </View>
          )}
        </ScrollView>

        <View style={styles.footer}>
          {step > 0 && (
            <Pressable testID="create-back-btn" style={styles.backBtn} onPress={() => setStep((s) => s - 1)}>
              <Ionicons name="chevron-back" size={20} color="#fff" />
              <Text style={styles.backBtnText}>Back</Text>
            </Pressable>
          )}
          <View style={{ flex: 1 }} />
          {step < 2 ? (
            <Button
              testID="create-next-btn"
              label="Next"
              onPress={() => setStep((s) => s + 1)}
              disabled={(step === 0 && !canNext0) || (step === 1 && !canNext1)}
              style={{ minWidth: 140 }}
            />
          ) : (
            <Button
              testID="create-save-btn"
              label="Create Character"
              onPress={save}
              loading={saving}
              disabled={!canSave}
              style={{ minWidth: 200 }}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChange, placeholder, multiline, testID }: any) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={Colors.textSecondary}
        multiline={multiline}
        style={[styles.input, multiline && { minHeight: 90, textAlignVertical: 'top', paddingTop: 14 }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bgPrimary },
  header: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.md },
  title: { color: Colors.textPrimary, fontSize: 32, fontWeight: '800', letterSpacing: -0.8 },
  sub: { color: Colors.textSecondary, fontSize: 14, marginTop: 4 },
  steps: { flexDirection: 'row', gap: 6, marginTop: 14 },
  stepBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.1)' },
  stepBarActive: { backgroundColor: Colors.brandPrimary },
  label: { color: Colors.textPrimary, fontSize: 14, fontWeight: '600', marginBottom: 8 },
  help: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  input: {
    color: '#fff', backgroundColor: Colors.inputBg,
    borderWidth: 1, borderColor: Colors.borderDefault,
    borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15,
  },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: Colors.inputBg, borderRadius: Radius.pill,
    borderWidth: 1, borderColor: Colors.borderDefault,
  },
  chipActive: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  chipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '500' },
  chipTextActive: { color: '#fff' },
  avatarPreview: {
    aspectRatio: 1, borderRadius: Radius.lg, overflow: 'hidden',
    backgroundColor: Colors.bgSecondary, borderWidth: 1, borderColor: Colors.borderSubtle,
    alignItems: 'center', justifyContent: 'center',
  },
  previewImg: { width: '100%', height: '100%' },
  previewLoading: { alignItems: 'center', gap: 12 },
  previewPlaceholder: { alignItems: 'center', gap: 12 },
  previewLoadingText: { color: Colors.textSecondary, fontSize: 13 },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: Spacing.lg, paddingTop: 14, paddingBottom: Platform.OS === 'ios' ? 100 : 90,
    backgroundColor: Colors.bgPrimary,
    borderTopWidth: 1, borderTopColor: Colors.borderSubtle,
    flexDirection: 'row', alignItems: 'center',
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 10 },
  backBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
