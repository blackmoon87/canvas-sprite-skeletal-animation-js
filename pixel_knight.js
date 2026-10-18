/**
 * pixel_knight.js
 * ============================================================================
 * Complete JavaScript Canvas Pixel Processor & 360° Moving Game Object Engine
 * Built for: /Users/blackmoon/Desktop/JS.3D.MESH/img.gif
 *
 * Features:
 * 1. Raw Pixel Buffer Handling (`getImageData` / `putImageData` / `Uint8ClampedArray`)
 * 2. Real-Time 360°-Aware Pixel Skeletal Walk Rig (`synthesizeWalkFrame`):
 *    - Biomechanical alternating left/right leg & boot stride (heel-toe lift + ground plant)
 *    - Side-profile dual-leg scissoring (splits overlapping profile leg into shaded Far Leg + Near Leg)
 *    - Front/Back independent left/right boot lift, knee foreshortening, and perspective foot scale
 *    - Contralateral arm/gauntlet counter-swing & red tabard cloth wave physics
 * 3. Live `img.gif` Frame Decoder (`ImageDecoder` API + 2x2 Bayer De-dither & Border Flood-Fill Keyer)
 * 4. Pre-baked 36-Angle Sprite Sheet Loader (72 effective angles across 360° with horizontal mirror)
 * 5. Pixel-Perfect Collision Detection (`hitTestPixel` checking actual deformed alpha > threshold)
 * 6. Dynamic Pixel Particle & 3D Voxel Point-Cloud Extractor
 */

import { SkeletalRig, KnightSkeletalRig } from './skeletal_rig.js';
import { loadImage, framesFromSheet } from './sprite_tools.js';
import { Animator } from './animations.js';

export class CanvasPixelProcessor {
  static sharedRig = new KnightSkeletalRig();
  /**
   * De-dithers a 2x2 Bayer-ordered GIF frame and removes the studio grey background
   * directly inside an HTML5 Canvas ImageData buffer (Uint8ClampedArray).
   */
  static keyOutStudioBackground(imageData, options = {}) {
    const {
      gradThreshold = 28,
      satThreshold = 12,
      dedither = true
    } = options;

    const w = imageData.width;
    const h = imageData.height;
    const src = imageData.data;
    const dst = new Uint8ClampedArray(src.length);

    if (dedither) {
      for (let y = 0; y < h; y++) {
        const y2 = Math.min(h - 1, y + 1);
        for (let x = 0; x < w; x++) {
          const x2 = Math.min(w - 1, x + 1);
          const i00 = (y * w + x) * 4;
          const i10 = (y * w + x2) * 4;
          const i01 = (y2 * w + x) * 4;
          const i11 = (y2 * w + x2) * 4;

          dst[i00]     = (src[i00]     + src[i10]     + src[i01]     + src[i11]) >> 2;
          dst[i00 + 1] = (src[i00 + 1] + src[i10 + 1] + src[i01 + 1] + src[i11 + 1]) >> 2;
          dst[i00 + 2] = (src[i00 + 2] + src[i10 + 2] + src[i01 + 2] + src[i11 + 2]) >> 2;
          dst[i00 + 3] = 255;
        }
      }
    } else {
      dst.set(src);
    }

    const canBeBg = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        const p = idx * 4;
        const r = dst[p], g = dst[p + 1], b = dst[p + 2];
        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);
        const sat = maxC - minC;
        const mean = (r + g + b) * 0.3333;

        const pL = (y * w + (x - 1)) * 4;
        const pR = (y * w + (x + 1)) * 4;
        const pU = ((y - 1) * w + x) * 4;
        const pD = ((y + 1) * w + x) * 4;

        const gx = Math.abs(dst[pR] - dst[pL]) + Math.abs(dst[pR + 1] - dst[pL + 1]) + Math.abs(dst[pR + 2] - dst[pL + 2]);
        const gy = Math.abs(dst[pD] - dst[pU]) + Math.abs(dst[pD + 1] - dst[pU + 1]) + Math.abs(dst[pD + 2] - dst[pU + 2]);
        const grad = (gx + gy) * 0.3333;

