import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Colors, Radius, Spacing } from '@/src/theme/colors';
import { Button } from '@/src/components/Button';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/context/auth';

const GENDERS = ['Female', 'Male', 'Non-binary', 'Other', 'Prefer not to say'];

export default function PersonaScreen() {
  const router = useRouter();
  const { user, refresh } = useAuth();
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const p = user?.persona || {};
    setName(p.name || '');
    setAge(p.age || '');
    setGender(p.gender || '');
    setBio(p.bio || '');
  }, [user]);

  const save = async () => {
    try {
      setSaving(true);
      await api('/auth/me/persona', {
        method: 'PATCH',
        body: { name, age, gender, bio },
      });
      await refresh();
      router.back();
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Try again');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} testID="persona-screen">
      <View style={styles.topBar}>
        <Pressable testID="persona-back" hitSlop={12} style={styles.iconBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.title}>Your Persona</Text>
        <View style={{ width: 40 }} />
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.intro}>
            Tell your AI companions who you are. They&apos;ll naturally refer to you by name and weave these details into roleplay.
          </Text>

          <Field label="What should they call you?" value={name} onChange={setName} placeholder="e.g. Alex" testID="persona-name" />
          <Field label="Age (optional)" value={age} onChange={setAge} placeholder="e.g. 24" keyboardType="numeric" testID="persona-age" />

          <Text style={styles.label}>Gender (optional)</Text>
          <View style={styles.chipsRow}>
            {GENDERS.map((g) => {
              const active = gender === g;
              return (
                <Pressable
                  key={g}
                  testID={`persona-gender-${g}`}
                  onPress={() => setGender(active ? '' : g)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{g}</Text>
                </Pressable>
              );
            })}
          </View>

          <Field
            label="A bit about you (optional)"
            value={bio}
            onChange={setBio}
            placeholder="What should the AI know about you? Hobbies, vibe, current mood…"
            multiline
            testID="persona-bio"
          />

          <View style={{ marginTop: Spacing.xl }}>
            <Button
              testID="persona-save-btn"
              label="Save Persona"
              onPress={save}
              loading={saving}
              icon={<Ionicons name="checkmark" size={18} color="#fff" />}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChange, placeholder, multiline, keyboardType, testID }: any) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={Colors.textSecondary}
        multiline={multiline}
        keyboardType={keyboardType}
        style={[styles.input, multiline && { minHeight: 100, textAlignVertical: 'top', paddingTop: 12 }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bgPrimary },
  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 10, gap: 8,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  intro: { color: Colors.textSecondary, fontSize: 14, lineHeight: 21, marginBottom: Spacing.lg },
  label: { color: Colors.textPrimary, fontSize: 14, fontWeight: '600', marginBottom: 8 },
  input: {
    color: '#fff', backgroundColor: Colors.inputBg,
    borderWidth: 1, borderColor: Colors.borderDefault,
    borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15,
  },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: Spacing.md },
  chip: {
    paddingHorizontal: 14, paddingVertical: 9,
    backgroundColor: Colors.inputBg, borderRadius: Radius.pill,
    borderWidth: 1, borderColor: Colors.borderDefault,
  },
  chipActive: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  chipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '500' },
  chipTextActive: { color: '#fff' },
});
