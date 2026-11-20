import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useMemo } from 'react';
import * as THREE from 'three';
import { useLab } from '../store/lab';
import { getDef } from '../library/components';
import { ComponentModel } from './models';
import { ensureDesign, worldPads } from '../core/pcb/design';
import { isPhysical } from '../core/pcb/footprints';
import { offsetPoly, outlinePoly } from '../core/pcb/geom';

const MM = 0.1; // mm -> scene cm
const BOARD_T = 1.6 * MM;

/** polygon (board mm, y down) -> THREE.Shape in scene cm. Shape y is negated so that after rotating the mesh by -90 deg about x the scene z equals the board y. */
function shapeOf(poly: [number, number][], holes: { x: number; y: number; drill: number }[] = []): THREE.Shape {
  const sh = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x * MM, -y * MM)));
  for (const m of holes) { const p = new THREE.Path(); p.absarc(m.x * MM, -m.y * MM, (m.drill / 2) * MM, 0, Math.PI * 2, true); sh.holes.push(p); }
  return sh;
}

function Segment({ a, b, w, y, color = '#d4a017' }: { a: [number, number]; b: [number, number]; w: number; y: number; color?: string }) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  return (
    <mesh position={[((a[0] + b[0]) / 2) * MM, y, ((a[1] + b[1]) / 2) * MM]} rotation={[0, -Math.atan2(dy, dx), 0]}>
      <boxGeometry args={[len * MM + w * MM, 0.004, w * MM]} />
      <meshStandardMaterial color={color} metalness={0.8} roughness={0.35} />
    </mesh>
  );
}

function Board() {
  const circuit = useLab((s) => s.circuit);
  const live = useLab((s) => s.live);
  const design = useMemo(() => ensureDesign(circuit), [circuit]);
  const pads = useMemo(() => worldPads(circuit, design), [circuit, design]);
  const { w, h } = design.outline;
  const top = BOARD_T / 2, bot = -BOARD_T / 2;
  const boardShape = useMemo(() => shapeOf(outlinePoly(design.outline), design.holes), [design.outline, design.holes]);
  const zoneShapes = useMemo(() => design.zones.filter((z) => z.layer === 'top' || z.layer === 'bottom').map((z) => {
    const poly = z.poly && z.poly.length >= 3 ? z.poly : offsetPoly(outlinePoly(design.outline), 0.05 / MM);
    return { z, shape: shapeOf(poly.length >= 3 ? poly : outlinePoly(design.outline)) };
  }), [design.zones, design.outline]);
  return (
    <group position={[-(w * MM) / 2, 0, -(h * MM) / 2]}> {/* centred on the bounding box */}
      {/* board: the (possibly polygonal) outline extruded to the board thickness, mounting holes cut out */}
      <mesh position={[0, bot, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <extrudeGeometry args={[boardShape, { depth: BOARD_T, bevelEnabled: false }]} />
        <meshStandardMaterial color="#0f5132" roughness={0.6} />
      </mesh>
      {zoneShapes.map(({ z, shape }) => (
        <mesh key={z.id} position={[0, z.layer === 'top' ? top + 0.001 : bot - 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <shapeGeometry args={[shape]} />
          <meshStandardMaterial color="#b8860b" transparent opacity={0.45} metalness={0.7} roughness={0.5} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {design.tracks.map((t) => t.pts.slice(1).map((p, i) => <Segment key={`${t.id}-${i}`} a={t.pts[i]} b={p} w={t.width} y={t.layer === 'top' ? top + 0.003 : bot - 0.003} />))}
      {design.vias.map((v) => (
        <mesh key={v.id} position={[v.x * MM, 0, v.y * MM]}>
          <cylinderGeometry args={[(v.dia / 2) * MM, (v.dia / 2) * MM, BOARD_T + 0.01, 12]} />
          <meshStandardMaterial color="#e5c07b" metalness={0.9} roughness={0.3} />
        </mesh>
      ))}
      {pads.map((p) => (
        <mesh key={`${p.comp}:${p.pin}`} position={[p.x * MM, p.layers.includes('top') ? top + 0.002 : bot - 0.002, p.y * MM]}>
          <boxGeometry args={[p.w * MM, 0.004, p.h * MM]} />
          <meshStandardMaterial color="#e5c07b" metalness={0.9} roughness={0.3} />
        </mesh>
      ))}
      {circuit.components.filter((c) => isPhysical(getDef(c.type)) && design.placements[c.id]).map((c) => {
        const pl = design.placements[c.id];
        const def = getDef(c.type);
        const bottom = pl.side === 'bottom';
        return (
          <group key={c.id} position={[pl.x * MM, bottom ? bot : top, pl.y * MM]} rotation={[bottom ? Math.PI : 0, -(pl.rot * Math.PI) / 180, 0]} scale={[bottom ? -0.508 : 0.508, 0.508, 0.508]}>
            <ComponentModel def={def} comp={c} res={live?.comps[c.id]} />
          </group>
        );
      })}
    </group>
  );
}

/** 3D PCB view: board, copper, pads, vias, pours and the parts at their PCB positions. */
export function Pcb3D() {
  return (
    <Canvas camera={{ position: [0, 9, 11], fov: 45 }} dpr={[1, 2]}>
      <color attach="background" args={['#0a0e13']} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[8, 14, 6]} intensity={1.4} />
      <hemisphereLight args={['#9bbcff', '#1b1f24', 0.4]} />
      <Board />
      <OrbitControls makeDefault minDistance={2} maxDistance={60} />
    </Canvas>
  );
}