        if (sat <= satThreshold && grad <= gradThreshold && mean > 45 && mean < 185) {
          canBeBg[idx] = 1;
        }
      }
    }

    const visited = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let head = 0, tail = 0;

    const pushSeed = (x, y) => {
      const idx = y * w + x;
      if (!visited[idx]) {
        visited[idx] = 1;
        queue[tail++] = idx;
      }
    };

    for (let x = 0; x < w; x++) {
      pushSeed(x, 0);
      pushSeed(x, 1);
      pushSeed(x, h - 1);
      pushSeed(x, h - 2);
    }
    for (let y = 0; y < h; y++) {
      pushSeed(0, y);
      pushSeed(1, y);
      pushSeed(w - 1, y);
      pushSeed(w - 2, y);
    }

    while (head < tail) {
      const cur = queue[head++];
      const cy = (cur / w) | 0;
      const cx = cur - cy * w;

      const neighbors = [
        cy > 0 ? cur - w : -1,
        cy < h - 1 ? cur + w : -1,
        cx > 0 ? cur - 1 : -1,
        cx < w - 1 ? cur + 1 : -1
      ];

      for (let i = 0; i < 4; i++) {
        const nb = neighbors[i];
        if (nb >= 0 && !visited[nb] && canBeBg[nb]) {
          visited[nb] = 1;
          queue[tail++] = nb;
        }
      }
    }

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        const p = idx * 4;
        if (visited[idx]) {
          dst[p + 3] = 0;
        } else {
          const bgNeighbors = visited[idx - 1] + visited[idx + 1] + visited[idx - w] + visited[idx + w];
          dst[p + 3] = bgNeighbors > 0 ? Math.max(0, 255 - bgNeighbors * 60) : 255;
        }
      }
    }

    return new ImageData(dst, w, h);
  }

  /**
   * 360°-Aware 19-Joint Hierarchical Skeletal Kinematics Synthesizer
   * Delegates to KnightSkeletalRig (skeletal_rig.js) to solve 3D Forward/Inverse
   * Kinematics for Pelvis, Spine, Neck, Head, Shoulders, Elbows, Wrists, Hips,
   * Knees (hinge), Ankles, and Toes, skinning the ImageData buffer per bone.
   */
  static synthesizeWalkFrame(frameOrImageData, walkPhase, walkIntensity, normAngleDeg = 0, jumpZ = 0, attackTimer = 0) {
    const frameObj = frameOrImageData.imageData
      ? frameOrImageData
      : { imageData: frameOrImageData, width: frameOrImageData.width, height: frameOrImageData.height };
    return CanvasPixelProcessor.sharedRig.renderRiggedFrame(
      frameObj,
      walkPhase,
      walkIntensity,
      normAngleDeg,
      jumpZ,
      attackTimer
    );
  }

  /**
   * Decodes frames directly from an animated GIF file (`img.gif`) in the browser
   * using WebCodecs `ImageDecoder` API.
   */
  static async decodeGifToPixelFrames(gifUrl, maxFrames = 36, cropRect = { x: 420, y: 80, w: 400, h: 610 }) {
    const response = await fetch(gifUrl);
    const blob = await response.blob();
    const frames = [];

    const workCanvas = document.createElement('canvas');
    const targetW = 220;
    const targetH = 335;
    workCanvas.width = targetW;
    workCanvas.height = targetH;
    const workCtx = workCanvas.getContext('2d', { willReadFrequently: true });

    if ('ImageDecoder' in window) {
      const decoder = new ImageDecoder({ data: blob.stream(), type: 'image/gif' });
      await decoder.tracks.ready;
      const total = Math.min(156, decoder.tracks.selectedTrack.frameCount || 156);
      const step = Math.max(1, (total - 1) / Math.max(1, maxFrames - 1));

      for (let i = 0; i < maxFrames; i++) {
        const frameIndex = Math.round(i * step);
        const result = await decoder.decode({ frameIndex });
        workCtx.clearRect(0, 0, targetW, targetH);
        workCtx.drawImage(
          result.image,
          cropRect.x, cropRect.y, cropRect.w, cropRect.h,
          0, 0, targetW, targetH
        );
        result.image.close();

        const rawData = workCtx.getImageData(0, 0, targetW, targetH);
        const keyedData = CanvasPixelProcessor.keyOutStudioBackground(rawData);

        const frameCanvas = document.createElement('canvas');
        frameCanvas.width = targetW;
        frameCanvas.height = targetH;
        frameCanvas.getContext('2d').putImageData(keyedData, 0, 0);

        frames.push({
          index: i,
          gifFrame: frameIndex,
          angleDeg: (i / Math.max(1, maxFrames - 1)) * 180,
          canvas: frameCanvas,
          imageData: keyedData,
          width: targetW,
          height: targetH
        });
      }
      decoder.close();
    }
    return frames;
  }

  /**
   * Applies real-time pixel shader effects directly to an ImageData buffer.
   */
  static applyPixelShader(srcImageData, mode = 'normal', time = 0, param = 1) {
    const w = srcImageData.width;
    const h = srcImageData.height;
    const src = srcImageData.data;

    if (mode === 'normal') {
      return srcImageData;
    }

    const out = new ImageData(w, h);
    const dst = out.data;

    if (mode === 'pixelate') {
      const block = Math.max(2, Math.round(param || 6));
      for (let y = 0; y < h; y += block) {
        for (let x = 0; x < w; x += block) {
          const sx = Math.min(w - 1, x + (block >> 1));
          const sy = Math.min(h - 1, y + (block >> 1));
          const sp = (sy * w + sx) * 4;
          const r = src[sp], g = src[sp + 1], b = src[sp + 2], a = src[sp + 3];
          if (a < 20) continue;
          for (let by = 0; by < block && y + by < h; by++) {
            for (let bx = 0; bx < block && x + bx < w; bx++) {
              const dp = ((y + by) * w + (x + bx)) * 4;
              dst[dp] = r;
              dst[dp + 1] = g;
              dst[dp + 2] = b;
              dst[dp + 3] = a;
            }
          }
        }
      }
      return out;
    }

    if (mode === 'edge_neon') {
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = (y * w + x) * 4;
          if (src[i + 3] < 20) continue;
          const iL = (y * w + (x - 1)) * 4;
          const iR = (y * w + (x + 1)) * 4;
          const iU = ((y - 1) * w + x) * 4;
          const iD = ((y + 1) * w + x) * 4;

          const lumL = (src[iL] + src[iL + 1] + src[iL + 2]) * (src[iL + 3] / 255);
          const lumR = (src[iR] + src[iR + 1] + src[iR + 2]) * (src[iR + 3] / 255);
          const lumU = (src[iU] + src[iU + 1] + src[iU + 2]) * (src[iU + 3] / 255);
          const lumD = (src[iD] + src[iD + 1] + src[iD + 2]) * (src[iD + 3] / 255);

          const mag = Math.min(255, Math.hypot(lumR - lumL, lumD - lumU) * 0.8);
          dst[i]     = Math.min(255, src[i] * 0.25 + mag * 0.2);
          dst[i + 1] = Math.min(255, src[i + 1] * 0.25 + mag * 1.1);
          dst[i + 2] = Math.min(255, src[i + 2] * 0.35 + mag * 1.5);
          dst[i + 3] = src[i + 3];
        }
      }
      return out;
    }

    if (mode === 'thermal') {
      for (let i = 0; i < src.length; i += 4) {
        const a = src[i + 3];
        if (a < 20) continue;
        const redness = Math.max(0, src[i] - src[i + 1]);
        const lum = Math.min(1, (0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2] + redness * 1.4) / 255);
        dst[i]     = Math.min(255, Math.floor(255 * Math.pow(lum, 0.7)));
        dst[i + 1] = Math.min(255, Math.floor(255 * Math.pow(lum, 1.8)));
        dst[i + 2] = Math.min(255, Math.floor(255 * (1 - lum) * 0.85));
        dst[i + 3] = a;
      }
      return out;
    }

    if (mode === 'hologram') {
      for (let y = 0; y < h; y++) {
        const scan = (y % 4 === 0) ? 0.55 : 1.0;
        const glitchShift = (Math.sin(y * 0.15 + time * 12) > 0.92) ? ((Math.sin(time * 40) * 6) | 0) : 0;
        for (let x = 0; x < w; x++) {
          const sx = Math.min(w - 1, Math.max(0, x + glitchShift));
          const sp = (y * w + sx) * 4;
          const dp = (y * w + x) * 4;
          const a = src[sp + 3];
          if (a < 20) continue;
          const lum = (src[sp] + src[sp + 1] + src[sp + 2]) * 0.333;
          dst[dp]     = Math.min(255, lum * 0.25 * scan);
          dst[dp + 1] = Math.min(255, (lum * 0.95 + 40) * scan);
          dst[dp + 2] = Math.min(255, (lum * 1.25 + 80) * scan);
          dst[dp + 3] = Math.min(255, a * 0.88);
        }
      }
      return out;
    }

    if (mode === 'hit_flash') {
      const pulse = 0.65 + 0.35 * Math.sin(time * 25);
      for (let i = 0; i < src.length; i += 4) {
        const a = src[i + 3];
        if (a < 20) continue;
        dst[i]     = Math.min(255, src[i] + (255 - src[i]) * pulse);
        dst[i + 1] = Math.min(255, src[i + 1] + (180 - src[i + 1]) * pulse * 0.7);
        dst[i + 2] = Math.min(255, src[i + 2] + (180 - src[i + 2]) * pulse * 0.7);
        dst[i + 3] = a;
      }
      return out;
    }

    dst.set(src);
    return out;
  }

  /**
   * Samples non-transparent pixels from an ImageData buffer into an array of
   * structured pixel objects with 2D coordinates, RGB color, and estimated 3D Z-depth.
   */
  static extractPixelCloud(imageData, step = 3, flipX = false) {
    const w = imageData.width;
    const h = imageData.height;
    const data = imageData.data;
    const pixels = [];
    const halfW = w * 0.5;
    const halfH = h * 0.5;

    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const sx = flipX ? (w - 1 - x) : x;
        const i = (y * w + sx) * 4;
        const a = data[i + 3];
        if (a < 64) continue;

        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

        const nx = (x - halfW) / (halfW * 0.75);
        const cylinderZ = Math.sqrt(Math.max(0, 1 - Math.min(1, nx * nx)));
        const zDepth = (cylinderZ * 28 + (lum - 0.4) * 18);

        pixels.push({
          localX: x - halfW,
          localY: y - halfH,
          gridX: x,
          gridY: y,
          z: zDepth,
          r, g, b, a,
          lum,
          color: `rgb(${r},${g},${b})`
        });
      }
    }
    return pixels;
  }
}

