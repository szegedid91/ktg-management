// Fotó választás/készítés + feltöltés privát tárolóba (feladat-bizonylatok).

import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';
import { newId } from './repo';

export interface PickedPhoto { uri: string; base64: string }

export async function pickPhoto(fromCamera: boolean): Promise<PickedPhoto | null> {
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7, base64: true };
  const res = fromCamera
    ? await ImagePicker.launchCameraAsync(opts)
    : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled || !res.assets?.[0]?.base64) return null;
  return { uri: res.assets[0].uri, base64: res.assets[0].base64 };
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
