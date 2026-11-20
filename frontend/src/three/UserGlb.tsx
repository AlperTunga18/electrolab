import { useEffect, useState, type ReactNode } from 'react';
import { Box3, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ComponentDef } from '../library/types';
import { loadModel } from '../core/model3d/store';
import { normalizeBox } from '../core/model3d/normalize';

interface Loaded { scene: Object3D; scale: number; offset: [number, number, number] }

/** Renders the user's local GLB/glTF scaled/centred into def.size; shows `fallback` while loading or if it fails. */
export function UserGlb({ def, fallback }: { def: ComponentDef; fallback: ReactNode }) {
  const [m, setM] = useState<Loaded | null>(null);
  const id = def.model3d?.id;
  const { w, d, h } = def.size;
  useEffect(() => {
    if (!id) return;
    let dead = false;
    let url = '';
    void (async () => {
      try {
        const blob = await loadModel(id);
        if (!blob || dead) return;
        url = URL.createObjectURL(blob);
        const gltf = await new GLTFLoader().loadAsync(url);
        const box = new Box3().setFromObject(gltf.scene);
        const n = normalizeBox(box.min.toArray() as [number, number, number], box.max.toArray() as [number, number, number], { w, d, h });
        if (n && !dead) setM({ scene: gltf.scene, ...n });
      } catch { /* keep fallback */ } finally { if (url) URL.revokeObjectURL(url); }
    })();
    return () => { dead = true; };
  }, [id, w, d, h]);
  if (!m) return <>{fallback}</>;
  return <group position={m.offset} scale={m.scale}><primitive object={m.scene.clone(true)} /></group>;
}