/**
 * GameCharacter — playable 360° game object for ANY rigged character.
 *
 *   const hero = await GameCharacter.load('./characters/knight/character.json');
 *
 * The character profile (made with editor.html) describes the skeleton; its `sprite` field
 * points to the sprite sheet + atlas, relative to the profile file.
 */
export class GameCharacter {
  /**
   * @param options.profile  character profile object (or pass options.rig)
   * @param options.rig      an existing SkeletalRig
   */
  constructor(options = {}) {
    this.x = options.x ?? 450;
    this.y = options.y ?? 340;
    this.z = 0;        // Jump altitude above ground
    this.vz = 0;       // Vertical jump velocity
    this.vx = 0;
    this.vy = 0;
    this.speed = options.speed ?? 280;
    this.runMultiplier = options.runMultiplier ?? 1.7; // speed while input.run is held
    this.scale = options.scale ?? 0.62;
    this.rig = options.rig ?? (options.profile ? new SkeletalRig(options.profile) : CanvasPixelProcessor.sharedRig);

    // Facing angle in degrees:
    // 0 = Front (South), 90 = Right (East), 180 = Back (North), 270 = Left (West)
    this.facingDeg = 0;
    this.targetFacingDeg = 0;
    this.aimWithMouse = false;

    // Biomechanical walk-cycle & combat states
    this.walkPhase = 0;
    this.walkIntensity = 0; // Smooth [0..1] blend between standing and walking
    this.demoWalk = false;  // Walk-in-place toggle for inspecting foot mechanics
    this.isMoving = false;
    this.lastStepFoot = 0;  // Tracks left/right foot plant for synchronized dust puffs
    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.attackTimer = 0;
    this.hitFlashTimer = 0;
    this.afterImages = [];
    this.dustParticles = [];
    this.time = 0;
    this.runAmount = 0;     // 0 = walk .. 1 = run
    this.jumpState = null;  // 'crouch' | 'air' | 'land'
    this.jumpTimer = 0;
    this.poseOverride = null; // a fixed pose (pose editors), replaces movement + animations
    this.animator = new Animator();
    this.animator.addClips(this.rig.profile.animations);

    // Loaded frame buffers (e.g. 36 frames covering 0°..180°)
    this.frames = [];
    this.activeDeformedData = null;
    this.ready = false;
  }

