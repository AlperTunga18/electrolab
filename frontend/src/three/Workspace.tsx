import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Grid, Html, Line, OrbitControls, QuadraticBezierLine } from '@react-three/drei';
import * as THREE from 'three';
import { useLab } from '../store/lab';
import { getDef } from '../library/components';
import { pinWorld, snap } from '../core/circuit/geometry';
import { marqueeSelect } from '../core/circuit/selection';
import { routeWire, type Box } from '../core/circuit/wireRoute';
import { formatSI } from '../core/units';
import type { PlacedComponent, Wire } from '../core/circuit/types';
import { ComponentModel } from './models';
import { thermalColor } from '../core/thermal/thermal';

/** Non-React bridge so DOM events (drag&drop, window pointer) can query the 3D scene. */
export const bridge: {
  toGround: (cx: number, cy: number) => [number, number] | null;
  cursor: [number, number];
  orbit: { enabled: boolean } | null;
  drag: { id: string; dx: number; dz: number; moved: boolean; /** plain click on a multi-selection member without dragging collapses to that part */ collapse?: boolean } | null;
  /** Shift+drag box selection on the ground plane (board x/z) */
  marquee: { x0: number; z0: number; x1: number; z1: number } | null;
} = { toGround: () => null, cursor: [0, 0], orbit: null, drag: null, marquee: null };

const PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/** pin click logic shared by the pin meshes and by component bodies that cover a pin (R3F gives the nearest hit to the body) */
function pinClick(ref: { comp: string; pin: string }): void {
  const s = useLab.getState();
  if (s.probeTarget) { s.setProbe(s.probeTarget, ref); s.set({ probeTarget: null }); return; }
  if (!s.pendingPin) s.setPendingPin(ref);
  else { if (s.pendingPin.comp !== ref.comp || s.pendingPin.pin !== ref.pin) s.addWire(s.pendingPin, ref); s.setPendingPin(null); }
}

