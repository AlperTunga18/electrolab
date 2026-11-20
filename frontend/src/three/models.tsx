import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { Line } from '@react-three/drei';
import type { PlacedComponent } from '../core/circuit/types';
import type { ComponentDef } from '../library/types';
import type { CompResult } from '../core/sim/mna';
import { UserGlb } from './UserGlb';

const METAL = '#b8bcc4';
const BLACK = '#18181b';

const BAND = ['#000000', '#7b4a1e', '#dc2626', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#9ca3af', '#f4f4f5'];
const GOLD = '#d4af37';
const SILVER = '#c0c0c0';

/** 4-band resistor colour code for a resistance in ohms. */
export function resistorBands(r: number): string[] {
  if (!(r > 0)) return [BAND[0], BAND[0], BAND[0], GOLD];
  let exp = Math.floor(Math.log10(r)) - 1;
  let mant = Math.round(r / 10 ** exp);
  if (mant >= 100) { mant = Math.round(mant / 10); exp++; }
  const mult = exp === -1 ? GOLD : exp === -2 ? SILVER : BAND[Math.min(Math.max(exp, 0), 9)];
  return [BAND[Math.floor(mant / 10) % 10], BAND[mant % 10], mult, GOLD];
}

const LED_COLOR: Record<string, string> = { red: '#ef4444', yellow: '#facc15', green: '#22c55e', blue: '#3b82f6', white: '#f8fafc', orange: '#fb923c', ir: '#7f1d1d', uv: '#8b5cf6' };

type V3 = [number, number, number];
const Lead = ({ pts, w = 1.5 }: { pts: V3[]; w?: number }) => <Line points={pts} color={METAL} lineWidth={w} />;

/** leg from pin top up to body attach point */
const Leg = ({ x, z = 0, to }: { x: number; z?: number; to: V3 }) => <Lead pts={[[x, 0.2, z], [x, to[1], z], to]} />;

/** Group spinning around `axis` with an integrated angle; visual rate = sign(omega)*min(|omega|/40, cap) rad/s. */
function Spinner({ omega, axis, cap, children }: { omega: number; axis: 'x' | 'y'; cap: number; children: React.ReactNode }) {
  const ref = useRef<Group>(null);
  const angle = useRef(0);
  useFrame((_, delta) => {
    const rate = Math.sign(omega) * Math.min(Math.abs(omega) / 40, cap);
    angle.current += rate * delta;
    if (ref.current) ref.current.rotation[axis] = angle.current;
  });
  return <group ref={ref}>{children}</group>;
}

function SpinningShaft({ omega }: { omega: number }) {
  return (
    <Spinner omega={omega} axis="x" cap={25}>
      <mesh position={[1.9, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.12, 0.12, 1.4, 12]} />
        <meshStandardMaterial color={METAL} metalness={0.8} roughness={0.25} />
      </mesh>
      <mesh position={[2.4, 0.2, 0]}>
        <boxGeometry args={[0.3, 0.3, 0.06]} />
        <meshStandardMaterial color="#ef4444" />
      </mesh>
    </Spinner>
  );
}

function SpinningFan({ omega }: { omega: number }) {
  return (
    <Spinner omega={omega} axis="y" cap={30}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.35, 0.35, 0.5, 16]} />
        <meshStandardMaterial color="#27272a" />
      </mesh>
      {[0, 1, 2, 3, 4].map((i) => (
        <group key={i} rotation={[0, (i * 2 * Math.PI) / 5, 0]}>
          <mesh position={[0.75, 0, 0]} rotation={[0.35, 0, 0]}>
            <boxGeometry args={[1, 0.05, 0.5]} />
            <meshStandardMaterial color="#e5e7eb" roughness={0.5} />
          </mesh>
        </group>
      ))}
    </Spinner>
  );
}

interface Props { def: ComponentDef; comp: PlacedComponent; res?: CompResult }