  /**
   * Creates a character from a profile JSON URL (or object + baseUrl) and loads its sprite sheet.
   */
  static async load(profileOrUrl, options = {}) {
    let profile = profileOrUrl;
    let baseUrl = options.baseUrl ?? document.baseURI;
    if (typeof profileOrUrl === 'string') {
      const url = new URL(profileOrUrl, document.baseURI);
      profile = await fetch(url).then(r => r.json());
      baseUrl = url.href;
    }
    const character = new this({ ...options, profile });
    if (profile.sprite) {
      await character.loadFromSpriteSheet(
        new URL(profile.sprite.sheet, baseUrl).href,
        new URL(profile.sprite.atlas, baseUrl).href,
        profile.sprite.labels ? new URL(profile.sprite.labels, baseUrl).href : null
      );
    }
    return character;
  }

  /** Swaps in another character profile (keeps position and state). */
  setProfile(profile) {
    this.rig = new SkeletalRig(profile);
    this.animator.addClips(this.rig.profile.animations);
  }

  /** Uses already-prepared frames (e.g. from sprite_tools.prepareFrames). */
  setFrames(frames) {
    this.frames = frames;
    this.ready = frames.length > 0;
  }

  /** Distance from the draw anchor (75% down the frame) to the floor, in frame pixels. */
  get footOffset() {
    const h = this.frames[0]?.height ?? this.rig.profile.frameHeight;
    return this.rig.floorY - h * 0.75;
  }