function Bridge() {
  const { camera, gl, controls } = useThree();
  useEffect(() => {
    const rc = new THREE.Raycaster();
    const v = new THREE.Vector3();
    bridge.toGround = (cx, cy) => {
      const r = gl.domElement.getBoundingClientRect();
      rc.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
      return rc.ray.intersectPlane(PLANE, v) ? [v.x, v.z] : null;
    };
    bridge.orbit = controls as unknown as { enabled: boolean } | null;
    const move = (e: PointerEvent) => {
      const g = bridge.toGround(e.clientX, e.clientY);
      if (!g) return;
      bridge.cursor = g;
      if (bridge.marquee) { bridge.marquee.x1 = g[0]; bridge.marquee.z1 = g[1]; return; }
      const d = bridge.drag;
      if (!d) return;
      const s = useLab.getState();
      const nx = snap(g[0] + d.dx, s.grid), nz = snap(g[1] + d.dz, s.grid);
      const c = s.circuit.components.find((q) => q.id === d.id);
      if (!c || (c.x === nx && c.z === nz)) return;
      if (!d.moved) { d.moved = true; s.beginDrag(); }
      if (s.multi.includes(d.id)) s.moveMulti(d.id, nx, nz); else s.moveComponent(d.id, nx, nz);
    };
    const up = () => {
      const m = bridge.marquee;
      if (m) {
        bridge.marquee = null;
        if (Math.abs(m.x1 - m.x0) > 0.1 || Math.abs(m.z1 - m.z0) > 0.1) {
          const st = useLab.getState();
          st.setMulti(marqueeSelect(st.circuit.components, { x: m.x0, z: m.z0 }, { x: m.x1, z: m.z1 }));
        }
      }
      if (bridge.drag) {
        const d = bridge.drag;
        bridge.drag = null;
        useLab.setState({ dragging: false });
        if (!d.moved && d.collapse) useLab.getState().select({ kind: 'comp', id: d.id });
      }
      if (bridge.orbit) bridge.orbit.enabled = true;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [camera, gl, controls]);
  return null;
}

function PinMarker({ comp, pinId, label, x, z, y }: { comp: PlacedComponent; pinId: string; label: string; x: number; z: number; y: number }) {
  const mesh = useRef<THREE.Mesh>(null);
  const pending = useLab((s) => s.pendingPin);
  const probe = useLab((s) => (s.probes.red?.comp === comp.id && s.probes.red.pin === pinId ? 'red' : s.probes.black?.comp === comp.id && s.probes.black.pin === pinId ? 'black' : null));
  const isPending = pending?.comp === comp.id && pending.pin === pinId;
  const live = useLab((s) => s.live);
  const net = live?.pinNet.get(`${comp.id}:${pinId}`);
  const volt = live && net !== undefined ? live.netV[net] : undefined;
  return (
    <group position={[x, y, z]}>
      <mesh
        ref={mesh}
        userData={{ pin: { comp: comp.id, pin: pinId } }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'crosshair'; mesh.current?.scale.setScalar(1.5); }}
        onPointerOut={() => { document.body.style.cursor = ''; mesh.current?.scale.setScalar(1); }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          const s = useLab.getState();
          const ref = { comp: comp.id, pin: pinId };
          if (s.probeTarget) { s.setProbe(s.probeTarget, ref); s.set({ probeTarget: null }); return; }
          if (!s.pendingPin) s.setPendingPin(ref);
          else { if (s.pendingPin.comp !== ref.comp || s.pendingPin.pin !== ref.pin) s.addWire(s.pendingPin, ref); s.setPendingPin(null); }
        }}
      >
        <sphereGeometry args={[0.13, 12, 10]} />
        <meshStandardMaterial color={isPending ? '#22d3ee' : '#fbbf24'} emissive={isPending ? '#22d3ee' : '#f59e0b'} emissiveIntensity={isPending ? 1.2 : 0.35} metalness={0.8} roughness={0.3} />
      </mesh>
      {/* oversized invisible hit target */}
      <mesh
        userData={{ pin: { comp: comp.id, pin: pinId } }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'crosshair'; mesh.current?.scale.setScalar(1.5); }}
        onPointerOut={() => { document.body.style.cursor = ''; mesh.current?.scale.setScalar(1); }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          const s = useLab.getState();
          const ref = { comp: comp.id, pin: pinId };
          if (s.probeTarget) { s.setProbe(s.probeTarget, ref); s.set({ probeTarget: null }); return; }
          if (!s.pendingPin) s.setPendingPin(ref);
          else { if (s.pendingPin.comp !== ref.comp || s.pendingPin.pin !== ref.pin) s.addWire(s.pendingPin, ref); s.setPendingPin(null); }
        }}
      >
        <sphereGeometry args={[0.34, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {probe && (
        <group>
          <mesh position={[0, 0.9, 0]}><coneGeometry args={[0.18, 0.7, 12]} /><meshStandardMaterial color={probe === 'red' ? '#ef4444' : '#27272a'} emissive={probe === 'red' ? '#ef4444' : '#52525b'} emissiveIntensity={0.6} /></mesh>
          <mesh position={[0, 0.5, 0]} rotation={[Math.PI, 0, 0]}><cylinderGeometry args={[0.02, 0.02, 0.4, 6]} /><meshStandardMaterial color="#d4d4d8" /></mesh>
        </group>
      )}
      <Html position={[0, 0.3, 0]} center distanceFactor={14} style={{ pointerEvents: 'none' }} zIndexRange={[5, 0]}>
        <div className="text-[9px] leading-none text-amber-200/80 whitespace-nowrap select-none">
          {label}{volt !== undefined ? ` ${formatSI(volt, 'V', 3)}` : ''}
        </div>
      </Html>
    </group>
  );
}