function BuiltinModel({ def, comp, res }: Props) {
  const P = comp.params;
  const pins = def.pins;
  const vis = def.visual;
  let key = vis?.like ?? def.type;
  if (vis?.kind === 'to220') key = 'nmos_std';
  if (vis?.kind === 'to92') key = 'npn';
  switch (key) {
    case 'resistor': {
      const b = resistorBands(Number(P.r));
      return (
        <group>
          <Leg x={pins[0].x} to={[-0.55, 0.5, 0]} />
          <Leg x={pins[1].x} to={[0.55, 0.5, 0]} />
          <mesh position={[0, 0.5, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <capsuleGeometry args={[0.24, 0.8, 6, 16]} />
            <meshStandardMaterial color="#d8b98a" roughness={0.7} />
          </mesh>
          {b.map((c, i) => (
            <mesh key={i} position={[-0.32 + i * 0.2 + (i === 3 ? 0.1 : 0), 0.5, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.255, 0.255, 0.07, 16]} />
              <meshStandardMaterial color={c} roughness={0.5} />
            </mesh>
          ))}
        </group>
      );
    }
    case 'capacitor':
      return (
        <group>
          <Leg x={pins[0].x} to={[-0.25, 0.7, 0]} />
          <Leg x={pins[1].x} to={[0.25, 0.7, 0]} />
          <mesh position={[0, 1.05, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.5, 0.5, 0.2, 24]} />
            <meshStandardMaterial color="#d97706" roughness={0.6} />
          </mesh>
        </group>
      );
    case 'capacitor_el':
      return (
        <group>
          <Leg x={pins[0].x} to={[pins[0].x, 0.5, 0]} />
          <Leg x={pins[1].x} to={[pins[1].x, 0.5, 0]} />
          <mesh position={[0, 1.2, 0]} castShadow>
            <cylinderGeometry args={[0.68, 0.68, 1.5, 28]} />
            <meshStandardMaterial color="#1e3a8a" roughness={0.45} />
          </mesh>
          <mesh position={[0, 1.96, 0]}>
            <cylinderGeometry args={[0.6, 0.6, 0.03, 28]} />
            <meshStandardMaterial color={METAL} metalness={0.7} roughness={0.3} />
          </mesh>
          <mesh position={[-0.52, 1.2, 0.36]} rotation={[0, 0.5, 0]}>
            <boxGeometry args={[0.18, 1.4, 0.04]} />
            <meshStandardMaterial color="#e5e7eb" />
          </mesh>
        </group>
      );
    case 'inductor':
      return (
        <group>
          <Leg x={pins[0].x} to={[-0.7, 0.5, 0]} />
          <Leg x={pins[1].x} to={[0.7, 0.5, 0]} />
          <mesh position={[0, 0.5, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.22, 0.22, 1.4, 16]} />
            <meshStandardMaterial color="#3f3f46" />
          </mesh>
          {Array.from({ length: 8 }, (_, i) => (
            <mesh key={i} position={[-0.6 + i * 0.17, 0.5, 0]} rotation={[0, Math.PI / 2, 0]}>
              <torusGeometry args={[0.3, 0.06, 8, 18]} />
              <meshStandardMaterial color="#b45309" metalness={0.8} roughness={0.35} />
            </mesh>
          ))}
        </group>
      );
    case 'diode':
    case 'zener':
      return (
        <group>
          <Leg x={pins[0].x} to={[-0.6, 0.45, 0]} />
          <Leg x={pins[1].x} to={[0.6, 0.45, 0]} />
          <mesh position={[0, 0.45, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.2, 0.2, 1.2, 16]} />
            <meshStandardMaterial color={def.type === 'zener' ? '#7c2d12' : BLACK} roughness={0.4} />
          </mesh>
          <mesh position={[0.4, 0.45, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.215, 0.215, 0.16, 16]} />
            <meshStandardMaterial color={SILVER} metalness={0.6} roughness={0.3} />
          </mesh>
        </group>
      );
    case 'led': {
      const col = LED_COLOR[String(P.color)] ?? '#ef4444';
      const i = Math.max(res?.i ?? 0, 0);
      const ifmax = Number(P.ifmax) || 0.03;
      const glow = Math.min(i / 0.02, 2.5);
      const burn = i > ifmax;
      return (
        <group>
          <Leg x={pins[0].x} to={[pins[0].x, 0.6, 0]} />
          <Leg x={pins[1].x} to={[pins[1].x, 0.6, 0]} />
          <mesh position={[0, 0.9, 0]} castShadow>
            <cylinderGeometry args={[0.4, 0.4, 0.6, 20]} />
            <meshPhysicalMaterial color={col} transparent opacity={0.85} emissive={col} emissiveIntensity={glow} roughness={0.2} />
          </mesh>
          <mesh position={[0, 1.2, 0]}>
            <sphereGeometry args={[0.4, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshPhysicalMaterial color={col} transparent opacity={0.85} emissive={col} emissiveIntensity={glow} roughness={0.2} />
          </mesh>
          {glow > 0.05 && <pointLight position={[0, 1.3, 0]} color={col} intensity={glow * 6} distance={7} />}
          {burn && <pointLight position={[0, 1.3, 0]} color="#ff2200" intensity={8} distance={4} />}
        </group>
      );
    }
    case 'npn':
    case 'pnp':
      return (
        <group>
          {pins.map((p) => <Leg key={p.id} x={p.x} to={[p.x * 0.9, 0.7, 0]} />)}
          <mesh position={[0, 1.1, 0]} castShadow>
            <cylinderGeometry args={[0.55, 0.55, 0.8, 20, 1, false, -Math.PI / 2, Math.PI]} />
            <meshStandardMaterial color={BLACK} roughness={0.5} />
          </mesh>
          <mesh position={[0, 1.1, 0]} rotation={[0, 0, 0]}>
            <boxGeometry args={[1.1, 0.8, 0.01]} />
            <meshStandardMaterial color="#27272a" />
          </mesh>
        </group>
      );
    case 'nmos_logic':
    case 'nmos_std':
    case 'pmos':
      return (
        <group>
          {pins.map((p) => <Leg key={p.id} x={p.x} to={[p.x, 0.9, 0]} />)}
          <mesh position={[0, 1.6, 0]} castShadow>
            <boxGeometry args={[1.5, 1.4, 0.45]} />
            <meshStandardMaterial color={BLACK} roughness={0.5} />
          </mesh>
          <mesh position={[0, 2.55, -0.04]}>
            <boxGeometry args={[1.5, 0.75, 0.1]} />
            <meshStandardMaterial color={METAL} metalness={0.7} roughness={0.35} />
          </mesh>
        </group>
      );
    case 'dc_supply':
    case 'signal_gen':
    case 'isource': {
      const color = def.type === 'dc_supply' ? '#374151' : def.type === 'signal_gen' ? '#1d4ed8' : '#6d28d9';
      return (
        <group>
          <mesh position={[0, 0.8, -0.4]} castShadow>
            <boxGeometry args={[3, 1.6, 1.4]} />
            <meshStandardMaterial color={color} roughness={0.6} />
          </mesh>
          <mesh position={[0, 1.2, 0.31]}>
            <boxGeometry args={[1.2, 0.5, 0.02]} />
            <meshStandardMaterial color="#052e16" emissive="#22c55e" emissiveIntensity={0.3} />
          </mesh>
          {pins.map((p, i) => (
            <mesh key={p.id} position={[p.x, 0.4, 0.1]}>
              <cylinderGeometry args={[0.16, 0.16, 0.5, 12]} />
              <meshStandardMaterial color={i === 0 ? '#dc2626' : '#111827'} />
            </mesh>
          ))}
        </group>
      );
    }
    case 'ground':
      return (
        <group>
          <mesh position={[0, 0.05, 0]}><boxGeometry args={[0.7, 0.1, 0.7]} /><meshStandardMaterial color="#a16207" metalness={0.7} roughness={0.4} /></mesh>
          {[0.55, 0.38, 0.2].map((w, i) => (
            <mesh key={i} position={[0, 0.2 + i * 0.12, 0]}><boxGeometry args={[w * 1.4, 0.05, 0.1]} /><meshStandardMaterial color="#d4d4d8" /></mesh>
          ))}
        </group>
      );
    case 'switch': {
      const on = P.closed === true;
      return (
        <group>
          <mesh position={[0, 0.3, 0]} castShadow><boxGeometry args={[1.6, 0.6, 0.9]} /><meshStandardMaterial color="#52525b" /></mesh>
          <mesh position={[0, 0.8, 0]} rotation={[0, 0, on ? 0.45 : -0.45]}>
            <boxGeometry args={[0.14, 0.9, 0.2]} />
            <meshStandardMaterial color={on ? '#22c55e' : '#e5e7eb'} />
          </mesh>
        </group>
      );
    }
    case 'button': {
      const on = P.closed === true;
      return (
        <group>
          <mesh position={[0, 0.3, 0]} castShadow><boxGeometry args={[1.2, 0.6, 1.2]} /><meshStandardMaterial color="#27272a" /></mesh>
          <mesh position={[0, on ? 0.62 : 0.8, 0]}><cylinderGeometry args={[0.38, 0.38, 0.4, 20]} /><meshStandardMaterial color={on ? '#22c55e' : '#dc2626'} /></mesh>
        </group>
      );
    }
    case 'pot': {
      const pos = Number(P.pos);
      return (
        <group>
          {pins.map((p) => <Leg key={p.id} x={p.x} to={[p.x, 0.5, 0]} />)}
          <mesh position={[0, 0.7, -0.2]} castShadow><boxGeometry args={[2.2, 1, 1.4]} /><meshStandardMaterial color="#1d4ed8" roughness={0.5} /></mesh>
          <mesh position={[0, 1.35, -0.2]} rotation={[0, -(pos - 0.5) * Math.PI * 1.5, 0]}>
            <cylinderGeometry args={[0.45, 0.45, 0.35, 20]} />
            <meshStandardMaterial color="#e5e7eb" metalness={0.5} roughness={0.4} />
          </mesh>
          <mesh position={[0, 1.55, -0.2]} rotation={[0, -(pos - 0.5) * Math.PI * 1.5, 0]}>
            <boxGeometry args={[0.1, 0.05, 0.8]} />
            <meshStandardMaterial color="#111827" />
          </mesh>
        </group>
      );
    }
    case 'motor':
    case 'dc_motor':
    case 'fan_12v': {
      const omega = res?.vals.omega ?? 0;
      if (def.type === 'fan_12v') {
        return (
          <group>
            <mesh position={[0, 0.5, 0]} castShadow>
              <boxGeometry args={[3, 1, 3]} />
              <meshStandardMaterial color="#1f2937" roughness={0.6} />
            </mesh>
            <mesh position={[0, 1.02, 0]}>
              <boxGeometry args={[2.6, 0.06, 2.6]} />
              <meshStandardMaterial color="#111827" roughness={0.8} />
            </mesh>
            <group position={[0, 0.6, 0]}><SpinningFan omega={omega} /></group>
          </group>
        );
      }
      return (
        <group>
          <mesh position={[0, 0.9, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.8, 0.8, 2.2, 24]} />
            <meshStandardMaterial color={METAL} metalness={0.7} roughness={0.35} />
          </mesh>
          <mesh position={[1.15, 0.9, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.6, 0.6, 0.1, 24]} />
            <meshStandardMaterial color="#52525b" metalness={0.6} roughness={0.4} />
          </mesh>
          <group position={[0, 0.9, 0]}><SpinningShaft omega={omega} /></group>
        </group>
      );
    }
    case 'stepper_2ph': {
      // rotor angle (deg) comes straight from the solver state, so the shaft marker shows real position
      const ang = ((res?.vals.angle ?? 0) * Math.PI) / 180;
      return (
        <group>
          <mesh position={[0, 1.6, 0]} castShadow><boxGeometry args={[4.2, 3.2, 4.2]} /><meshStandardMaterial color="#27272a" roughness={0.5} metalness={0.3} /></mesh>
          <mesh position={[0, 3.3, 0]}><cylinderGeometry args={[1.1, 1.1, 0.2, 24]} /><meshStandardMaterial color={METAL} metalness={0.7} roughness={0.35} /></mesh>
          <group position={[0, 3.4, 0]} rotation={[0, -ang, 0]}>
            <mesh position={[0, 0.5, 0]}><cylinderGeometry args={[0.25, 0.25, 1.2, 16]} /><meshStandardMaterial color={METAL} metalness={0.8} roughness={0.25} /></mesh>
            <mesh position={[0.45, 1.05, 0]}><boxGeometry args={[0.9, 0.12, 0.2]} /><meshStandardMaterial color="#ef4444" /></mesh>
          </group>
        </group>
      );
    }
    case 'servo_sg90': {
      const ang = ((res?.vals.angle ?? 90) * Math.PI) / 180;
      return (
        <group>
          <mesh position={[0, 1.1, 0]} castShadow><boxGeometry args={[2.3, 2.2, 1.2]} /><meshStandardMaterial color="#1d4ed8" roughness={0.5} /></mesh>
          <mesh position={[0.6, 2.35, 0]}><cylinderGeometry args={[0.45, 0.45, 0.3, 20]} /><meshStandardMaterial color="#1e40af" roughness={0.5} /></mesh>
          {/* horn: 0° points along -x, 180° along +x (sweeps over the top) */}
          <group position={[0.6, 2.6, 0]} rotation={[0, ang, 0]}>
            <mesh position={[-0.6, 0, 0]}><boxGeometry args={[1.4, 0.12, 0.3]} /><meshStandardMaterial color="#f4f4f5" /></mesh>
            <mesh><cylinderGeometry args={[0.2, 0.2, 0.15, 16]} /><meshStandardMaterial color="#e5e7eb" /></mesh>
          </group>
        </group>
      );
    }
    case 'bldc_3ph': {
      // mechanical rotor angle (deg) comes straight from the solver state, so the bell marker shows the real position
      const ang = ((res?.vals.angle ?? 0) * Math.PI) / 180;
      return (
        <group>
          <mesh position={[0, 0.3, 0]} castShadow><cylinderGeometry args={[1.1, 1.2, 0.6, 28]} /><meshStandardMaterial color="#27272a" roughness={0.5} metalness={0.3} /></mesh>
          <group position={[0, 0.6, 0]} rotation={[0, -ang, 0]}>
            <mesh position={[0, 0.6, 0]} castShadow><cylinderGeometry args={[1.4, 1.4, 1.2, 36]} /><meshStandardMaterial color="#6b7280" metalness={0.75} roughness={0.35} /></mesh>
            <mesh position={[0, 1.22, 0]}><cylinderGeometry args={[0.35, 0.35, 0.08, 20]} /><meshStandardMaterial color={METAL} metalness={0.8} roughness={0.25} /></mesh>
            <mesh position={[1.41, 0.6, 0]}><boxGeometry args={[0.06, 0.9, 0.22]} /><meshStandardMaterial color="#ef4444" /></mesh>
            <mesh position={[0, 1.4, 0]}><cylinderGeometry args={[0.1, 0.1, 0.5, 12]} /><meshStandardMaterial color={METAL} metalness={0.8} roughness={0.25} /></mesh>
          </group>
        </group>
      );
    }
    case 'solenoid': {
      // plunger position (0 = out, 1 = fully pulled in) comes straight from the solver state
      const p = Math.min(Math.max(res?.vals.pos ?? 0, 0), 1);
      return (
        <group>
          <mesh position={[-0.3, 0.9, 0]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.85, 0.85, 1.8, 28]} /><meshStandardMaterial color="#b45309" metalness={0.5} roughness={0.45} /></mesh>
          <mesh position={[-1.25, 0.9, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.95, 0.95, 0.1, 28]} /><meshStandardMaterial color={METAL} metalness={0.7} roughness={0.35} /></mesh>
          <mesh position={[0.65, 0.9, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.95, 0.95, 0.1, 28]} /><meshStandardMaterial color={METAL} metalness={0.7} roughness={0.35} /></mesh>
          <mesh position={[0.95 - 0.9 * p, 0.9, 0]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.3, 0.3, 2.2, 20]} /><meshStandardMaterial color={METAL} metalness={0.85} roughness={0.25} /></mesh>
        </group>
      );
    }
    case 'relay':
    case 'relay_5v':
    case 'relay_12v': {
      const on = (res?.vals.energized ?? 0) > 0.5;
      return (
        <group>
          <mesh position={[0, 0.8, 0]} castShadow>
            <boxGeometry args={[3.2, 1.6, 2.4]} />
            <meshStandardMaterial color="#1e3a8a" roughness={0.5} />
          </mesh>
          <mesh position={[0.6, 1.65, 0]} rotation={[0, 0, on ? -0.15 : 0.25]}>
            <boxGeometry args={[1.8, 0.06, 0.4]} />
            <meshStandardMaterial color={METAL} metalness={0.8} roughness={0.3} />
          </mesh>
          <mesh position={[-0.5, 1.65, 0]}>
            <cylinderGeometry args={[0.1, 0.1, 0.1, 12]} />
            <meshStandardMaterial color={METAL} metalness={0.8} roughness={0.3} />
          </mesh>
          <mesh position={[-1.2, 1.65, 0.8]}>
            <sphereGeometry args={[0.1, 12, 8]} />
            <meshStandardMaterial color={on ? '#22c55e' : '#14532d'} emissive="#22c55e" emissiveIntensity={on ? 2 : 0} />
          </mesh>
        </group>
      );
    }
    case 'transformer':
      return (
        <group>
          {[0, 0.3, 0.6, 0.9, 1.2, 1.5].map((y, i) => (
            <mesh key={i} position={[0, 0.2 + y, 0]}>
              <boxGeometry args={[2.4, 0.28, 1.6]} />
              <meshStandardMaterial color={i % 2 ? '#6b7280' : '#9ca3af'} metalness={0.5} roughness={0.5} />
            </mesh>
          ))}
          <mesh position={[-1.1, 1.0, 0]} castShadow>
            <cylinderGeometry args={[0.7, 0.7, 1.5, 20]} />
            <meshStandardMaterial color="#b45309" metalness={0.8} roughness={0.35} />
          </mesh>
          <mesh position={[1.1, 1.0, 0]} castShadow>
            <cylinderGeometry args={[0.7, 0.7, 1.5, 20]} />
            <meshStandardMaterial color="#b45309" metalness={0.8} roughness={0.35} />
          </mesh>
        </group>
      );
    case 'eload': {
      const glow = Math.min(Math.max((res?.p ?? 0) / 50, 0), 3);
      return (
        <group>
          <mesh position={[0, 0.6, 0]} castShadow>
            <boxGeometry args={[2.6, 1.2, 2]} />
            <meshStandardMaterial color="#3f3f46" metalness={0.6} roughness={0.45} />
          </mesh>
          {[-1, -0.5, 0, 0.5, 1].map((x, i) => (
            <mesh key={i} position={[x, 1.5, 0]}>
              <boxGeometry args={[0.1, 0.6, 1.8]} />
              <meshStandardMaterial color="#52525b" metalness={0.6} roughness={0.4} />
            </mesh>
          ))}
          <mesh position={[0, 0.6, 1.02]}>
            <boxGeometry args={[1.6, 0.6, 0.04]} />
            <meshStandardMaterial color="#7f1d1d" emissive="#ef4444" emissiveIntensity={glow} />
          </mesh>
        </group>
      );
    }
    default: {
      const xs =pins.map((p) => p.x), zs = pins.map((p) => p.z);
      const minX = Math.min(...xs, -0.3), maxX = Math.max(...xs, 0.3), minZ = Math.min(...zs, -0.3), maxZ = Math.max(...zs, 0.3);
      const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
      const color = vis?.color ?? '#52525b';
      const h = vis?.h ?? def.size.h;
      const kind = vis?.kind ?? 'box';
      if (kind === 'ic') {
        const bw = Math.max(maxX - minX - 0.2, 0.8), bd = maxZ - minZ + 0.4;
        return (
          <group>
            {pins.map((p) => <Leg key={p.id} x={p.x} z={p.z} to={[p.x * 0.85, 0.35, p.z]} />)}
            <mesh position={[cx, 0.35 + h / 2, cz]} castShadow><boxGeometry args={[bw, h, bd]} /><meshStandardMaterial color={color} roughness={0.5} /></mesh>
            <mesh position={[cx, 0.36 + h, cz - bd / 2 + 0.25]}><cylinderGeometry args={[0.1, 0.1, 0.02, 12]} /><meshStandardMaterial color="#d4d4d8" /></mesh>
          </group>
        );
      }
      if (kind === 'board') {
        const bw = maxX - minX + 1, bd = maxZ - minZ + 1;
        return (
          <group>
            <mesh position={[cx, 0.25, cz]} castShadow><boxGeometry args={[bw, 0.12, bd]} /><meshStandardMaterial color={color} roughness={0.6} /></mesh>
            <mesh position={[cx, 0.45, cz + bd * 0.1]}><boxGeometry args={[Math.min(bw * 0.4, 1.6), 0.28, Math.min(bd * 0.25, 1.6)]} /><meshStandardMaterial color="#18181b" /></mesh>
            <mesh position={[cx, 0.4, cz - bd / 2 + 0.3]}><boxGeometry args={[Math.min(bw * 0.35, 1.4), 0.3, 0.6]} /><meshStandardMaterial color={METAL} metalness={0.7} roughness={0.35} /></mesh>
          </group>
        );
      }
      if (kind === 'cyl') {
        const r = Math.min(maxX - minX, maxZ - minZ, 3) / 2 + 0.3;
        return (
          <group>
            {pins.map((p) => <Leg key={p.id} x={p.x} z={p.z} to={[p.x, 0.5, p.z]} />)}
            <mesh position={[cx, 0.5 + h / 2, cz]} castShadow><cylinderGeometry args={[r, r, h, 24]} /><meshStandardMaterial color={color} roughness={0.5} /></mesh>
          </group>
        );
      }
      if (kind === 'smd') {
        return (
          <group>
            <mesh position={[0, 0.3, 0]}><boxGeometry args={[def.size.w, 0.3, def.size.d]} /><meshStandardMaterial color="#27272a" /></mesh>
            {pins.map((p) => <Leg key={p.id} x={p.x} z={p.z} to={[p.x, 0.3, p.z]} />)}
          </group>
        );
      }
      return (
        <group>
          {pins.map((p) => <Leg key={p.id} x={p.x} z={p.z} to={[p.x, 0.4, p.z]} />)}
          <mesh position={[cx, 0.4 + h / 2, cz]} castShadow><boxGeometry args={[Math.max(maxX - minX + 0.6, def.size.w * 0.8), h, Math.max(maxZ - minZ + 0.6, def.size.d * 0.8)]} /><meshStandardMaterial color={color} roughness={0.55} /></mesh>
        </group>
      );
    }
  }
}

/** Uses the user's uploaded GLB/glTF when the part has `model3d`; falls back to the built-in model while loading or on error. */
export function ComponentModel(p: Props) {
  if (p.def.model3d) return <UserGlb def={p.def} fallback={<BuiltinModel {...p} />} />;
  return <BuiltinModel {...p} />;
}
