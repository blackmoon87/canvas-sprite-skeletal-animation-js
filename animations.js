/**
 * animations.js
 * ============================================================================
 * Keyframe animation clips for the skeletal rig + a layered Animator.
 *
 * A clip is plain JSON, so it can live in character.json ("animations") or be made in the editor:
 *
 *   {
 *     duration: 1.2,           // seconds
 *     loop: true,
 *     keys: [                  // poses at times: angles in DEGREES,
 *       { t: 0,   pose: { shoulderAbdR: 90 } },        // root and lift offsets as a fraction of leg length,
 *       { t: 0.6, pose: { shoulderAbdR: 150 } }        // 0..1 for plant* / ground
 *     ],
 *     mask: ['armR']           // optional: body groups the clip fully controls (see GROUPS)
 *   }
 *
 * L / R = the limb on the viewer's left / right in the front view (the sprite is mirrored for
 * the other half of the turn, and the rig swaps sides for you).
 * Each value is eased between the keys that set it; missing values keep the pose underneath.
 */

/** Pose fields grouped by body part (a clip's mask resets un-keyed fields of its groups to rest). */
export const GROUPS = {
  root: ['rootX', 'rootY', 'rootZ', 'rootYaw', 'rootPitch', 'rootRoll', 'lift'],
  spine: ['spinePitch', 'spineRoll', 'spineYaw'],
  neck: ['neckPitch', 'neckRoll', 'neckYaw'],
  armL: ['shoulderFlexL', 'shoulderAbdL', 'shoulderTwistL', 'elbowFlexL'],
  armR: ['shoulderFlexR', 'shoulderAbdR', 'shoulderTwistR', 'elbowFlexR'],
  legL: ['hipFlexL', 'hipAbdL', 'hipTwistL', 'kneeFlexL', 'ankleFlexL', 'plantL'],
  legR: ['hipFlexR', 'hipAbdR', 'hipTwistR', 'kneeFlexR', 'ankleFlexR', 'plantR'],
  cloth: ['tabardPitch', 'capePitch']
};
const GROUP_OF = {};
for (const [g, keys] of Object.entries(GROUPS)) for (const k of keys) GROUP_OF[k] = g;

/** Fields that are not angles (no degree conversion). */
const LINEAR = new Set(['rootX', 'rootY', 'rootZ', 'lift', 'plantL', 'plantR', 'ground']);
const toRig = (k, v) => (LINEAR.has(k) ? v : (v * Math.PI) / 180);

const ease = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);

/** Pose (rig units) of a clip at time t (seconds). */
export function sampleClip(clip, t, loop = clip.loop) {
  const tracks = clip._tracks || buildTracks(clip);
  const d = clip.duration;
  const time = loop ? ((t % d) + d) % d : Math.max(0, Math.min(d, t));
  const pose = {};
  for (const [k, track] of Object.entries(tracks)) {
    if (track.length === 1) { pose[k] = toRig(k, track[0].v); continue; }
    let i = track.findIndex((key) => key.t > time);
    let a, b, span, local;
    if (i === -1) {
      // after the last key: hold, or wrap to the first key for loops
      a = track[track.length - 1];
      if (!loop) { pose[k] = toRig(k, a.v); continue; }
      b = { t: track[0].t + d, v: track[0].v };
      span = b.t - a.t; local = time - a.t;
    } else if (i === 0) {
      b = track[0];
      if (!loop) { pose[k] = toRig(k, b.v); continue; }
      a = { t: track[track.length - 1].t - d, v: track[track.length - 1].v };
      span = b.t - a.t; local = time - a.t;
    } else {
      a = track[i - 1]; b = track[i];
      span = b.t - a.t; local = time - a.t;
    }
    const f = span > 0 ? (b.linear ? local / span : ease(local / span)) : 1;
    pose[k] = toRig(k, a.v + (b.v - a.v) * f);
  }
  return pose;
}

function buildTracks(clip) {
  const tracks = {};
  for (const key of clip.keys) {
    for (const [k, v] of Object.entries(key.pose)) {
      (tracks[k] = tracks[k] || []).push({ t: key.t, v, linear: key.linear });
    }
  }
  for (const tr of Object.values(tracks)) tr.sort((a, b) => a.t - b.t);
  Object.defineProperty(clip, '_tracks', { value: tracks, enumerable: false, configurable: true });
  return tracks;
}

