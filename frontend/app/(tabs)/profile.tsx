import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Image, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';

import { Colors, Radius, Spacing } from '@/src/theme/colors';
import { useAuth } from '@/src/context/auth';
import { api } from '@/src/api/client';

interface MyChar { id: string; name: string; avatar: string; tagline: string; }

export default function Profile() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [mine, setMine] = useState<MyChar[]>([]);

  const load = useCallback(async () => {
    try {
      const data = await api<{ characters: MyChar[] }>('/characters/mine');
      setMine(data.characters);
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const doSignOut = () => {
    Alert.alert('Sign out?', 'You can sign back in anytime.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => { await signOut(); router.replace('/login'); } },
    ]);
  };

  if (!user) return null;

  const persona = user.persona || {};
  const hasPersona = !!persona.name;

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="profile-screen">
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={styles.header}>
          {user.picture ? (
            <Image source={{ uri: user.picture }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitial}>{user.name[0]?.toUpperCase()}</Text>
            </View>
          )}
          <Text style={styles.name} testID="profile-name">{user.name}</Text>
          <Text style={styles.email}>{user.email}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Persona</Text>
          <Pressable
            testID="profile-persona-btn"
            style={styles.personaCard}
            onPress={() => router.push('/persona')}
          >
            <View style={styles.personaIcon}>
              <Ionicons name="person-circle" size={28} color={Colors.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.personaTitle}>
                {hasPersona ? persona.name : 'Set up your persona'}
              </Text>
              <Text style={styles.personaSub} numberOfLines={2}>
                {hasPersona
                  ? (persona.bio || 'Tap to edit your details.')
                  : 'Tell your AI companions who they\'re talking to.'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.textSecondary} />
          </Pressable>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>My Characters</Text>
            <Pressable testID="profile-create-link" onPress={() => router.push('/(tabs)/create')}>
              <Text style={styles.link}>+ New</Text>
            </Pressable>
          </View>
          {mine.length === 0 ? (
            <Text style={styles.empty}>You haven&apos;t created any characters yet.</Text>
          ) : (
            <View style={{ gap: 10 }}>
              {mine.map((c) => (
                <Pressable
                  key={c.id}
                  testID={`my-char-${c.id}`}
                  style={styles.row}
                  onPress={() => router.push(`/character/${c.id}`)}
                >
                  <Image source={{ uri: c.avatar }} style={styles.charAvatar} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.charName}>{c.name}</Text>
                    <Text style={styles.charTag} numberOfLines={1}>{c.tagline}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={Colors.textSecondary} />
                </Pressable>
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <Pressable testID="profile-signout-btn" style={styles.actionRow} onPress={doSignOut}>
            <Ionicons name="log-out-outline" size={22} color={Colors.error} />
            <Text style={[styles.actionText, { color: Colors.error }]}>Sign out</Text>
          </Pressable>
        </View>

        <Text style={styles.version}>VZAS.AI · v0.1.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bgPrimary },
  header: { alignItems: 'center', paddingTop: Spacing.lg, paddingBottom: Spacing.xl },
  avatar: { width: 96, height: 96, borderRadius: 48, marginBottom: Spacing.md, borderWidth: 2, borderColor: Colors.brandPrimary },
  avatarFallback: { backgroundColor: Colors.bgSecondary, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: '#fff', fontSize: 36, fontWeight: '700' },
  name: { color: Colors.textPrimary, fontSize: 22, fontWeight: '700' },
  email: { color: Colors.textSecondary, fontSize: 14, marginTop: 4 },
  section: { paddingHorizontal: Spacing.lg, marginTop: Spacing.lg },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { color: Colors.textPrimary, fontSize: 18, fontWeight: '700' },
  link: { color: Colors.brandSecondary, fontSize: 14, fontWeight: '600' },
  empty: { color: Colors.textSecondary, fontSize: 14, paddingVertical: 18, textAlign: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.bgSecondary, padding: 12,
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle,
  },
  charAvatar: { width: 48, height: 48, borderRadius: 24 },
  charName: { color: Colors.textPrimary, fontWeight: '700' },
  charTag: { color: Colors.textSecondary, fontSize: 13, marginTop: 2 },
  actionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: Colors.bgSecondary, padding: 16,
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle,
  },
  actionText: { fontSize: 15, fontWeight: '600' },
  version: { color: Colors.textSecondary, textAlign: 'center', marginTop: 32, fontSize: 12 },
  personaCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.bgSecondary, padding: 14, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.borderSubtle,
  },
  personaIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(124,58,237,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  personaTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  personaSub: { color: Colors.textSecondary, fontSize: 12, marginTop: 4, lineHeight: 16 },
});