function FailureFx({ h }: { h: number }) {
  const t0 = useRef(performance.now());
  const puffs = useRef<(THREE.Mesh | null)[]>([]);
  const flash = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);
  useFrame(() => {
    const t = (performance.now() - t0.current) / 1000;
    puffs.current.forEach((m, i) => {
      if (!m) return;
      const ph = (t * 0.6 + i / 8) % 1;
      m.position.set(Math.sin(i * 2.1 + t) * 0.3 * ph, h + ph * 3, Math.cos(i * 1.7 + t) * 0.3 * ph);
      m.scale.setScalar(0.15 + ph * 0.55);
      (m.material as THREE.MeshBasicMaterial).opacity = t < 25 ? (1 - ph) * 0.4 : 0;
    });
    if (flash.current) {
      const f = Math.max(0, 1 - t / 0.45);
      flash.current.scale.setScalar(0.5 + (1 - f) * 2.5);
      (flash.current.material as THREE.MeshBasicMaterial).opacity = f * 0.9;
    }
    if (light.current) light.current.intensity = t < 3 ? 7 * (0.6 + 0.4 * Math.random()) : 0;
  });
  return (
    <group>
      {Array.from({ length: 8 }, (_, i) => (
        <mesh key={i} ref={(m) => { puffs.current[i] = m; }}>
          <sphereGeometry args={[1, 8, 8]} />
          <meshBasicMaterial color="#52525b" transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
      <mesh ref={flash} position={[0, h * 0.5, 0]}>
        <sphereGeometry args={[1, 12, 10]} />
        <meshBasicMaterial color="#fbbf24" transparent opacity={0.9} depthWrite={false} />
      </mesh>
      <pointLight ref={light} position={[0, h, 0]} color="#fb923c" distance={8} intensity={0} />
    </group>
  );
}

function ComponentNode({ comp }: { comp: PlacedComponent }) {
  const def = getDef(comp.type);
  const selected = useLab((s) => (s.selection?.kind === 'comp' && s.selection.id === comp.id) || s.multi.includes(comp.id));
  const res = useLab((s) => s.live?.comps[comp.id]);
  const over = useLab((s) => s.live?.stress.some((x) => x.comp === comp.id) ?? false);
  const showLabels = useLab((s) => s.showLabels);
  const th = useLab((s) => s.live?.thermal[comp.id]);
  const thermalView = useLab((s) => s.thermalView);
  const amb = useLab((s) => s.circuit.ambient ?? 25);
  const failed = useLab((s) => s.live?.faults[comp.id]?.auto === true);
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(def.size.w + 0.3, def.size.h + 0.3, def.size.d + 0.3)), [def]);
  const glow = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (glow.current) (glow.current.material as THREE.MeshBasicMaterial).opacity = over ? 0.18 + 0.12 * Math.sin(clock.elapsedTime * 8) : 0;
  });

  const value = (() => {
    for (const k of ['r', 'c', 'l', 'v', 'vz', 'i']) {
      const p = def.params.find((q) => q.key === k);
      if (p) return formatSI(Number(comp.params[k]), p.unit);
    }
    if (comp.type === 'led') return String(comp.params.color);
    return def.mpn ?? '';
  })();

  return (
    <group position={[comp.x, 0, comp.z]} rotation={[0, (comp.rot * Math.PI) / 2, 0]}>
      <group
        onPointerDown={(e: ThreeEvent<PointerEvent>) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          const s = useLab.getState();
          if (s.armedType) return;
          const hitPin = e.intersections.find((i) => i.object.userData.pin);
          if (hitPin) { pinClick(hitPin.object.userData.pin as { comp: string; pin: string }); return; }
          if (s.pendingPin && s.pendingPin.comp !== comp.id) {
            // wiring in progress: clicking a part body connects to its nearest pin
            const hit = e.ray.intersectPlane(PLANE, new THREE.Vector3());
            if (hit) {
              const best = def.pins.map((q) => ({ q, p: pinWorld(comp, q.id) })).sort((u, v) => Math.hypot(u.p[0] - hit.x, u.p[2] - hit.z) - Math.hypot(v.p[0] - hit.x, v.p[2] - hit.z))[0];
              s.addWire(s.pendingPin, { comp: comp.id, pin: best.q.id });
              s.setPendingPin(null);
              return;
            }
          }
          if (e.shiftKey || e.ctrlKey || e.metaKey) { s.toggleMulti(comp.id); return; }
          const inMulti = s.multi.includes(comp.id);
          if (!inMulti) s.select({ kind: 'comp', id: comp.id });
          const g = e.ray.intersectPlane(PLANE, new THREE.Vector3());
          if (g) bridge.drag = { id: comp.id, dx: comp.x - g.x, dz: comp.z - g.z, moved: false, collapse: inMulti };
          if (bridge.orbit) bridge.orbit.enabled = false;
        }}
        onDoubleClick={(e) => { e.stopPropagation(); useLab.getState().toggleSwitch(comp.id); }}
      >
        <ComponentModel def={def} comp={comp} res={res} />
        <mesh position={[0, def.size.h / 2, 0]} visible={false}>
          <boxGeometry args={[def.size.w, def.size.h, def.size.d]} />
        </mesh>
      </group>
      {def.pins.map((p) => <PinMarker key={p.id} comp={comp} pinId={p.id} label={p.label} x={p.x} z={p.z} y={p.y} />)}
      {selected && <lineSegments geometry={edges} position={[0, def.size.h / 2, 0]}><lineBasicMaterial color="#22d3ee" /></lineSegments>}
      <mesh ref={glow} position={[0, def.size.h / 2, 0]}>
        <sphereGeometry args={[Math.max(def.size.w, def.size.h) * 0.7, 16, 12]} />
        <meshBasicMaterial color="#ef4444" transparent opacity={0} depthWrite={false} />
      </mesh>
      {thermalView && th && (
        <mesh position={[0, def.size.h / 2, 0]}>
          <boxGeometry args={[def.size.w + 0.25, def.size.h + 0.25, def.size.d + 0.25]} />
          <meshBasicMaterial color={thermalColor(th.T, amb, th.tjmax)} transparent opacity={0.75} depthWrite={false} />
        </mesh>
      )}
      {failed && (
        <>
          <mesh position={[0, def.size.h / 2, 0]}>
            <boxGeometry args={[def.size.w + 0.08, def.size.h + 0.08, def.size.d + 0.08]} />
            <meshBasicMaterial color="#0a0a0a" transparent opacity={0.72} depthWrite={false} />
          </mesh>
          <FailureFx h={def.size.h} />
        </>
      )}
      {thermalView && th && (
        <Html position={[0, def.size.h + 1.1, 0]} center distanceFactor={14} style={{ pointerEvents: 'none' }} zIndexRange={[7, 0]}>
          <div className="px-1 rounded bg-black/75 text-[10px] text-orange-200 whitespace-nowrap select-none">{th.T.toFixed(0)} °C</div>
        </Html>
      )}
      {showLabels && (
        <Html position={[0, def.size.h + 0.6, 0]} center distanceFactor={14} style={{ pointerEvents: 'none' }} zIndexRange={[4, 0]}>
          <div className="text-[10px] leading-tight text-center text-zinc-100 whitespace-nowrap select-none" style={{ textShadow: '0 0 3px #000' }}>
            <b>{comp.ref}</b> {value}
            {over && <div className="text-red-400 font-bold">⚠ sınır aşıldı</div>}
          </div>
        </Html>
      )}
    </group>
  );
}

