// QR-kód beolvasó. Weben a hátsó kamera képét egy <video>-ba tesszük és
// ~150 ms-onként jsQR-rel dekódoljuk; natívon (és ha nincs kamera) csak a
// kézi beírás marad. A kamerát a komponens lecsatolásakor leállítjuk.

import React, { useEffect, useRef, useState } from 'react';
import { View, Platform } from 'react-native';
import jsQR from 'jsqr';
import { Sub, Body, Btn, Input } from '../ui/kit';
import { C, S } from '../ui/theme';

const SCAN_INTERVAL_MS = 150;
const MAX_FRAME_W = 640; // ennél szélesebb képet lekicsinyítünk a dekódoláshoz

export function QrScanner({ onCode, onManual, onClose }: {
  /** kamerával beolvasott kód szövege */
  onCode: (text: string) => void;
  /** kézi beírás (eszköz neve vagy azonosítója) */
  onManual: (text: string) => void;
  onClose: () => void;
}) {
  const webCamera = Platform.OS === 'web' && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<'starting' | 'running' | 'error'>('starting');
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');

  useEffect(() => {
    if (!webCamera) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let done = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const tick = () => {
      const video = videoRef.current;
      if (done || !video || !ctx || video.readyState < 2 || !video.videoWidth) return;
      const scale = Math.min(1, MAX_FRAME_W / video.videoWidth);
      const w = Math.round(video.videoWidth * scale);
      const h = Math.round(video.videoHeight * scale);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      ctx.drawImage(video, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      const code = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
      if (code?.data) {
        done = true;
        onCode(code.data);
      }
    };

    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((s) => {
        if (done) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = s;
        video.play().catch(() => {});
        setStatus('running');
        timer = setInterval(tick, SCAN_INTERVAL_MS);
      })
      .catch((e: any) => {
        setStatus('error');
        const name = String(e?.name ?? '');
        setError(name === 'NotAllowedError'
          ? 'Nincs engedély a kamerához. Engedélyezd a böngésző címsorában, vagy írd be a nevet kézzel.'
          : name === 'NotFoundError'
            ? 'Nem található kamera ezen az eszközön.'
            : `A kamera nem indult el (${name || String(e?.message ?? e)}).`);
      });

    return () => {
      done = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webCamera]);

  const submitManual = () => {
    const t = manual.trim();
    if (!t) return;
    onManual(t);
  };

  return (
    <View style={{ gap: S.sm }}>
      {webCamera ? (
        <View style={{ borderRadius: S.radiusSm, overflow: 'hidden', backgroundColor: '#000', alignItems: 'center' }}>
          {/* natívon nem renderelődik: a webCamera csak weben igaz */}
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{ width: '100%', maxHeight: 360, objectFit: 'cover', display: 'block' }}
          />
        </View>
      ) : (
        <Sub>
          {Platform.OS === 'web'
            ? 'Ez a böngésző nem támogatja a kamerás beolvasást (https szükséges).'
            : 'A kamerás beolvasás a webes változatban érhető el — itt írd be a nevet vagy az azonosítót.'}
        </Sub>
      )}
      {webCamera && status === 'starting' ? <Sub>Kamera indítása… (engedélyt kérhet a böngésző)</Sub> : null}
      {webCamera && status === 'running' ? <Sub>Tartsd a QR-kódot a kamera elé.</Sub> : null}
      {status === 'error' && error ? <Body style={{ color: C.danger }}>{error}</Body> : null}

      <Input
        label="vagy írd be az eszköz nevét/azonosítóját"
        value={manual}
        onChangeText={setManual}
        placeholder="pl. Hilti fúró"
        autoCapitalize="none"
        right={<Btn title="Keres" small onPress={submitManual} disabled={!manual.trim()} />}
      />
      <Btn title="Bezár" kind="ghost" small onPress={onClose} />
    </View>
  );
}
