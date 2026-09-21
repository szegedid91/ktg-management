// Háttérbeli területfigyelés — csak natív appban létezik (geofence.native.ts).
// Weben a böngésző nem ad háttér-helyzetet, ezért itt minden hívás üres.

import type { Site } from './types';

export type OpenSessionInfo = { sessionId: string; siteId: string | null; startedAt: string } | null;
export type PendingExit = { siteId: string; siteName: string; at: string } | null;

export const backgroundGeoAvailable = false;
export async function backgroundGeoStatus(): Promise<'unsupported' | 'off' | 'foreground-only' | 'on'> { return 'unsupported'; }
export async function enableBackgroundGeo(): Promise<boolean> { return false; }
export async function syncGeofences(_sites: Site[]): Promise<void> { /* web: nincs */ }
export async function rememberOpenSession(_s: OpenSessionInfo): Promise<void> { /* web: nincs */ }
export async function takePendingExit(): Promise<PendingExit> { return null; }
export async function stopGeofences(): Promise<void> { /* web: nincs */ }