  /**
   * Loads a sprite sheet + atlas & slices each frame into its own Canvas + ImageData
   * pixel buffer for instant pixel access.
   */
  async loadFromSpriteSheet(sheetUrl = './characters/knight/knight_spritesheet.png', atlasUrl = './characters/knight/knight_atlas.json', labelsUrl = null) {
    const [atlas, img, labels] = await Promise.all([
      fetch(atlasUrl).then(r => r.json()),
      loadImage(sheetUrl),
      labelsUrl ? loadImage(labelsUrl) : null
    ]);
    this.setFrames(framesFromSheet(img, atlas, labels));
    return this.frames;
  }

  /**
   * Returns the active directional frame and whether it should be horizontally flipped
   * for the current 0..360° facing angle.
   */
  getActiveFrameState() {
    if (!this.frames.length) return null;
    const norm = ((this.facingDeg % 360) + 360) % 360;
    let lookupDeg = norm;
    let flipX = false;

    if (norm > 180) {
      lookupDeg = 360 - norm;
      flipX = true;
    }

    // Nearest frame by its angle (frames don't have to be evenly spaced)
    let idx = 0;
    let best = Infinity;
    for (let i = 0; i < this.frames.length; i++) {
      const a = this.frames[i].angleDeg ?? (i / Math.max(1, this.frames.length - 1)) * 180;
      const d = Math.abs(a - lookupDeg);
      if (d < best) { best = d; idx = i; }
    }

    return {
      frame: this.frames[idx],
      frameIndex: idx,
      flipX,
      normAngle: norm
    };
  }

  /**
   * The pose the character has right now: idle breathing / walk / run from the rig, jump
   * crouch-air-land, plus every animation clip playing on top (see play()).
   */
  currentPose() {
    if (this.poseOverride) return this.poseOverride;
    const rig = this.rig;
    const w = this.walkIntensity;
    const base = rig.gaitPose(this.walkPhase, w, this.runAmount);
    const idle = rig.idlePose(this.time, 1 - w);
    const plant = Math.pow(1 - w, 3);
    for (const [k, v] of Object.entries(idle)) {
      if (k === 'ground') continue;
      base[k] = (base[k] || 0) + v * (k.startsWith('plant') ? plant : 1);
    }

    // Jump: crouch before take-off, tuck in the air, absorb the landing
    const mix = (pose, weight) => {
      if (weight <= 0) return;
      for (const [k, v] of Object.entries(pose)) {
        const from = base[k] ?? (k === 'ground' ? 1 : 0);
        base[k] = from + (v - from) * weight;
      }
    };
    const crouch = {
      rootY: 0.22, spinePitch: 0.35, plantL: 1, plantR: 1,
      shoulderFlexL: -0.6, shoulderFlexR: -0.6, elbowFlexL: 0.3, elbowFlexR: 0.3
    };
    if (this.jumpState === 'crouch') mix(crouch, Math.min(1, (0.12 - this.jumpTimer) / 0.08));
    if (this.jumpState === 'land') mix(crouch, Math.min(1, this.jumpTimer / 0.16) * 0.8);
    if (this.z > 0.5) {
      const rising = this.vz > 0;
      mix({
        ground: 0, plantL: 0, plantR: 0,
        hipFlexL: rising ? 0.9 : 0.35, hipFlexR: rising ? 0.7 : 0.25,
        kneeFlexL: rising ? 1.6 : 0.6, kneeFlexR: rising ? 1.3 : 0.5,
        ankleFlexL: -0.4, ankleFlexR: -0.4,
        shoulderFlexL: rising ? 2.0 : 0.9, shoulderFlexR: rising ? 2.0 : 0.9,
        elbowFlexL: 0.25, elbowFlexR: 0.25,
        spinePitch: rising ? -0.05 : 0.12,
        tabardPitch: rising ? -0.3 : 0.4, capePitch: rising ? 0.3 : -0.4
      }, Math.min(1, this.z / 20));
    }
    return this.animator.apply(base);
  }

  /** Current skinned ImageData (padded, see rig.pad). */
  getCurrentWalkImageData() {
    const st = this.getActiveFrameState();
    if (!st) return null;
    return this.rig.renderPose(st.frame, this.currentPose(), st.normAngle);
  }