const WIRE_PAD = 0.15;

/** footprint boxes (board plane) of every part except the given ones */
function footprints(comps: PlacedComponent[], skip: string[]): Box[] {
  return comps.filter((c) => !skip.includes(c.id)).map((c) => {
    const { w, d } = getDef(c.type).size;
    const [hw, hd] = (c.rot & 1 ? [d, w] : [w, d]).map((v) => v / 2 + WIRE_PAD);
    return { minX: c.x - hw, maxX: c.x + hw, minZ: c.z - hd, maxZ: c.z + hd };
  });
}

function WireNode({ wire, tag }: { wire: Wire; tag: string | null }) {
  const circuit = useLab((s) => s.circuit);
  const autoRoute = useLab((s) => s.autoRoute);
  const grid = useLab((s) => s.grid);
  const selected = useLab((s) => s.selection?.kind === 'wire' && s.selection.id === wire.id);
  const a = circuit.components.find((c) => c.id === wire.a.comp);
  const b = circuit.components.find((c) => c.id === wire.b.comp);
  const pa = a ? pinWorld(a, wire.a.pin) : [0, 0, 0] as [number, number, number];
  const pb = b ? pinWorld(b, wire.b.pin) : [0, 0, 0] as [number, number, number];
  const route = useMemo(() => {
    if (!autoRoute || !a || !b) return null;
    const pts = routeWire({ x: pa[0], z: pa[2] }, { x: pb[0], z: pb[2] }, footprints(circuit.components, [a.id, b.id]), grid > 0 ? grid : 0.5);
    const y = Math.max(pa[1], pb[1], 0.2) + 0.1;
    return pts.map((p, i): [number, number, number] => (i === 0 ? [pa[0], pa[1], pa[2]] : i === pts.length - 1 ? [pb[0], pb[1], pb[2]] : [p.x, y, p.z]));
  }, [autoRoute, a, b, circuit.components, grid, pa[0], pa[1], pa[2], pb[0], pb[1], pb[2]]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!a || !b) return null;
  const dist = Math.hypot(pa[0] - pb[0], pa[2] - pb[2]);
  const lift = 0.5 + 0.1 * dist;
  const mid: [number, number, number] = route ? route[Math.floor((route.length - 1) / 2)] : [(pa[0] + pb[0]) / 2, Math.max(pa[1], pb[1]) + lift, (pa[2] + pb[2]) / 2];
  const handlers = {
    onPointerDown: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); useLab.getState().select({ kind: 'wire', id: wire.id }); },
    onPointerOver: () => { document.body.style.cursor = 'pointer'; },
    onPointerOut: () => { document.body.style.cursor = ''; },
  };
  const color = selected ? '#ffffff' : wire.color;
  const lineWidth = selected ? wire.width + 2 : wire.width;
  return (
    <group>
      {route
        ? <Line points={route} color={color} lineWidth={lineWidth} {...handlers} />
        : <QuadraticBezierLine start={pa} end={pb} mid={mid} color={color} lineWidth={lineWidth} {...handlers} />}
      {tag && (
        <Html position={[mid[0], mid[1] + 0.15, mid[2]]} center distanceFactor={14} style={{ pointerEvents: 'none' }} zIndexRange={[6, 0]}>
          <div className="px-1 rounded bg-black/70 border border-cyan-500/40 text-[10px] text-cyan-200 whitespace-nowrap select-none">{tag}</div>
        </Html>
      )}
    </group>
  );
}

