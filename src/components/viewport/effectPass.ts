/**
 * StarCraft: Remastered's moving water and lava, as one pass over the terrain layer.
 *
 * The game does not animate these tiles; it draws the ground and then bends the picture.
 * Water is the ground looked at through two layers of ripples drifting across the map, and
 * lava the ground looked at through heat. Either way a pixel is replaced by one taken from
 * a little way off, and a mask keeps that to the water or the lava. That is a per-pixel job
 * over the whole view on every frame, which a 2D canvas cannot do and a fragment shader
 * does for nothing — so the viewport stays the canvas it is, and this is a small WebGL
 * canvas beside it: the terrain layer and its mask go in as textures, the bent picture
 * comes out, and the viewport draws that where it would have drawn the layer.
 *
 * The shaders are the editor's own. The amounts in them (how far the picture bends, how the
 * two ripple layers drift and mix, the heat's reach and its red threshold) are the game's,
 * read from the installation; what the game's files do not say — how large the ripples
 * are on the map and how fast their pictures change — is in `RemasteredEffects`, where the
 * user can move it. Two things are deliberately not the game's: the bend is measured in map
 * pixels, so it is the same at every zoom, and the water's glint comes from the ripples
 * alone, where the game places a highlight by the middle of the screen — which in an editor
 * would follow the window about.
 *
 * Nothing here is required. With no WebGL, or a context the browser took back, `create`
 * and `draw` answer null and the viewport draws the layer as it stands: still water.
 */
import type { RemasteredEffects } from "../../editor/preferences";
import { decodeDxt1, type HdEffects, type HdEffectTextures, type PictureSequence } from "../../formats/tileset/hd";

/** What `draw` needs to know about where the layer sits on the map. */
export interface EffectView {
  /** The map pixel at the layer's top-left corner. */
  originX: number;
  originY: number;
  /** Layer pixels per map pixel: zoom × the display's pixel ratio. */
  scale: number;
}

const VERTEX = `
attribute vec2 corner;
varying vec2 uv;
void main() {
  uv = vec2(corner.x * 0.5 + 0.5, 0.5 - corner.y * 0.5);
  gl_Position = vec4(corner, 0.0, 1.0);
}`;

/** Shared by both: the picture's place on the map, in map pixels. */
const HEAD = `
precision mediump float;
varying vec2 uv;
uniform sampler2D ground;
uniform sampler2D mask;
uniform vec2 size;
uniform vec2 origin;
uniform float time;
`;

const WATER = `${HEAD}
uniform sampler2D largeA;
uniform sampler2D largeB;
uniform sampler2D fineA;
uniform sampler2D fineB;
uniform float blend;
uniform float bend;
uniform float glint;
uniform vec2 ripple;
vec3 direction(vec3 colour) { return colour * 2.0 - 1.0; }
void main() {
  vec2 world = origin + uv * size;
  float drift = time / 20.0;
  vec2 uvLarge = world / ripple.x - vec2(drift * 0.5, drift);
  vec2 uvFine = world / ripple.y - vec2(drift * 2.0, drift * 1.8);
  vec3 large = direction(mix(texture2D(largeA, uvLarge).rgb, texture2D(largeB, uvLarge).rgb, blend));
  vec3 fine = direction(mix(texture2D(fineA, uvFine).rgb, texture2D(fineB, uvFine).rgb, blend)) * 0.6;
  vec3 normal = normalize(vec3((large.xy + fine.xy) * 0.6, large.z));
  vec2 bent = uv + normal.xy * vec2(12.16, 13.92) * bend / size;
  float here = texture2D(mask, uv).r;
  // The lesser of the two: land is never pulled into the water, nor water onto the land.
  float wet = min(here, texture2D(mask, bent).r);
  vec3 colour = mix(texture2D(ground, uv).rgb, texture2D(ground, bent).rgb, wet);
  // Only what the ripples add; the flat part of the normal would lighten all the water alike.
  float shine = (normal.x * 1.2 + normal.y + (normal.z - 1.0)) / 3.0 * glint;
  gl_FragColor = vec4(colour + shine * here, 1.0);
}`;

