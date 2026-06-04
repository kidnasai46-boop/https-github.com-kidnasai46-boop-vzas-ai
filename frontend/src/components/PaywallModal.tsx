/**
 * Paywall modal shown when a user hits a free-tier limit.
 *
 * Two variants:
 *   - kind="nsfw": lifetime 5-message NSFW cap reached.
 *   - kind="sfw_daily": daily 50-message SFW cap reached.
 *
 * The "Subscribe" CTA is a placeholder until Stripe is wired up — pressing
 * it shows a short "Subscriptions coming soon" alert.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable, Modal, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Spacing } from '@/src/theme/colors';

export type PaywallKind = 'nsfw' | 'sfw_daily' | 'image_premium';

interface Props {
  visible: boolean;
  kind: PaywallKind;
  used?: number;
  limit?: number;
  onClose: () => void;
}

export function PaywallModal({ visible, kind, used, limit, onClose }: Props) {
  const isNsfw = kind === 'nsfw';
  const isImage = kind === 'image_premium';
  const title = isImage
    ? 'In-chat photos are a premium feature'
    : isNsfw
      ? 'Adult chats are subscriber-only'
      : 'You hit today’s free limit';
  const body = isImage
    ? 'Subscribe to let your characters send you photos during chats. Generated on the fly and matched to the current scene — only for subscribers.'
    : isNsfw
      ? `You’ve used all ${limit ?? 5} of your free explicit messages. Subscribe to keep going with the spicy characters — unlimited NSFW chats, no waiting.`
      : `You’ve used all ${limit ?? 50} free messages today. The counter resets at midnight UTC. Or subscribe for unlimited messages, every day.`;
  const accentColors: [string, string] = isImage
    ? ['rgba(236,72,153,0.65)', 'rgba(124,58,237,0.45)']
    : isNsfw
      ? ['rgba(239,68,68,0.65)', 'rgba(124,58,237,0.45)']
      : ['rgba(124,58,237,0.65)', 'rgba(6,182,212,0.45)'];

  const onSubscribe = () => {
    Alert.alert(
      'Subscriptions coming soon',
      'Stripe checkout is being wired up. You’ll be the first to know when it goes live.',
      [{ text: 'Got it' }],
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <LinearGradient
            colors={accentColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.banner}
          >
            <Ionicons name={isNsfw ? 'flame' : 'time-outline'} size={28} color="#fff" />
          </LinearGradient>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>

          {used !== undefined && limit !== undefined && (
            <View style={styles.usageRow}>
              <Text style={styles.usageText}>
                Used {Math.min(used, limit)} / {limit}
                {isNsfw ? ' lifetime' : ' today'}
              </Text>
            </View>
          )}

          <Pressable
            testID="paywall-subscribe-btn"
            onPress={onSubscribe}
            style={styles.btnPrimary}
          >
            <Ionicons name="sparkles" size={18} color="#fff" />
            <Text style={styles.btnPrimaryText}>Subscribe — Coming soon</Text>
          </Pressable>

          <Pressable testID="paywall-close-btn" onPress={onClose} style={styles.btnSecondary}>
            <Text style={styles.btnSecondaryText}>
              {isImage || isNsfw ? 'Maybe later' : 'Come back tomorrow'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: Colors.bgSecondary,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    overflow: 'hidden',
    alignItems: 'center',
    gap: 14,
  },
  banner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  body: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  usageRow: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
  },
  usageText: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  btnPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    paddingVertical: 14,
    borderRadius: Radius.pill,
    backgroundColor: Colors.brandPrimary,
    marginTop: 8,
  },
  btnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnSecondary: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  btnSecondaryText: { color: Colors.textSecondary, fontSize: 14 },
});
