/**
 * Barre de recherche globale (barre supérieure) avec suggestions réelles
 * issues du catalogue — aucun résultat inventé.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { FeatureCard } from '@teralynk/shared';
import { suggestQueries } from '@/lib/search';
import { IconSearch } from '@/components/Icons';

interface Props {
  value: string;
  onChange: (value: string) => void;
  cards: FeatureCard[];
  onPickSuggestion: (query: string) => void;
}

export function GlobalSearch({ value, onChange, cards, onPickSuggestion }: Props) {
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => (focused && value.trim() ? suggestQueries(cards, value) : []), [focused, value, cards]);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setFocused(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Raccourci clavier global : Ctrl+K / Cmd+K → focus recherche.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        containerRef.current?.querySelector('input')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div className="tl-search">
        <IconSearch size={16} />
        <input
          type="text"
          placeholder="Rechercher une fonctionnalité, un script, un outil…"
          value={value}
          aria-label="Rechercher dans le catalogue"
          onChange={(event) => {
            onChange(event.target.value);
            setActiveIndex(-1);
          }}
          onFocus={() => setFocused(true)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((i) => Math.max(i - 1, -1));
            } else if (event.key === 'Enter' && activeIndex >= 0 && suggestions[activeIndex]) {
              onPickSuggestion(suggestions[activeIndex]);
              setFocused(false);
            } else if (event.key === 'Escape') {
              setFocused(false);
            }
          }}
        />
        {value ? (
          <button className="tl-btn tl-btn-icon" style={{ padding: 3 }} aria-label="Effacer" onClick={() => onChange('')}>
            ✕
          </button>
        ) : (
          <span className="tl-search-kbd">Ctrl K</span>
        )}
      </div>

      <AnimatePresence>
        {suggestions.length > 0 && (
          <motion.div
            className="tl-suggest"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            {suggestions.map((suggestion, index) => (
              <div
                key={suggestion}
                className={`tl-suggest-item ${index === activeIndex ? 'is-active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  onPickSuggestion(suggestion);
                  setFocused(false);
                }}
              >
                <IconSearch size={13} />
                {suggestion}
                <small>rechercher</small>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