const HEAT = `${HEAD}
uniform sampler2D noise;
uniform float reach;
uniform float grain;
void main() {
  vec2 world = origin + uv * size;
  vec2 at = world / grain + vec2(cos(time / 10.0) * 0.3, time / 10.0);
  vec4 n = texture2D(noise, at);
  vec2 offset = vec2(cos(n.r * 3.14 + time * 0.5) * 1.9, sin(n.g * 3.14 + time * 0.5) * 0.5) * reach / size;
  vec3 here = texture2D(ground, uv).rgb;
  vec3 there = texture2D(ground, uv + offset).rgb;
  // Heat shows on what glows: the redder the pixel it reaches, the more of it, and none below a dull red.
  float amount = min(there.r * 2.4, 1.0) * step(0.2, there.r) * texture2D(mask, uv + offset).r;
  gl_FragColor = vec4(mix(here, there, amount), 1.0);
}`;

/** `COMPRESSED_RGB_S3TC_DXT1_EXT`: the ripple pictures go to the card as they are in the file where it takes them. */
const DXT1 = 0x83f0;
/** How coarse the heat's noise lies on the map, in map pixels a repeat. */
const HEAT_GRAIN = 128;

interface Program {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | null>;
}

interface Textures {
  large: WebGLTexture[];
  fine: WebGLTexture[];
  noise: WebGLTexture | null;
}

export class EffectPass {
  readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderingContext;
  private readonly water: Program;
  private readonly heat: Program;
  private readonly ground: WebGLTexture;
  private readonly mask: WebGLTexture;
  private readonly textures = new WeakMap<HdEffectTextures, Textures>();
  private readonly compressed: boolean;
  private lost = false;
  /** The terrain layer and the version of it the two textures hold. */
  private held: { layer: HTMLCanvasElement; version: number } | null = null;

