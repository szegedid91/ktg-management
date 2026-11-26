// Fájl kiválasztása feltöltéshez (pl. a javított elszámolás-Excel). Weben a böngésző fájlválasztója;
// a natív appban egyelőre nincs ilyen választó — ott üzenetet adunk.
import { Platform } from 'react-native';
import { notify } from './dialogs';

export interface PickedFile { name: string; base64: string; size: number }

export async function pickFile(accept: string): Promise<PickedFile | null> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') {
    notify('Csak böngészőben', 'A fájl feltöltése a böngészős (webes) appból megy — ott nyisd meg az Exportálás oldalt.');
    return null;
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.style.display = 'none';
    let done = false;
    const finish = (v: PickedFile | null) => { if (done) return; done = true; input.remove(); resolve(v); };
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return finish(null);
      const reader = new FileReader();
      reader.onload = () => finish({ name: file.name, size: file.size, base64: String(reader.result ?? '').split(',')[1] ?? '' });
      reader.onerror = () => finish(null);
      reader.readAsDataURL(file);
    };
    // ha a választót mégse-vel zárják, a change nem jön — egy fókusz-visszatérés után feladjuk
    window.addEventListener('focus', () => setTimeout(() => { if (!input.files?.length) finish(null); }, 1000), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}
