'use client';

import { useState, useCallback, useRef } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type LilyFormat = 'svg' | 'png';

export interface UseLilyPondOptions {
  /** URL du microservice. Défaut : variable d'env NEXT_PUBLIC_LILYPOND_URL */
  serviceUrl?: string;
  /** Format de sortie. Défaut : 'svg' */
  format?: LilyFormat;
}

export interface UseLilyPondResult {
  /** URL blob ou data-URI de l'image générée, null si pas encore rendu */
  imageUrl: string | null;
  /** En cours de compilation */
  loading: boolean;
  /** Message d'erreur, null si OK */
  error: string | null;
  /** Déclenche la compilation */
  render: (lyCode: string) => Promise<void>;
  /** Réinitialise l'état */
  reset: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useLilyPond(options: UseLilyPondOptions = {}): UseLilyPondResult {
  const {
    serviceUrl = process.env.NEXT_PUBLIC_LILYPOND_URL ?? 'http://localhost:3001',
    format     = 'svg',
  } = options;

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  // Nettoyer l'URL blob précédente pour éviter les fuites mémoire
  const prevBlobUrl = useRef<string | null>(null);

  const reset = useCallback(() => {
    if (prevBlobUrl.current) {
      URL.revokeObjectURL(prevBlobUrl.current);
      prevBlobUrl.current = null;
    }
    setImageUrl(null);
    setError(null);
    setLoading(false);
  }, []);

  const render = useCallback(async (lyCode: string) => {
    if (!lyCode.trim()) return;

    setLoading(true);
    setError(null);

    // Libérer l'ancienne URL blob
    if (prevBlobUrl.current) {
      URL.revokeObjectURL(prevBlobUrl.current);
      prevBlobUrl.current = null;
    }

    try {
      const res = await fetch(`${serviceUrl}/render`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code: lyCode, format }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Erreur réseau' }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      const blob = await res.blob();

      if (format === 'svg') {
        // SVG inline : lire comme texte et créer une data-URI
        const text   = await blob.text();
        const dataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
        setImageUrl(dataUri);
      } else {
        // PNG : URL blob
        const url = URL.createObjectURL(blob);
        prevBlobUrl.current = url;
        setImageUrl(url);
      }

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      setError(message);
      setImageUrl(null);
    } finally {
      setLoading(false);
    }
  }, [serviceUrl, format]);

  return { imageUrl, loading, error, render, reset };
}
