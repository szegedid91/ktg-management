// Fotó választás/készítés + feltöltés privát tárolóba (feladat-bizonylatok).

import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';
import { newId } from './repo';

export interface PickedPhoto { uri: string; base64: string }

export async function pickPhoto(fromCamera: boolean): Promise<PickedPhoto | null> {
  const list = await pickPhotos(fromCamera, 1);
  return list[0] ?? null;
}

/** Több kép egyszerre: galériából többes kijelölés, kameráról egy. */
export async function pickPhotos(fromCamera: boolean, limit = 10): Promise<PickedPhoto[]> {
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7, base64: true };
  const res = fromCamera
    ? await ImagePicker.launchCameraAsync(opts)
    : await ImagePicker.launchImageLibraryAsync({ ...opts, allowsMultipleSelection: limit > 1, selectionLimit: limit });
  if (res.canceled) return [];
  return (res.assets ?? []).filter((a) => !!a.base64).map((a) => ({ uri: a.uri, base64: a.base64! }));
}

/** Feltöltés a 'tasks' bucketbe; a visszaadott útvonal kerül az adatbázisba. */
export async function uploadTaskPhoto(base64: string, folder: string): Promise<string> {
  const path = `${folder}/${newId()}.jpg`;
  const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const { error } = await supabase.storage.from('tasks').upload(path, bin.buffer as ArrayBuffer, { contentType: 'image/jpeg' });
  if (error) throw error;
  return path;
}

export async function taskPhotoUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('tasks').createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

/** Fájlok törlése a tárolóból — a tétel törlésekor hívjuk; hiba esetén
 *  (offline, jog) csendben továbbmegy, a rekord törlése attól még megtörténik. */
export async function removeStoragePaths(bucket: 'tasks' | 'receipts' | 'equipment', paths: (string | null | undefined)[]): Promise<void> {
  const list = paths.filter((p): p is string => !!p);
  if (list.length === 0) return;
  try { await supabase.storage.from(bucket).remove(list); } catch { /* best effort */ }
}