/** Groups a clip controls: its mask, or every group it keys. */
export function clipGroups(clip) {
  if (clip.mask) return clip.mask;
  const groups = new Set();
  for (const key of clip.keys) for (const k of Object.keys(key.pose)) if (GROUP_OF[k]) groups.add(GROUP_OF[k]);
  return [...groups];
}

// ---------------------------------------------------------------------------
// Built-in clip library. Moves studied from dance / game reference: waves, cheers, claps,
// pointing, dab, hands on hips, thinking, bow, sit / squat, crouch, jump, kick, leg lift,
// hip sway, step-touch, arms-out groove, victory pump, flinch, look around, slash.
// ---------------------------------------------------------------------------
const both = (pose) => {
  const out = {};
  for (const [k, v] of Object.entries(pose)) { out[k + 'L'] = v; out[k + 'R'] = v; }
  return out;
};
const planted = { plantL: 1, plantR: 1 };

export const CLIPS = {
  'wave-right': {
    duration: 1.2, loop: true, mask: ['armR'],
    keys: [
      { t: 0, pose: { shoulderAbdR: 125, shoulderTwistR: 90, elbowFlexR: 40, shoulderFlexR: 10 } },
      { t: 0.3, pose: { elbowFlexR: 85 } },
      { t: 0.6, pose: { elbowFlexR: 40 } },
      { t: 0.9, pose: { elbowFlexR: 85 } }
    ]
  },
  'wave-left': {
    duration: 1.2, loop: true, mask: ['armL'],
    keys: [
      { t: 0, pose: { shoulderAbdL: 125, shoulderTwistL: 90, elbowFlexL: 40, shoulderFlexL: 10 } },
      { t: 0.3, pose: { elbowFlexL: 85 } },
      { t: 0.6, pose: { elbowFlexL: 40 } },
      { t: 0.9, pose: { elbowFlexL: 85 } }
    ]
  },
  cheer: {
    duration: 0.8, loop: true, mask: ['armL', 'armR', 'root', 'legL', 'legR'],
    keys: [
      { t: 0, pose: { ...both({ shoulderAbd: 150, elbowFlex: 15, shoulderTwist: 90 }), rootY: 0.06, ...planted } },
      { t: 0.4, pose: { ...both({ shoulderAbd: 165, elbowFlex: 5 }), rootY: 0, ...planted } }
    ]
  },
  clap: {
    duration: 0.5, loop: true, mask: ['armL', 'armR'],
    keys: [
      { t: 0, pose: both({ shoulderFlex: 55, shoulderAbd: 12, shoulderTwist: 90, elbowFlex: 35 }) },
      { t: 0.25, pose: both({ shoulderFlex: 60, shoulderAbd: -4, shoulderTwist: 90, elbowFlex: 80 }) }
    ]
  },
  'point-right': {
    duration: 1, loop: true, mask: ['armR', 'neck'],
    keys: [{ t: 0, pose: { shoulderAbdR: 85, shoulderFlexR: 15, elbowFlexR: 5, neckRoll: -8 } }]
  },
  dab: {
    duration: 1.4, loop: false, mask: ['armL', 'armR', 'neck', 'spine'],
    keys: [
      { t: 0, pose: { ...both({ shoulderAbd: 0, elbowFlex: 0, shoulderFlex: 0 }), neckPitch: 0, spineRoll: 0 } },
      { t: 0.25, pose: { shoulderAbdL: 135, elbowFlexL: 5, shoulderFlexR: 70, shoulderAbdR: 20, shoulderTwistR: 90, elbowFlexR: 125, neckPitch: 25, neckRoll: 15, spineRoll: -8 } },
      { t: 1.1, pose: { shoulderAbdL: 135, elbowFlexR: 125 } },
      { t: 1.4, pose: { ...both({ shoulderAbd: 0, elbowFlex: 0, shoulderFlex: 0, shoulderTwist: 0 }), neckPitch: 0, neckRoll: 0, spineRoll: 0 } }
    ]
  },
  'hands-on-hips': {
    duration: 1, loop: true, mask: ['armL', 'armR'],
    keys: [{ t: 0, pose: both({ shoulderAbd: 45, shoulderTwist: 90, elbowFlex: 110, shoulderFlex: -5 }) }]
  },
  think: {
    duration: 2, loop: true, mask: ['armR', 'armL', 'neck'],
    keys: [
      { t: 0, pose: { shoulderFlexR: 35, shoulderAbdR: 10, shoulderTwistR: 30, elbowFlexR: 140, shoulderFlexL: 40, shoulderTwistL: 90, elbowFlexL: 100, shoulderAbdL: 5, neckRoll: 8, neckPitch: 5 } },
      { t: 1, pose: { neckRoll: 12, neckPitch: 10 } }
    ]
  },
  'hand-to-face': {
    duration: 1.6, loop: true, mask: ['armR', 'neck'],
    keys: [
      { t: 0, pose: { shoulderFlexR: 45, shoulderAbdR: 15, shoulderTwistR: 30, elbowFlexR: 145, neckRoll: -10 } },
      { t: 0.8, pose: { neckRoll: -16, neckPitch: 6 } }
    ]
  },
  bow: {
    duration: 1.6, loop: false, mask: ['spine', 'neck', 'armL', 'armR'],
    keys: [
      { t: 0, pose: { spinePitch: 0, neckPitch: 0, ...both({ shoulderFlex: 0, elbowFlex: 0 }) } },
      { t: 0.5, pose: { spinePitch: 45, neckPitch: 15, ...both({ shoulderFlex: -15, elbowFlex: 10 }) } },
      { t: 1.0, pose: { spinePitch: 45 } },
      { t: 1.6, pose: { spinePitch: 0, neckPitch: 0, ...both({ shoulderFlex: 0, elbowFlex: 0 }) } }
    ]
  },
  sit: {
    duration: 0.6, loop: false, hold: true, mask: ['root', 'legL', 'legR', 'spine', 'armL', 'armR'],
    keys: [
      { t: 0, pose: { rootY: 0, spinePitch: 0, ...planted, ...both({ shoulderFlex: 0, elbowFlex: 0 }) } },
      { t: 0.6, pose: { rootY: 0.42, rootZ: -0.12, spinePitch: 22, ...planted, ...both({ shoulderFlex: 40, elbowFlex: 50, shoulderAbd: 10 }) } }
    ]
  },
  crouch: {
    duration: 0.3, loop: false, hold: true, mask: ['root', 'legL', 'legR', 'spine'],
    keys: [
      { t: 0, pose: { rootY: 0, spinePitch: 0, ...planted } },
      { t: 0.3, pose: { rootY: 0.22, spinePitch: 18, ...planted } }
    ]
  },
  jump: {
    duration: 1.15, loop: false, mask: ['root', 'legL', 'legR', 'spine', 'armL', 'armR'],
    keys: [
      { t: 0, pose: { rootY: 0, lift: 0, spinePitch: 0, ...planted, ...both({ shoulderFlex: 0, elbowFlex: 10, hipFlex: 0, kneeFlex: 0 }) } },
      { t: 0.18, pose: { rootY: 0.24, lift: 0, spinePitch: 22, ...planted, ...both({ shoulderFlex: -35, elbowFlex: 20 }) } },
      { t: 0.3, pose: { rootY: 0, lift: 0.15, spinePitch: -4, plantL: 0, plantR: 0, ...both({ shoulderFlex: 120, elbowFlex: 15, ankleFlex: -35 }) } },
      { t: 0.55, pose: { lift: 0.55, ...both({ hipFlex: 55, kneeFlex: 95, ankleFlex: -10, shoulderFlex: 80 }) } },
      { t: 0.8, pose: { lift: 0.12, ...both({ hipFlex: 10, kneeFlex: 20, ankleFlex: -20, shoulderFlex: 40 }) } },
      { t: 0.9, pose: { lift: 0, rootY: 0.2, spinePitch: 15, ...planted, ...both({ hipFlex: 0, kneeFlex: 0, ankleFlex: 0, shoulderFlex: 20, elbowFlex: 30 }) } },
      { t: 1.15, pose: { rootY: 0, spinePitch: 0, ...planted, ...both({ shoulderFlex: 0, elbowFlex: 10 }) } }
    ]
  },
  kick: {
    duration: 0.8, loop: false, mask: ['legR', 'legL', 'armL', 'armR', 'spine'],
    keys: [
      { t: 0, pose: { hipFlexR: 0, kneeFlexR: 0, plantL: 1, spinePitch: 0, ...both({ shoulderAbd: 0, elbowFlex: 0 }) } },
      { t: 0.2, pose: { hipFlexR: 45, kneeFlexR: 100, plantL: 1, spinePitch: -5, ...both({ shoulderAbd: 35, elbowFlex: 40 }) } },
      { t: 0.35, pose: { hipFlexR: 85, kneeFlexR: 5, ankleFlexR: -30, spinePitch: -12 } },
      { t: 0.55, pose: { hipFlexR: 40, kneeFlexR: 80 } },
      { t: 0.8, pose: { hipFlexR: 0, kneeFlexR: 0, ankleFlexR: 0, plantL: 1, spinePitch: 0, ...both({ shoulderAbd: 0, elbowFlex: 0 }) } }
    ]
  },
  'leg-lift': {
    duration: 1.2, loop: true, mask: ['legL', 'legR', 'armL', 'armR', 'root'],
    keys: [
      { t: 0, pose: { hipFlexL: 0, kneeFlexL: 0, plantR: 1, plantL: 1, rootRoll: 0, ...both({ shoulderAbd: 20 }) } },
      { t: 0.4, pose: { hipFlexL: 60, kneeFlexL: 95, ankleFlexL: -20, plantL: 0, plantR: 1, rootRoll: 4, shoulderAbdL: 70, shoulderAbdR: 45, elbowFlexL: 30 } },
      { t: 0.8, pose: { hipFlexL: 0, kneeFlexL: 0, ankleFlexL: 0, plantL: 1, rootRoll: 0, ...both({ shoulderAbd: 20, elbowFlex: 10 }) } }
    ]
  },
  'hip-sway': {
    duration: 1.2, loop: true, mask: ['root', 'legL', 'legR', 'spine', 'neck', 'armL', 'armR'],
    keys: [
      { t: 0, pose: { rootX: -0.09, rootRoll: -5, spineRoll: 9, neckRoll: -6, ...planted, rootY: 0.03, shoulderAbdL: 35, shoulderAbdR: 15, ...both({ elbowFlex: 45, shoulderTwist: 40 }) } },
      { t: 0.6, pose: { rootX: 0.09, rootRoll: 5, spineRoll: -9, neckRoll: 6, ...planted, rootY: 0.03, shoulderAbdL: 15, shoulderAbdR: 35 } }
    ]
  },
  'step-touch': {
    duration: 1.2, loop: true, mask: ['root', 'legL', 'legR', 'armL', 'armR', 'spine'],
    keys: [
      { t: 0, pose: { rootX: -0.06, plantL: 1, plantR: 1, hipAbdR: 0, kneeFlexR: 0, hipFlexR: 0, spineRoll: 4, shoulderAbdL: 40, shoulderAbdR: 10, ...both({ elbowFlex: 60, shoulderFlex: 20 }) } },
      { t: 0.3, pose: { rootX: -0.08, plantR: 0, hipAbdR: 12, hipFlexR: 15, kneeFlexR: 35, rootY: 0.04 } },
      { t: 0.6, pose: { rootX: 0.06, plantL: 1, plantR: 1, hipAbdR: 0, hipFlexR: 0, kneeFlexR: 0, rootY: 0, spineRoll: -4, shoulderAbdL: 10, shoulderAbdR: 40 } },
      { t: 0.9, pose: { rootX: 0.08, plantL: 0, hipAbdL: 12, hipFlexL: 15, kneeFlexL: 35, rootY: 0.04 } },
      { t: 1.2, pose: { plantL: 1, hipAbdL: 0, hipFlexL: 0, kneeFlexL: 0 } }
    ]
  },
  'arms-out-groove': {
    duration: 1, loop: true, mask: ['armL', 'armR', 'root', 'neck', 'legL', 'legR'],
    keys: [
      { t: 0, pose: { ...both({ shoulderAbd: 80, elbowFlex: 10, shoulderTwist: 0 }), rootY: 0.05, neckRoll: 6, ...planted } },
      { t: 0.5, pose: { ...both({ shoulderAbd: 70, elbowFlex: 25 }), rootY: 0, neckRoll: -6, ...planted } }
    ]
  },
  victory: {
    duration: 0.9, loop: true, mask: ['armR', 'root', 'legL', 'legR'],
    keys: [
      { t: 0, pose: { shoulderAbdR: 150, shoulderTwistR: 90, elbowFlexR: 70, rootY: 0.05, ...planted } },
      { t: 0.45, pose: { shoulderAbdR: 165, elbowFlexR: 10, rootY: 0, ...planted } }
    ]
  },
  flinch: {
    duration: 0.6, loop: false, mask: ['spine', 'neck', 'armL', 'armR', 'root'],
    keys: [
      { t: 0, pose: { spinePitch: 0, neckPitch: 0, rootZ: 0, ...both({ shoulderFlex: 0, elbowFlex: 0 }) } },
      { t: 0.12, pose: { spinePitch: -18, neckPitch: -10, rootZ: -0.06, ...both({ shoulderFlex: 60, elbowFlex: 110, shoulderAbd: 15 }) } },
      { t: 0.6, pose: { spinePitch: 0, neckPitch: 0, rootZ: 0, ...both({ shoulderFlex: 0, elbowFlex: 0, shoulderAbd: 0 }) } }
    ]
  },
  'look-around': {
    duration: 3, loop: true, mask: ['neck'],
    keys: [
      { t: 0, pose: { neckYaw: 0, neckRoll: 0 } },
      { t: 0.8, pose: { neckYaw: 30, neckRoll: 6 } },
      { t: 1.6, pose: { neckYaw: -30, neckRoll: -6 } },
      { t: 2.4, pose: { neckYaw: 0, neckRoll: 0 } }
    ]
  },
  slash: {
    duration: 0.45, loop: false, mask: ['armR', 'spine'],
    keys: [
      { t: 0, pose: { shoulderFlexR: 0, elbowFlexR: 0, spineYaw: 0 } },
      { t: 0.12, pose: { shoulderFlexR: 150, shoulderAbdR: 20, elbowFlexR: 40, spineYaw: -15 } },
      { t: 0.27, pose: { shoulderFlexR: 20, shoulderAbdR: -10, elbowFlexR: 5, spineYaw: 20 } },
      { t: 0.45, pose: { shoulderFlexR: 0, shoulderAbdR: 0, elbowFlexR: 0, spineYaw: 0 } }
    ]
  }
};

