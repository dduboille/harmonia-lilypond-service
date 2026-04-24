'use client';

import { useEffect, useRef } from 'react';
import { useLilyPond } from './useLilyPond';

interface ScoreViewerProps {
  /** Code LilyPond complet à rendre */
  lyCode: string;
  /** Libellé accessible */
  label?: string;
  className?: string;
}

/**
 * Composant autonome : reçoit du code LilyPond, affiche la partition rendue.
 *
 * Usage dans Harmonia :
 * <ScoreViewer lyCode={myLyCode} label="Accord I–IV–V7–I en Do majeur" />
 */
export function ScoreViewer({ lyCode, label = 'Partition musicale', className = '' }: ScoreViewerProps) {
  const { imageUrl, loading, error, render, reset } = useLilyPond({ format: 'svg' });
  const prevCode = useRef<string>('');

  useEffect(() => {
    if (lyCode === prevCode.current) return;
    prevCode.current = lyCode;
    if (lyCode.trim()) render(lyCode);
    else reset();
  }, [lyCode, render, reset]);

  // ── Squelette de chargement ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={`score-viewer score-viewer--loading ${className}`} aria-busy="true">
        <div className="score-viewer__skeleton" aria-label="Compilation en cours…" />
      </div>
    );
  }

  // ── Erreur ───────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className={`score-viewer score-viewer--error ${className}`} role="alert">
        <p className="score-viewer__error-message">
          Erreur de rendu : {error}
        </p>
      </div>
    );
  }

  // ── Partition ────────────────────────────────────────────────────────────────
  if (imageUrl) {
    return (
      <div className={`score-viewer ${className}`}>
        <img
          src={imageUrl}
          alt={label}
          className="score-viewer__image"
          draggable={false}
        />
      </div>
    );
  }

  return null;
}