  /**
   * Plays an animation clip over the current movement, e.g. 'wave-right', 'jump', 'sit', 'dance'.
   * See animations.js CLIPS for the built-in list; profiles can add their own ("animations").
   * @param opts { speed, fade, loop, hold, onEnd }
   */
  play(name, opts = {}) {
    this.animator.play(name, opts);
  }

  /** Stops one clip (or all clips when no name is given). */
  stop(name, fade) {
    this.animator.stop(name, fade);
  }

  /** Names of all animation clips this character can play. */
  get animations() {
    return Object.keys(this.animator.library);
  }

  dash(dirX, dirY) {
    if (this.dashCooldown > 0) return false;
    this.dashTimer = 0.22;
    this.dashCooldown = 0.65;
    const len = Math.hypot(dirX, dirY) || 1;
    this.vx = (dirX / len) * this.speed * 3.1;
    this.vy = (dirY / len) * this.speed * 3.1;
    return true;
  }

  /** Jumps with a short crouch first (take-off happens after 0.12 s). */
  jump() {
    if (this.z <= 0.5 && this.jumpState !== 'crouch') {
      this.jumpState = 'crouch';
      this.jumpTimer = 0.12;
      return true;
    }
    return false;
  }

  attack() {
    if (this.attackTimer <= 0) {
      this.attackTimer = 0.42;
      this.play('slash', { fade: 0.05 });
      return true;
    }
    return false;
  }

  /**
   * Updates physics, 360° rotational facing, biomechanical leg-stride phase, and footstep dust.
   */
  update(dt, input = {}, bounds = { width: 960, height: 600 }) {
    this.time += dt;
    this.animator.update(dt);
    if (this.jumpState === 'crouch') {
      this.jumpTimer -= dt;
      if (this.jumpTimer <= 0) {
        this.jumpState = 'air';
        this.vz = 430;
        this.z = Math.max(this.z, 0.6);
      }
    } else if (this.jumpState === 'land') {
      this.jumpTimer -= dt;
      if (this.jumpTimer <= 0) this.jumpState = null;
    }
    if (this.dashCooldown > 0) this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    if (this.hitFlashTimer > 0) this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);

    let moveX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let moveY = (input.down ? 1 : 0) - (input.up ? 1 : 0);