/**
 * Layered animation player. Layers are applied over a base pose (idle / walk / run from the rig):
 * each clip overrides the fields it keys, fades in / out, and a clip's mask resets the rest of
 * its body groups, so e.g. "wave-right" plays over walking legs.
 */
export class Animator {
  constructor(library = CLIPS) {
    this.library = { ...library };
    this.layers = [];
  }

  addClips(clips) {
    Object.assign(this.library, clips || {});
  }

  /**
   * @param name  clip name (from the library)
   * @param opts  { speed = 1, fade = 0.15, loop = clip.loop, hold = clip.hold, onEnd }
   *              hold: a one-shot stays on its last pose until stop() (e.g. "sit")
   */
  play(name, opts = {}) {
    const clip = typeof name === 'string' ? this.library[name] : name;
    if (!clip) throw new Error(`Unknown animation "${name}"`);
    const clipName = typeof name === 'string' ? name : clip.name || 'clip';
    this.layers = this.layers.filter((l) => l.name !== clipName);
    this.layers.push({
      name: clipName,
      clip,
      time: 0,
      speed: opts.speed ?? 1,
      fade: opts.fade ?? 0.15,
      loop: opts.loop ?? clip.loop ?? false,
      hold: opts.hold ?? clip.hold ?? false,
      weight: 0,
      stopping: false,
      onEnd: opts.onEnd
    });
  }

