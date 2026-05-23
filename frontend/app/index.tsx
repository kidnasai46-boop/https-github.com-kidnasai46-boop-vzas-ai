import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/context/auth';
import { Colors } from '@/src/theme/colors';
import { storage } from '@/src/utils/storage';

export default function Index() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    (async () => {
      if (user) {
        router.replace('/(tabs)');
        return;
      }
      const onboarded = await storage.getItem<boolean>('onboarded', false);
      if (!onboarded) {
        router.replace('/onboarding');
      } else {
        router.replace('/login');
      }
    })();
  }, [user, loading, router]);

  return (
    <View style={styles.container} testID="splash-screen">
      <ActivityIndicator color={Colors.brandPrimary} size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bgPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
