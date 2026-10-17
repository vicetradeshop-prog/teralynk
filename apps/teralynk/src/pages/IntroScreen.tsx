/**
 * Séquence d'introduction animée de Teralynk.
 *
 *  - Étape 1 : écran sombre, halos lumineux animés, profondeur.
 *  - Étape 2 : logo (apparition, échelle, reflet balayant, anneaux).
 *  - Étape 3 : nom de la marque + phrase de présentation (modifiable
 *              à distance via le manifeste de version — `tagline`).
 *  - Étape 4 : transition vers la vérification des mises à jour.
 *
 * La durée totale est ~2,6 s (mouvement normal) et peut être raccourcie
 * par « Passer » ou par la préférence skipIntro — mais le passage
 * n'esquive JAMAIS la vérification obligatoire des mises à jour :
 * il enchaîne directement sur l'écran de vérification.
 *
 * Aucune vidéo, aucun écran factice : les animations sont CSS/framer-motion,
 * et l'écran reste affiché le temps du travail réel (préchargement des prefs).
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { TeralynkMark } from '@/components/Icons';
import { Button } from '@/components/ui';
import { useSystemReducedMotion } from '@/hooks/useData';

/** Phrase de présentation par défaut ; peut être remplacée par le manifeste distant. */
export const DEFAULT_TAGLINE = 'Vos scripts et outils, réunis dans une expérience unique.';

interface Props {
  /** Appelée lorsque la séquence est terminée (ou passée) : enchaîne sur la vérification. */
  onFinished: () => void;
  skipIntro: boolean;
  reducedMotionSetting: 'system' | 'on' | 'off';
  tagline?: string;
}

export function IntroScreen({ onFinished, skipIntro, reducedMotionSetting, tagline }: Props) {
  const systemReduced = useSystemReducedMotion();
  const reduceMotion = reducedMotionSetting === 'on' || (reducedMotionSetting === 'system' && systemReduced);
  const [canSkip, setCanSkip] = useState(false);

  const totalMs = reduceMotion ? 400 : 2600;

  useEffect(() => {
    const skipTimer = setTimeout(() => setCanSkip(true), reduceMotion ? 100 : 1400);
    const endTimer = setTimeout(onFinished, totalMs);
    return () => {
      clearTimeout(skipTimer);
      clearTimeout(endTimer);
    };
    // onFinished est stable (useCallback côté parent)
  }, [onFinished, totalMs, reduceMotion]);

  // skipIntro : l'animation est réduite au minimum, mais on passe TOUJOURS
  // par l'écran de vérification ensuite (aucun contournement possible).
  useEffect(() => {
    if (skipIntro) {
      const fast = setTimeout(onFinished, reduceMotion ? 50 : 500);
      return () => clearTimeout(fast);
    }
  }, [skipIntro, onFinished, reduceMotion]);

  return (
    <div className="tl-boot">
      <div className="tl-boot-aura" aria-hidden>
        <span /><span /><span />
      </div>

      <div className="tl-boot-content">
        <motion.div
          className="tl-logo-wrap"
          initial={reduceMotion ? false : { scale: 0.82, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="tl-logo-ring" aria-hidden />
          <div className="tl-logo-ring" aria-hidden />
          <span className="tl-logo-orbit" aria-hidden><i /></span>
          <span className="tl-logo-orbit rev" aria-hidden><i /></span>
          <div className="tl-logo-core">
            <TeralynkMark size={52} />
          </div>
        </motion.div>

        <motion.h1
          className="tl-boot-name"
          initial={reduceMotion ? false : { opacity: 0, y: 14, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.8, delay: reduceMotion ? 0 : 0.55, ease: [0.22, 1, 0.36, 1] }}
        >
          Teralynk
        </motion.h1>

        <motion.p
          className="tl-boot-tagline"
          initial={reduceMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: reduceMotion ? 0 : 0.85 }}
        >
          {tagline ?? DEFAULT_TAGLINE}
        </motion.p>

        {canSkip && !skipIntro && (
          <motion.div
            className="tl-boot-skip"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
          >
            <Button variant="ghost" size="sm" onClick={onFinished}>
              Passer l’introduction
            </Button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
