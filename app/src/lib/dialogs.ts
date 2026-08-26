// Platformfüggetlen dialógusok. A react-native-web Alert-je ÜRES
// függvény (no-op), a natív window.confirm-ot pedig egyes beágyazott
// böngészők elnyelik — ezért saját, appon belüli ablakot használunk
// (DialogHost, a gyökér layoutban). Ha az még nincs felcsatolva,
// visszaesünk a platform natív megoldására.

import { Alert, Platform } from 'react-native';

export type DialogRequest = {
  title: string;
  message: string;
  okLabel: string;
  destructive: boolean;
  alertOnly: boolean;
  resolve: (ok: boolean) => void;
};

let host: ((r: DialogRequest) => void) | null = null;

/** A DialogHost hívja mountoláskor; a visszaadott függvény leiratkozik. */
export function registerDialogHost(fn: (r: DialogRequest) => void): () => void {
  host = fn;
  return () => {
    if (host === fn) host = null;
  };
}

export function notify(title: string, message?: string): void {
  if (host) {
    host({ title, message: message ?? '', okLabel: 'OK', destructive: false, alertOnly: true, resolve: () => {} });
  } else if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    window.alert(message ? `${title}\n\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
}

export function confirmDialog(
  title: string,
  message: string,
  okLabel = 'OK',
  destructive = false,
): Promise<boolean> {
  if (host) {
    return new Promise((resolve) => {
      host!({ title, message, okLabel, destructive, alertOnly: false, resolve });
    });
  }
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Mégse', style: 'cancel', onPress: () => resolve(false) },
      { text: okLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ]);
  });
}
