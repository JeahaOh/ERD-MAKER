import { useCallback, useRef, useState } from 'react';
import type { Model } from '../../core/model';
export function useModelHistory(initial: () => Model) {
  const [model, setModel] = useState(initial);
  const current = useRef(model); const past = useRef<Model[]>([]); const future = useRef<Model[]>([]);
  const [revision, setRevision] = useState(0);
  const commit = useCallback((update: Model | ((model: Model) => Model)) => {
    const next = typeof update === 'function' ? update(current.current) : update;
    if (JSON.stringify(next) === JSON.stringify(current.current)) return;
    past.current = [...past.current.slice(-99), current.current]; future.current = [];
    current.current = next; setModel(next); setRevision(r => r + 1);
  }, []);
  const undo = useCallback(() => {
    const previous = past.current.pop(); if (!previous) return;
    future.current.push(current.current); current.current = previous; setModel(previous); setRevision(r => r + 1);
  }, []);
  const redo = useCallback(() => {
    const next = future.current.pop(); if (!next) return;
    past.current.push(current.current); current.current = next; setModel(next); setRevision(r => r + 1);
  }, []);
  return { model, commit, undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0, revision };
}