  /** A pass, or null where there is no WebGL to be had. */
  static create(): EffectPass | null {
    if (typeof document === "undefined") return null;
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false });
      return gl ? new EffectPass(canvas, gl) : null;
    } catch {
      return null;
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGLRenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    this.water = this.link(WATER);
    this.heat = this.link(HEAT);
    this.ground = this.texture(false);
    this.mask = this.texture(false);
    this.compressed = gl.getExtension("WEBGL_compressed_texture_s3tc") !== null;
    const corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.lost = true; });
  }

  /** Whether the browser has taken the context back; the caller then makes a new pass, or goes without. */
  get dead(): boolean {
    return this.lost || this.gl.isContextLost();
  }

  private link(fragment: string): Program {
    const { gl } = this;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader did not compile");
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.bindAttribLocation(program, 0, "corner");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "program did not link");
    return { program, uniforms: new Map() };
  }

  private texture(repeat: boolean): WebGLTexture {
    const { gl } = this;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return texture;
  }

  /** Every picture of a sequence as a repeating texture: straight from the file where the card reads DXT1, decoded here where it does not. */
  private sequence(sequence: PictureSequence): WebGLTexture[] {
    const { gl } = this;
    return sequence.pictures.map((picture) => {
      const texture = this.texture(true);
      if (this.compressed) {
        gl.compressedTexImage2D(gl.TEXTURE_2D, 0, DXT1, picture.width, picture.height, 0, sequence.bytes.subarray(picture.data, picture.data + picture.size));
      } else {
        const rgba = new Uint8Array(picture.width * picture.height * 4);
        decodeDxt1(sequence.bytes, picture.data, picture.width, picture.height, rgba, picture.width, 0, 0);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, picture.width, picture.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      }
      return texture;
    });
  }

  private texturesOf(from: HdEffectTextures): Textures {
    let made = this.textures.get(from);
    if (!made) {
      const { gl } = this;
      let noise: WebGLTexture | null = null;
      if (from.noise) {
        noise = this.texture(true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, from.noise.width, from.noise.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, from.noise.rgba);
      }
      made = { large: from.large ? this.sequence(from.large) : [], fine: from.fine ? this.sequence(from.fine) : [], noise };
      this.textures.set(from, made);
    }
    return made;
  }

  private uniform(p: Program, name: string): WebGLUniformLocation | null {
    if (!p.uniforms.has(name)) p.uniforms.set(name, this.gl.getUniformLocation(p.program, name));
    return p.uniforms.get(name)!;
  }

  private bind(p: Program, unit: number, name: string, texture: WebGLTexture): void {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this.uniform(p, name), unit);
  }

  /**
   * The terrain layer with its water or lava moved to `seconds`. `version` says when
   * `layer` and `mask` were last drawn into: they are sent to the card again only when it
   * has changed, so a view that is standing still costs one draw a frame and no upload.
   * Returns this pass's canvas, the size of the layer, or null when it could not be drawn.
   */
  draw(layer: HTMLCanvasElement, mask: HTMLCanvasElement, version: number, effects: HdEffects, view: EffectView, seconds: number, tune: RemasteredEffects): HTMLCanvasElement | null {
    if (this.dead || layer.width === 0 || layer.height === 0) return null;
    const { gl, canvas } = this;
    try {
      if (canvas.width !== layer.width || canvas.height !== layer.height) {
        canvas.width = layer.width;
        canvas.height = layer.height;
        this.held = null;
      }
      if (this.held?.layer !== layer || this.held.version !== version) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.ground);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer);
        gl.bindTexture(gl.TEXTURE_2D, this.mask);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask);
        this.held = { layer, version };
      }

      const textures = this.texturesOf(effects.textures);
      const p = effects.kind === "water" ? this.water : this.heat;
      gl.useProgram(p.program);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.bind(p, 0, "ground", this.ground);
      this.bind(p, 1, "mask", this.mask);
      gl.uniform2f(this.uniform(p, "size"), layer.width / view.scale, layer.height / view.scale);
      gl.uniform2f(this.uniform(p, "origin"), view.originX, view.originY);
      gl.uniform1f(this.uniform(p, "time"), seconds);

      if (effects.kind === "water") {
        if (textures.large.length === 0 || textures.fine.length === 0) return null;
        // Both sequences step together, each round its own length, the pair on either side of now mixed.
        const frame = seconds * tune.rate;
        const pair = (list: WebGLTexture[]) => {
          const i = Math.floor(frame) % list.length;
          return [list[i], list[(i + 1) % list.length]];
        };
        const [largeA, largeB] = pair(textures.large), [fineA, fineB] = pair(textures.fine);
        this.bind(p, 2, "largeA", largeA);
        this.bind(p, 3, "largeB", largeB);
        this.bind(p, 4, "fineA", fineA);
        this.bind(p, 5, "fineB", fineB);
        gl.uniform1f(this.uniform(p, "blend"), frame - Math.floor(frame));
        gl.uniform1f(this.uniform(p, "bend"), tune.bend);
        gl.uniform1f(this.uniform(p, "glint"), tune.glint);
        gl.uniform2f(this.uniform(p, "ripple"), Math.max(1, tune.large), Math.max(1, tune.fine));
      } else {
        if (!textures.noise) return null;
        this.bind(p, 2, "noise", textures.noise);
        gl.uniform1f(this.uniform(p, "reach"), tune.heat);
        gl.uniform1f(this.uniform(p, "grain"), HEAT_GRAIN);
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return canvas;
    } catch {
      // A driver that refuses something here refuses it every frame; stop asking.
      this.lost = true;
      return null;
    }
  }

  /** Give the context back. The pass is of no use afterwards. */
  dispose(): void {
    this.lost = true;
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
