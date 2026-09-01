/**
 * Shared painting for the pink starfield and the wireframe sphere.
 *
 * The splash screen and the About dialog draw the same scene: drifting nebula clouds, twinkling
 * stars, and a slowly rotating wireframe globe. Everything here is pure canvas work against a
 * context the caller owns — no React, no state — so both can run it from their own rAF loop.
 */

export interface Vec3 { x: number; y: number; z: number }

export const rotY = (v: Vec3, a: number): Vec3 => ({ x: v.x * Math.cos(a) + v.z * Math.sin(a), y: v.y, z: -v.x * Math.sin(a) + v.z * Math.cos(a) });
export const rotX = (v: Vec3, a: number): Vec3 => ({ x: v.x, y: v.y * Math.cos(a) - v.z * Math.sin(a), z: v.y * Math.sin(a) + v.z * Math.cos(a) });

export interface Sphere {
  verts: Vec3[];
  edges: [number, number][];
  rings: number;
  segs: number;
}

export function buildSphere(rings: number, segs: number, r: number): Sphere {
  const verts: Vec3[] = [];
  const edges: [number, number][] = [];
  for (let i = 0; i <= rings; i++) {
    const phi = (Math.PI * i) / rings;
    for (let j = 0; j < segs; j++) {
      const th = (2 * Math.PI * j) / segs;
      verts.push({ x: r * Math.sin(phi) * Math.cos(th), y: r * Math.cos(phi), z: r * Math.sin(phi) * Math.sin(th) });
    }
  }
  for (let i = 0; i <= rings; i++) {
    for (let j = 0; j < segs; j++) {
      const cur = i * segs + j;
      edges.push([cur, i * segs + ((j + 1) % segs)]);
      if (i < rings) edges.push([cur, cur + segs]);
    }
  }
  return { verts, edges, rings, segs };
}

/* ── Stars ──────────────────────────────────────────────── */

export interface Star { x: number; y: number; r: number; phase: number; speed: number; bright: number }

export function generateStars(count: number): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random(),
      y: Math.random(),
      r: 0.3 + Math.random() * 1.4,
      phase: Math.random() * Math.PI * 2,
      speed: 0.0008 + Math.random() * 0.003,
      bright: 0.3 + Math.random() * 0.7,
    });
  }
  return stars;
}

/* ── Palette (pink-themed per project identity) ─────────── */

export const PINK = "255,95,162";
export const PINK_HI = "255,190,220";
export const PINK_DIM = "180,60,110";
export const VIOLET = "160,100,240";
export const BLUE = "40,50,130";

/* ── Background ─────────────────────────────────────────── */

/** Three slowly drifting radial clouds, painted over whatever the element's own background is. */
export function drawNebula(ctx: CanvasRenderingContext2D, cw: number, ch: number, el: number) {
  const drift = el * 0.00003;

  const n1x = cw * (0.3 + 0.12 * Math.sin(drift * 1.7));
  const n1y = ch * (0.25 + 0.08 * Math.cos(drift * 1.3));
  const g1 = ctx.createRadialGradient(n1x, n1y, 0, n1x, n1y, cw * 0.6);
  g1.addColorStop(0, `rgba(${VIOLET},0.2)`);
  g1.addColorStop(0.5, `rgba(${BLUE},0.1)`);
  g1.addColorStop(1, "transparent");
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, cw, ch);

  const n2x = cw * (0.75 + 0.1 * Math.cos(drift * 2.1));
  const n2y = ch * (0.7 + 0.1 * Math.sin(drift * 0.9));
  const g2 = ctx.createRadialGradient(n2x, n2y, 0, n2x, n2y, cw * 0.5);
  g2.addColorStop(0, `rgba(${PINK},0.07)`);
  g2.addColorStop(0.4, `rgba(${VIOLET},0.04)`);
  g2.addColorStop(1, "transparent");
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, cw, ch);

  const n3x = cw * (0.5 + 0.15 * Math.sin(drift * 0.7 + 2));
  const n3y = ch * (0.45 + 0.12 * Math.cos(drift * 1.1 + 1));
  const g3 = ctx.createRadialGradient(n3x, n3y, 0, n3x, n3y, cw * 0.35);
  g3.addColorStop(0, `rgba(${PINK_DIM},0.06)`);
  g3.addColorStop(1, "transparent");
  ctx.fillStyle = g3;
  ctx.fillRect(0, 0, cw, ch);
}

/** Twinkling stars with a very slow horizontal parallax and a cross glint on the brightest. */
export function drawStars(ctx: CanvasRenderingContext2D, cw: number, ch: number, el: number, stars: Star[]) {
  const starDrift = el * 0.000008;
  for (const s of stars) {
    const flicker = 0.5 + 0.5 * Math.sin(el * s.speed + s.phase);
    const a = s.bright * (0.4 + 0.6 * flicker);
    const sx = ((s.x + starDrift * (0.5 + s.bright)) % 1.05) * cw;
    const sy = s.y * ch;
    ctx.fillStyle = `rgba(${PINK_HI},${a})`;
    ctx.beginPath();
    ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
    ctx.fill();
    if (s.r > 1.0 && a > 0.5) {
      ctx.strokeStyle = `rgba(${PINK_HI},${a * 0.3})`;
      ctx.lineWidth = 0.5;
      const gl = s.r * 3;
      ctx.beginPath();
      ctx.moveTo(sx - gl, sy); ctx.lineTo(sx + gl, sy);
      ctx.moveTo(sx, sy - gl); ctx.lineTo(sx, sy + gl);
      ctx.stroke();
    }
  }
}

/* ── Sphere ─────────────────────────────────────────────── */

export interface Projected { x: number; y: number; d: number }

/**
 * Perspective-project the sphere after a Y then X rotation. The caller keeps the returned points:
 * the splash also needs them to trace its equator and to place the progress ring in the same space.
 */
export function projectSphere(sphere: Sphere, cx: number, cy: number, fov: number, ay: number, ax: number): Projected[] {
  return sphere.verts.map((v) => {
    const p = rotX(rotY(v, ay), ax);
    const z = p.z + 4;
    return { x: cx + (p.x * fov) / z, y: cy + (p.y * fov) / z, d: z };
  });
}

/** Soft pink halo behind the globe. */
export function drawSphereGlow(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, `rgba(${PINK},0.12)`);
  g.addColorStop(0.5, `rgba(${PINK_DIM},0.04)`);
  g.addColorStop(1, "transparent");
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
}

/**
 * The wireframe itself: every edge faded by depth so the far half reads as behind, then the
 * equator retraced brighter.
 */
export function drawSphereWire(ctx: CanvasRenderingContext2D, sphere: Sphere, pts: Projected[], lineWidth = 0.8) {
  ctx.lineWidth = lineWidth;
  for (const [a, b] of sphere.edges) {
    const pa = pts[a], pb = pts[b];
    const depth = (pa.d + pb.d) / 2;
    const alpha = Math.max(0.02, Math.min(0.45, 0.95 - (depth - 2.75) / 2.2));
    ctx.strokeStyle = `rgba(${PINK},${alpha})`;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }

  const eq = (sphere.rings >> 1) * sphere.segs;
  ctx.strokeStyle = `rgba(${PINK_HI},0.35)`;
  ctx.lineWidth = lineWidth * 1.5;
  ctx.beginPath();
  for (let j = 0; j <= sphere.segs; j++) {
    const p = pts[eq + (j % sphere.segs)];
    if (j === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}