function Wires() {
  const wires = useLab((s) => s.circuit.wires);
  const live = useLab((s) => s.live);
  const showV = useLab((s) => s.showVoltage);
  const tags = useMemo(() => {
    const m = new Map<string, string | null>();
    const seen = new Set<number>();
    for (const w of wires) {
      let t: string | null = null;
      if (showV && live) {
        const n = live.pinNet.get(`${w.a.comp}:${w.a.pin}`);
        if (n !== undefined && !seen.has(n)) { seen.add(n); t = formatSI(live.netV[n], 'V', 3); }
      }
      m.set(w.id, t);
    }
    return m;
  }, [wires, live, showV]);
  return <>{wires.map((w) => <WireNode key={w.id} wire={w} tag={tags.get(w.id) ?? null} />)}</>;
}

function PendingWire() {
  const pending = useLab((s) => s.pendingPin);
  const comp = useLab((s) => (pending ? s.circuit.components.find((c) => c.id === pending.comp) : undefined));
  const ref = useRef<{ geometry: { setPositions: (a: number[]) => void } } | null>(null);
  useFrame(() => {
    if (!pending || !comp || !ref.current) return;
    const p = pinWorld(comp, pending.pin);
    ref.current.geometry.setPositions([p[0], p[1], p[2], bridge.cursor[0], 0.2, bridge.cursor[1]]);
  });
  if (!pending || !comp) return null;
  const p = pinWorld(comp, pending.pin);
  return <Line ref={ref as never} points={[p, [p[0] + 0.01, 0.2, p[2]]]} color="#22d3ee" lineWidth={2} dashed dashSize={0.2} gapSize={0.12} />;
}

