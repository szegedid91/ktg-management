// Okos visszalépés: ha nincs navigációs előzmény (pl. közvetlen link
// vagy frissítés után), a Kezdőlapra megyünk a hibás GO_BACK helyett.

import { router } from 'expo-router';

export function smartBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