  stop(name, fade = 0.2) {
    for (const l of this.layers) {
      if (!name || l.name === name) { l.stopping = true; l.fade = fade; }
    }
  }

  isPlaying(name) {
    return this.layers.some((l) => l.name === name && !l.stopping);
  }

  get playing() {
    return this.layers.filter((l) => !l.stopping).map((l) => l.name);
  }

  update(dt) {
    for (const l of this.layers) {
      l.time += dt * l.speed;
      const rate = l.fade > 0 ? dt / l.fade : 1;
      const d = l.clip.duration;
      const ending = !l.loop && !l.hold && l.time >= d - l.fade;
      if (l.stopping || ending) l.weight = Math.max(0, l.weight - rate);
      else l.weight = Math.min(1, l.weight + rate);
      if (!l.loop && !l.hold && l.time >= d && !l.ended) {
        l.ended = true;
        l.onEnd?.();
      }
    }
    this.layers = this.layers.filter((l) => !(l.weight <= 0 && (l.stopping || l.ended)));
  }

  /** Base pose + all layers. */
  apply(base) {
    const out = { ...base };
    for (const l of this.layers) {
      if (l.weight <= 0) continue;
      const sample = sampleClip(l.clip, l.time, l.loop);
      const w = ease(l.weight);
      for (const g of clipGroups(l.clip)) {
        for (const k of GROUPS[g]) if (!(k in sample)) sample[k] = 0;
      }
      for (const [k, v] of Object.entries(sample)) {
        const from = out[k] ?? (k === 'ground' ? 1 : 0);
        out[k] = from + (v - from) * w;
      }
    }
    return out;
  }
}