function MarqueeRect() {
  const mesh = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const m = bridge.marquee;
    if (!mesh.current) return;
    mesh.current.visible = !!m;
    if (!m) return;
    mesh.current.position.set((m.x0 + m.x1) / 2, 0.06, (m.z0 + m.z1) / 2);
    mesh.current.scale.set(Math.max(Math.abs(m.x1 - m.x0), 0.001), Math.max(Math.abs(m.z1 - m.z0), 0.001), 1);
  });
  return (
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial color="#22d3ee" transparent opacity={0.22} depthWrite={false} />
    </mesh>
  );
}

function PlacementRing() {
  const armed = useLab((s) => s.armedType);
  const grid = useLab((s) => s.grid);
  const ring = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (!ring.current) return;
    ring.current.position.set(snap(bridge.cursor[0], grid), 0.05, snap(bridge.cursor[1], grid));
  });
  if (!armed) return null;
  return (
    <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.5, 0.65, 32]} />
      <meshBasicMaterial color="#22d3ee" transparent opacity={0.8} />
    </mesh>
  );
}

function Scene() {
  const comps = useLab((s) => s.circuit.components);
  return (
    <>
      <color attach="background" args={['#0a0e13']} />
      <ambientLight intensity={0.65} />
      <directionalLight position={[10, 18, 8]} intensity={1.5} castShadow />
      <hemisphereLight args={['#9bbcff', '#1b1f24', 0.4]} />
      <mesh position={[0, -0.06, 0]} receiveShadow>
        <boxGeometry args={[60, 0.1, 40]} />
        <meshStandardMaterial color="#10261d" roughness={0.85} />
      </mesh>
      <Grid position={[0, 0.002, 0]} args={[60, 40]} cellSize={0.5} cellThickness={0.5} cellColor="#1f4d3a" sectionSize={2.5} sectionThickness={1} sectionColor="#2f7d5a" fadeDistance={45} fadeStrength={1.5} infiniteGrid={false} />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const s = useLab.getState();
          if (s.armedType) {
            s.addComponent(s.armedType, snap(e.point.x, s.grid), snap(e.point.z, s.grid));
            if (!e.shiftKey) s.arm(null);
          } else if (e.shiftKey) {
            bridge.marquee = { x0: e.point.x, z0: e.point.z, x1: e.point.x, z1: e.point.z };
            if (bridge.orbit) bridge.orbit.enabled = false;
          } else {
            s.select(null);
            s.setPendingPin(null);
          }
        }}
      >
        <planeGeometry args={[60, 40]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {comps.map((c) => <ComponentNode key={c.id} comp={c} />)}
      <Wires />
      <PendingWire />
      <PlacementRing />
      <MarqueeRect />
      <Bridge />
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.05} minDistance={3} maxDistance={70} enableDamping={false} />
    </>
  );
}

export function Workspace() {
  return (
    <div
      className="w-full h-full"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-electrolab')) e.preventDefault(); }}
      onDrop={(e) => {
        const type = e.dataTransfer.getData('application/x-electrolab');
        if (!type) return;
        e.preventDefault();
        const g = bridge.toGround(e.clientX, e.clientY);
        const s = useLab.getState();
        if (g) s.addComponent(type, snap(g[0], s.grid), snap(g[1], s.grid));
      }}
    >
      <Canvas shadows camera={{ position: [0, 14, 15], fov: 45 }} dpr={[1, 2]}>
        <Scene />
      </Canvas>
    </div>
  );
}
