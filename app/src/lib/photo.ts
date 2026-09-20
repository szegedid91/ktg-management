// Fotó választás/készítés + feltöltés privát tárolóba (feladat-bizonylatok).

import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';
import { newId } from './repo';

export interface PickedPhoto { uri: string; base64: string }

/** Feltöltés előtti kicsinyítés weben. A böngészős képválasztó figyelmen
 *  kívül hagyja a `quality` beállítást, így a telefon teljes felbontású
 *  (3–5 MB-os) képe menne fel. Itt a hosszabbik oldalt legfeljebb MAX_SIDE
 *  képpontra vesszük és JPEG-be tömörítjük (~200–400 KB): a számla és a
 *  munkafotó így is jól olvasható, a tárhely pedig kb. tizedannyi.
 *  Hiba esetén (pl. nem támogatott formátum) az eredeti kép megy tovább. */
const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.72;
export async function compressPhoto(photo: PickedPhoto): Promise<PickedPhoto> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return photo; // natív: a picker maga tömörít
  try {
    const src = photo.uri?.startsWith('data:') || photo.uri?.startsWith('blob:') ? photo.uri : `data:image/jpeg;base64,${photo.base64}`;
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('kép betöltése'));
      el.src = src;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return photo;
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    // csak akkor cserélünk, ha tényleg kisebb lett
    if (!base64 || base64.length >= photo.base64.length) return photo;
    return { uri: dataUrl, base64 };
  } catch {
    return photo;
  }
}

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
  const picked = (res.assets ?? []).filter((a) => !!a.base64).map((a) => ({ uri: a.uri, base64: a.base64! }));
  return Promise.all(picked.map(compressPhoto));
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