    if (moveX === 0 && moveY === 0 && input.targetPos) {
      const dx = input.targetPos.x - this.x;
      const dy = input.targetPos.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 10) {
        moveX = dx / dist;
        moveY = dy / dist;
      } else {
        input.targetPos = null;
      }
    }

    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      if (Math.random() < 0.75) {
        const st = this.getActiveFrameState();
        if (st) {
          this.afterImages.push({
            x: this.x,
            y: this.y,
            z: this.z,
            frame: st.frame,
            flipX: st.flipX,
            alpha: 0.65
          });
        }
      }
    } else {
      const len = Math.hypot(moveX, moveY);
      if (len > 0.01) {
        const nx = moveX / len;
        const ny = moveY / len;
        const speed = this.speed * (input.run ? this.runMultiplier : 1);
        this.vx += (nx * speed - this.vx) * Math.min(1, dt * 14);
        this.vy += (ny * speed - this.vy) * Math.min(1, dt * 14);
        this.isMoving = true;
      } else {
        this.vx *= Math.pow(0.001, dt);
        this.vy *= Math.pow(0.001, dt);
        if (Math.hypot(this.vx, this.vy) < 5) {
          this.vx = 0;
          this.vy = 0;
        }
        this.isMoving = false;
      }
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const marginX = 55;
    const marginY = 65;
    this.x = Math.max(marginX, Math.min(bounds.width - marginX, this.x));
    this.y = Math.max(marginY, Math.min(bounds.height - 35, this.y));

    // Jump Z physics
    if (this.z > 0 || this.vz !== 0) {
      this.z += this.vz * dt;
      this.vz -= 1150 * dt;
      if (this.z <= 0) {
        this.z = 0;
        this.vz = 0;
        if (this.jumpState === 'air') {
          this.jumpState = 'land';
          this.jumpTimer = 0.16;
        }
      }
    }

    // Determine target 360° facing angle
    if (this.attackTimer > 0) {
      this.attackTimer = Math.max(0, this.attackTimer - dt);
      this.facingDeg = (this.facingDeg + dt * 1080) % 360;
    } else if (this.aimWithMouse && input.mousePos) {
      const dx = input.mousePos.x - this.x;
      const dy = input.mousePos.y - (this.y - 40);
      this.targetFacingDeg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
      this.facingDeg = this._lerpAngle(this.facingDeg, this.targetFacingDeg, Math.min(1, dt * 16));
    } else if (Math.hypot(this.vx, this.vy) > 15) {
      this.targetFacingDeg = ((Math.atan2(this.vx, this.vy) * 180) / Math.PI + 360) % 360;
      this.facingDeg = this._lerpAngle(this.facingDeg, this.targetFacingDeg, Math.min(1, dt * 14));
    }

    // Biomechanical walk-cycle progression & foot-strike dust synchronization
    const speedMag = Math.hypot(this.vx, this.vy);
    const shouldWalk = (speedMag > 15 || this.demoWalk) && this.z === 0;
    // Run when moving clearly faster than walking speed (e.g. input.run or a dash)
    const runTarget = this.dashTimer > 0 || speedMag > this.speed * 1.25 ? 1 : 0;
    this.runAmount += (runTarget - this.runAmount) * Math.min(1, dt * 6);

    if (shouldWalk) {
      const effectiveSpeed = speedMag > 15 ? speedMag : this.speed * 0.82;
      this.walkIntensity = Math.min(1.0, this.walkIntensity + dt * 9.0);
      // Advance the gait so one cycle covers exactly two strides on screen: the planted foot
      // stays put on the ground instead of skating
      const cycleLength = this.rig.strideCycleLength(this.walkIntensity, this.runAmount) * this.scale;
      this.walkPhase = (this.walkPhase + dt * effectiveSpeed * (Math.PI * 2) / cycleLength) % (Math.PI * 2);

      // Emit dust puff at heel strike (left heel strikes at phase π/2, right heel at 3π/2)
      const currentFoot = Math.cos(this.walkPhase) >= 0 ? 1 : -1;
      if (currentFoot !== this.lastStepFoot) {
        this.lastStepFoot = currentFoot;
        const footOffsetX = (currentFoot < 0 ? -14 : 14) * this.scale;
        for (let i = 0; i < 4; i++) {
          this.dustParticles.push({
            x: this.x + footOffsetX + (Math.random() - 0.5) * 14,
            y: this.y + this.footOffset * this.scale + (Math.random() - 0.5) * 6,
            vx: -this.vx * 0.18 + (Math.random() - 0.5) * 38,
            vy: -12 - Math.random() * 28,
            size: 3 + Math.random() * 4,
            alpha: 0.8,
            color: Math.random() < 0.35 ? '#c94a4a' : '#94a3b8'
          });
        }
      }
    } else {
      this.walkIntensity = Math.max(0.0, this.walkIntensity - dt * 7.5);
    }

    for (let i = this.afterImages.length - 1; i >= 0; i--) {
      this.afterImages[i].alpha -= dt * 2.8;
      if (this.afterImages[i].alpha <= 0) this.afterImages.splice(i, 1);
    }
    for (let i = this.dustParticles.length - 1; i >= 0; i--) {
      const p = this.dustParticles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.alpha -= dt * 1.6;
      if (p.alpha <= 0) this.dustParticles.splice(i, 1);
    }
  }

  _lerpAngle(current, target, t) {
    const diff = ((target - current + 540) % 360) - 180;
    return (current + diff * t + 360) % 360;
  }

  /**
   * Pixel-Perfect Collision Test against the live deformed walk-cycle ImageData!
   */
  hitTestPixel(wx, wy) {
    const st = this.getActiveFrameState();
    if (!st) return false;
    const { frame, flipX } = st;
    const img = this.activeDeformedData || this.rig.paddedFrame(frame);
    const pad = img.pad || 0;
    const topLeftX = this.x - (frame.width * 0.5 + pad) * this.scale;
    const topLeftY = (this.y - this.z) - (frame.height * 0.75 + pad) * this.scale;

    let localX = Math.floor((wx - topLeftX) / this.scale);
    const localY = Math.floor((wy - topLeftY) / this.scale);
    if (localX < 0 || localY < 0 || localX >= img.width || localY >= img.height) return false;
    if (flipX) localX = img.width - 1 - localX;
    return img.data[(localY * img.width + localX) * 4 + 3] > 45;
  }

  /**
   * Renders the knight with 19-Joint hierarchical bone skinning, shadows, and optional Skeleton Gizmo.
   */
  draw(ctx, options = {}) {
    const st = this.getActiveFrameState();
    if (!st) return;
    const { frame, flipX, normAngle } = st;
    const {
      shaderMode = 'normal',
      time = 0,
      pixelBlockSize = 6,
      showHitbox = false,
      showSkeleton = false
    } = options;

    const drawW = frame.width * this.scale;
    const drawH = frame.height * this.scale;

    // 1. Dynamic Ground Contact Shadows
    const shadowScale = Math.max(0.35, 1 - this.z / 260);
    ctx.save();
    ctx.translate(this.x, this.y + this.footOffset * this.scale);
    ctx.scale(shadowScale, shadowScale * 0.38);
    const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, drawW * 0.42);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.60)');
    grad.addColorStop(0.65, 'rgba(0, 0, 0, 0.25)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, drawW * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 2. Dash pixel after-images
    for (const ghost of this.afterImages) {
      ctx.save();
      ctx.globalAlpha = ghost.alpha * 0.55;
      ctx.translate(ghost.x, ghost.y - ghost.z);
      if (ghost.flipX) ctx.scale(-1, 1);
      ctx.filter = 'hue-rotate(170deg) saturate(220%) brightness(1.3)';
      ctx.drawImage(ghost.frame.canvas, -drawW * 0.5, -drawH * 0.75, drawW, drawH);
      ctx.restore();
    }

    // 3. Footstep pixel dust
    for (const p of this.dustParticles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size * 0.5, p.y - p.size * 0.5, p.size, p.size);
      ctx.restore();
    }

    // 4. Solve the skeletal rig for the current pose & skin the pixel buffer (padded canvas)
    const walkImageData = this.rig.renderPose(frame, this.currentPose(), normAngle);
    this.activeDeformedData = walkImageData;
    const pad = walkImageData.pad || 0;
    const imgW = walkImageData.width * this.scale;
    const imgH = walkImageData.height * this.scale;
    const imgX = -(frame.width * 0.5 + pad) * this.scale;
    const imgY = -(frame.height * 0.75 + pad) * this.scale;

    const effectiveShader = this.hitFlashTimer > 0 ? 'hit_flash' : shaderMode;
    const finalImageData = CanvasPixelProcessor.applyPixelShader(
      walkImageData,
      effectiveShader,
      time,
      pixelBlockSize
    );

    if (!this._renderCanvas) {
      this._renderCanvas = document.createElement('canvas');
    }
    if (this._renderCanvas.width !== walkImageData.width || this._renderCanvas.height !== walkImageData.height) {
      this._renderCanvas.width = walkImageData.width;
      this._renderCanvas.height = walkImageData.height;
    }
    this._renderCanvas.getContext('2d').putImageData(finalImageData, 0, 0);

    ctx.save();
    ctx.translate(this.x, this.y - this.z);
    if (flipX) ctx.scale(-1, 1);
    ctx.imageSmoothingEnabled = effectiveShader !== 'pixelate';
    ctx.drawImage(this._renderCanvas, imgX, imgY, imgW, imgH);
    ctx.restore();

    // 5. Spin-attack shockwave ring
    if (this.attackTimer > 0) {
      const progress = 1 - (this.attackTimer / 0.42);
      const radius = 35 + progress * 115;
      ctx.save();
      ctx.translate(this.x, this.y - this.z + 10);
      ctx.scale(1, 0.55);
      ctx.strokeStyle = `rgba(248, 113, 113, ${1 - progress})`;
      ctx.lineWidth = 6 * (1 - progress) + 2;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 6. Optional Pixel-Perfect Deformed Hitbox Overlay
    if (showHitbox) {
      const topLeftX = this.x - drawW * 0.5;
      const topLeftY = (this.y - this.z) - drawH * 0.75;
      ctx.save();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(topLeftX, topLeftY, drawW, drawH);
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(56, 189, 248, 0.65)';
      const step = 10;
      const iw = walkImageData.width;
      for (let py = 0; py < walkImageData.height; py += step) {
        for (let px = 0; px < iw; px += step) {
          const sx = flipX ? (iw - 1 - px) : px;
          const a = walkImageData.data[(py * iw + sx) * 4 + 3];
          if (a > 45) {
            ctx.fillRect(this.x + imgX + px * this.scale - 1, this.y - this.z + imgY + py * this.scale - 1, 2.5, 2.5);
          }
        }
      }
      ctx.restore();
    }

    // 7. Optional 19-Joint Spine2D Bone & Joint Skeleton Overlay
    if (showSkeleton || showHitbox) {
      this.rig.drawDebugSkeleton(ctx, this.x, this.y - this.z, this.scale, flipX);
    }
  }
}

/** The included knight (kept for backwards compatibility): same as GameCharacter with the knight rig. */
export class PixelKnight extends GameCharacter {}
