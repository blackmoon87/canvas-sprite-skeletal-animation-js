/**
 * skeletal_rig.js
 * ============================================================================
 * Profile-driven 3D-projected bone rig + layered pixel skinning for ANY biped sprite.
 *
 * A character is described by a JSON "character profile" (see KNIGHT_PROFILE and
 * README "Character profile"): joint positions measured on the sprite, segmentation sizes,
 * cloth colors and gait style. Make one for your own sprite with editor.html.
 *
 * Skeleton (character space, +X = viewer Left->Right at 0°, +Y = Down, +Z = Forward):
 * - Pelvis (Root) -> Spine -> Neck -> HeadTop
 * - Shoulder L/R -> Elbow L/R -> Wrist L/R
 * - Hip L/R -> Knee L/R (Hinge) -> Ankle L/R -> Toe L/R + Heel L/R (ground contact)
 * - Tabard (front cloth) & Cape (back cloth), both hanging from the belt
 *
 * Skinning works in layers. Every sprite frame is segmented once (cached) into
 * body-part labels using the rest pose projected at that frame's real turntable
 * angle: arms are found with capsules around the arm bones, cloth by color and split
 * into front tabard / back cape, and legs per side. Each layer then inverse-warps only
 * the pixels carrying its own label and the layers are painted back-to-front, so a part
 * can never drag pixels of another.
 */

export const JOINT_PARENTS = {
  pelvis: null,
  spine: 'pelvis',
  neck: 'spine',
  headTop: 'neck',
  shoulderL: 'spine', elbowL: 'shoulderL', wristL: 'elbowL',
  shoulderR: 'spine', elbowR: 'shoulderR', wristR: 'elbowR',
  tabardRoot: 'pelvis', tabardTip: 'tabardRoot',
  capeRoot: 'pelvis', capeTip: 'capeRoot',
  hipL: 'pelvis', kneeL: 'hipL', ankleL: 'kneeL', toeL: 'ankleL', heelL: 'ankleL',
  hipR: 'pelvis', kneeR: 'hipR', ankleR: 'kneeR', toeR: 'ankleR', heelR: 'ankleR'
};
export const JOINT_NAMES = Object.keys(JOINT_PARENTS);

/** Joints of the left side and their right-side twins (for symmetric editing). */
export const MIRROR_JOINTS = {
  shoulderL: 'shoulderR', elbowL: 'elbowR', wristL: 'wristR',
  hipL: 'hipR', kneeL: 'kneeR', ankleL: 'ankleR', toeL: 'toeR', heelL: 'heelR'
};

export const SEGMENT_LABELS = {
  NONE: 0, TORSO: 1, HEAD: 2, FILL: 3,
  ARM_L: 4, ARM_R: 5,
  LEG_L: 6, LEG_R: 7, LEGS: 8,
  CLOTH_F: 9, CLOTH_B: 10
};
const LBL = SEGMENT_LABELS;

export const DEFAULT_GAIT = {
  hipAmplitude: 0.5,   // rad, thigh swing at full walk intensity
  kneeFlex: 1.05,      // rad, peak knee bend in swing
  footRoll: 1,         // heel-strike / toe-off strength
  armSwing: 0.38,      // rad, shoulder swing
  elbowFlex: 0.38,     // rad, extra elbow bend when the arm is forward
  lean: 0.07,          // rad, forward spine lean while walking
  pelvisYaw: 0.12,     // rad, pelvis twist with the stride
  tabardPush: 0.75,    // how much the forward thigh pushes the front cloth
  capeTrail: 0.16,     // rad, how far the back cloth trails behind
  cameraTilt: 0.22     // fake top-down camera: points moving toward the camera rise on screen
};

/**
 * The included knight. Joint positions are absolute: x / y are pixels in the front (0°) frame,
 * z is the forward offset from the pelvis in pixels as seen in the side (90°) frame.
 */
export const KNIGHT_PROFILE = {
  version: 1,
  name: 'Knight',
  frameWidth: 220,
  frameHeight: 335,
  sprite: { sheet: 'knight_spritesheet.png', atlas: 'knight_atlas.json' },
  joints: {
    pelvis: { x: 116, y: 232, z: 0 },
    spine: { x: 116, y: 194, z: 0 },
    neck: { x: 116, y: 148, z: 0 },
    headTop: { x: 116, y: 12, z: 2 },
    shoulderL: { x: 64, y: 158, z: -26 }, elbowL: { x: 46, y: 195, z: -22 }, wristL: { x: 31, y: 230, z: -20 },
    shoulderR: { x: 168, y: 158, z: -26 }, elbowR: { x: 186, y: 195, z: -22 }, wristR: { x: 201, y: 230, z: -20 },
    tabardRoot: { x: 116, y: 212, z: 12 }, tabardTip: { x: 116, y: 280, z: 16 },
    capeRoot: { x: 116, y: 208, z: -26 }, capeTip: { x: 116, y: 282, z: -30 },
    hipL: { x: 92, y: 238, z: 0 }, kneeL: { x: 84, y: 278, z: 2 }, ankleL: { x: 82, y: 305, z: 0 },
    toeL: { x: 82, y: 317, z: 52 }, heelL: { x: 82, y: 318, z: -12 },
    hipR: { x: 140, y: 238, z: 0 }, kneeR: { x: 148, y: 278, z: 2 }, ankleR: { x: 150, y: 305, z: 0 },
    toeR: { x: 150, y: 317, z: 52 }, heelR: { x: 150, y: 318, z: -12 }
  },
  // Sprite frames are sampled uniformly from the GIF, but the turntable does not rotate
  // uniformly. Measured from the sprite's hand / shoulder positions: frame angle -> real yaw.
  yawTable: [
    [0, 0], [20, 12], [46, 38], [67, 57], [77, 71], [87, 83],
    [93, 93], [103, 109], [113, 121], [134, 150], [160, 170], [180, 180]
  ],
  // The chibi arms do not follow a rigid 3D shoulder model (the far arm stays wide until it
  // disappears behind the body), so their rest x positions are measured per angle:
  // [frameAngle, shoulderL.x, wristL.x, shoulderR.x, wristR.x, farArmVisible]
  armTable: [
    [0, 62, 35, 168, 200, 1], [20, 60, 35, 172, 197, 1], [46, 62, 45, 170, 190, 1],
    [67, 70, 52, 162, 175, 1], [77, 80, 70, 150, 160, 0], [87, 90, 85, 140, 150, 0],
    [93, 90, 100, 130, 140, 0], [103, 110, 125, 110, 120, 0], [113, 120, 142, 100, 100, 0],
    [134, 145, 180, 75, 55, 1], [160, 165, 197, 62, 45, 1], [180, 168, 202, 62, 40, 1]
  ],
  segmentation: {
    upperArmRadius: 17,
    forearmRadius: 17,
    handRadius: 19,
    handLength: 16,
    legRadius: 30,
    // The chibi thighs are hidden under the chainmail skirt, which stays with the pelvis;
    // only the greaves and boots below it are moved by the leg bones.
    legTopSide: 22,
    legTopFront: 16,
    // > 0: arms are grown from their bones and stop at color edges of this strength (for arms that
    // touch the body); 0 = plain capsules (fine for armored / separated arms like the knight's)
    armEdges: 0
  },
  cloth: { mode: 'dominantRed', minOverGreen: 22, minOverBlue: 12, colors: [], tolerance: 40 },
  gait: { ...DEFAULT_GAIT }
};

/** Character height in pixels (head top to sole) of a profile. */
function profileHeight(joints) {
  return Math.max(1, Math.max(joints.heelL.y, joints.toeL.y) - joints.headTop.y);
}

/**
 * Fills in defaults for a (possibly partial / older) profile. Segmentation sizes that are not
 * given are scaled from the knight by character height, so small sprites work too.
 */
export function normalizeProfile(profile) {
  const p = JSON.parse(JSON.stringify(profile));
  p.version = p.version ?? 1;
  p.name = p.name ?? 'Character';
  for (const name of JOINT_NAMES) {
    if (!p.joints?.[name]) throw new Error(`Character profile is missing joint "${name}"`);
    p.joints[name].z = p.joints[name].z ?? 0;
  }
  p.frameWidth = p.frameWidth ?? 220;
  p.frameHeight = p.frameHeight ?? 335;
  p.yawTable = p.yawTable ?? null;
  p.armTable = p.armTable ?? null;

  const unit = profileHeight(p.joints) / profileHeight(KNIGHT_PROFILE.joints);
  const seg = {};
  for (const [k, v] of Object.entries(KNIGHT_PROFILE.segmentation)) seg[k] = v * unit;
  p.segmentation = { ...seg, ...(p.segmentation || {}) };
  p.cloth = { ...KNIGHT_PROFILE.cloth, mode: 'none', ...(p.cloth || {}) };
  p.gait = { ...DEFAULT_GAIT, ...(p.gait || {}) };
  p.animations = p.animations ?? {};
  return p;
}

/** Profile -> readable JSON text (one line per joint / table row). */
export function serializeProfile(profile) {
  const round = (v) => Math.round(v * 100) / 100;
  const lines = ['{'];
  const entries = Object.entries(profile);
  entries.forEach(([key, value], i) => {
    const comma = i < entries.length - 1 ? ',' : '';
    if (key === 'joints') {
      lines.push('  "joints": {');
      const names = Object.keys(value);
      names.forEach((n, k) => {
        const { x, y, z } = value[n];
        lines.push(`    "${n}": { "x": ${round(x)}, "y": ${round(y)}, "z": ${round(z ?? 0)} }${k < names.length - 1 ? ',' : ''}`);
      });
      lines.push(`  }${comma}`);
    } else if (Array.isArray(value) && value.length && Array.isArray(value[0])) {
      lines.push(`  "${key}": [`);
      value.forEach((row, k) => lines.push(`    ${JSON.stringify(row.map(round))}${k < value.length - 1 ? ',' : ''}`));
      lines.push(`  ]${comma}`);
    } else if (key === 'animations' && value && Object.keys(value).length) {
      const text = JSON.stringify(value, null, 2).split('\n').map((l, k) => (k ? '  ' + l : l)).join('\n');
      lines.push(`  "${key}": ${text}${comma}`);
    } else {
      lines.push(`  "${key}": ${JSON.stringify(value)}${comma}`);
    }
  });
  lines.push('}');
  return lines.join('\n') + '\n';
}

function interpTable(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const k = (x - table[i - 1][0]) / (table[i][0] - table[i - 1][0]);
      return table[i - 1][1] + (table[i][1] - table[i - 1][1]) * k;
    }
  }
  return table[table.length - 1][1];
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

// 3x3 rotation matrices (row-major). rotX: +angle moves a downward bone (+Y) forward (+Z);
// rotY: turns +X toward -Z; rotZ: +angle moves a downward bone toward -X.
function rotX(t) { const c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, c, -s, 0, s, c]; }
function rotY(t) { const c = Math.cos(t), s = Math.sin(t); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
function rotZ(t) { const c = Math.cos(t), s = Math.sin(t); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
function mat3Mul(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return o;
}
function mat3Apply(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2]
  ];
}

/**
 * Two-bone IK (hip -> knee -> ankle): places the middle joint so the chain reaches `target`,
 * bending toward `bendDir` (the knee points forward).
 */
function solveTwoBoneIK(start, target, a, b, bendDir) {
  let dx = target.x - start.x, dy = target.y - start.y, dz = target.z - start.z;
  const dist = Math.hypot(dx, dy, dz) || 1e-6;
  const d = Math.min(dist, (a + b) * 0.999);
  const ux = dx / dist, uy = dy / dist, uz = dz / dist;
  // bend direction perpendicular to the chain
  const dot = bendDir[0] * ux + bendDir[1] * uy + bendDir[2] * uz;
  let vx = bendDir[0] - dot * ux, vy = bendDir[1] - dot * uy, vz = bendDir[2] - dot * uz;
  const vl = Math.hypot(vx, vy, vz) || 1;
  vx /= vl; vy /= vl; vz /= vl;
  const cosA = Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  return {
    mid: { x: start.x + a * (cosA * ux + sinA * vx), y: start.y + a * (cosA * uy + sinA * vy), z: start.z + a * (cosA * uz + sinA * vz) },
    end: { x: start.x + d * ux, y: start.y + d * uy, z: start.z + d * uz }
  };
}

function smoothBump(v, power = 1) {
  return Math.pow(Math.max(0, v), power);
}

export class SkeletalRig {
  /** @param profile character profile object (see KNIGHT_PROFILE); defaults to the knight */
  constructor(profile = KNIGHT_PROFILE) {
    this.profile = normalizeProfile(profile);
    const pj = this.profile.joints;

    // Absolute profile joints -> bone offsets relative to the parent joint
    this.restJoints = {};
    for (const name of JOINT_NAMES) {
      const parent = JOINT_PARENTS[name];
      const a = pj[name];
      const b = parent ? pj[parent] : { x: a.x, y: a.y, z: 0 };
      this.restJoints[name] = { x: a.x - b.x, y: a.y - b.y, z: parent ? a.z - b.z : 0, parent };
    }
    this.originX = pj.pelvis.x;
    this.originY = pj.pelvis.y;
    this.unit = profileHeight(pj) / profileHeight(KNIGHT_PROFILE.joints);

    const len = (a, b) => Math.hypot(pj[a].x - pj[b].x, pj[a].y - pj[b].y, (pj[a].z ?? 0) - (pj[b].z ?? 0));
    this._thighLen = { L: len('hipL', 'kneeL'), R: len('hipR', 'kneeR') };
    this._shinLen = { L: len('kneeL', 'ankleL'), R: len('kneeR', 'ankleR') };
    this.legLength = Math.max(pj.heelL.y, pj.toeL.y) - pj.hipL.y;

    this.pose = SkeletalRig.zeroPose();
    this.joints2D = {};
    this._segCache = new WeakMap();
    this._rest3D = this._solveFK(SkeletalRig.zeroPose());
    this._restSole = Math.max(this._rest3D.heelL.y, this._rest3D.toeL.y);
    this.floorY = this.originY + this._restSole;
  }

  static POSES_PER_CYCLE = 32;
  static POSE_CACHE_SIZE = 120; // ~35 MB of 220x335 frames

  /**
   * A pose is a flat object of joint controls (radians, root offsets as a fraction of leg length).
   * Every field is optional; missing fields are 0 (rest pose), except `ground` (default 1).
   *
   * L / R = the limb on the viewer's left / right in the front (0°) view.
   * - root*:      rootX / rootY / rootZ (sideways / down / forward), rootYaw / rootPitch / rootRoll
   * - lift:       raises the whole body after ground contact (jumps), fraction of leg length
   * - spine*:     spinePitch (+ = lean forward), spineRoll, spineYaw
   * - neck*:      neckPitch (+ = look down), neckRoll, neckYaw
   * - shoulder*:  shoulderFlex (+ = raise forward), shoulderAbd (+ = raise to the side), shoulderTwist
   * - elbowFlex:  + = bend
   * - hip*:       hipFlex (+ = thigh forward), hipAbd (+ = leg out to the side), hipTwist
   * - kneeFlex:   + = bend (backward only)
   * - ankleFlex:  + = toes up
   * - plantL / plantR: 0..1, keep that foot planted where it stands (legs bend to reach it)
   * - ground:     0..1, how strongly the lowest foot is kept on the floor
   * - tabardPitch / capePitch: cloth swing
   */
  static zeroPose() {
    return { ground: 1 };
  }

  static POSE_KEYS = [
    'rootX', 'rootY', 'rootZ', 'rootYaw', 'rootPitch', 'rootRoll', 'lift',
    'spinePitch', 'spineRoll', 'spineYaw', 'neckPitch', 'neckRoll', 'neckYaw',
    'shoulderFlexL', 'shoulderAbdL', 'shoulderTwistL', 'elbowFlexL',
    'shoulderFlexR', 'shoulderAbdR', 'shoulderTwistR', 'elbowFlexR',
    'hipFlexL', 'hipAbdL', 'hipTwistL', 'kneeFlexL', 'ankleFlexL',
    'hipFlexR', 'hipAbdR', 'hipTwistR', 'kneeFlexR', 'ankleFlexR',
    'plantL', 'plantR', 'ground', 'tabardPitch', 'capePitch'
  ];

  /** The same pose for the horizontally mirrored sprite (180°..360°): sides swap, lateral motion flips. */
  static mirrorPose(p) {
    const m = {};
    for (const [k, v] of Object.entries(p)) {
      const last = k[k.length - 1];
      const key = last === 'L' ? k.slice(0, -1) + 'R' : last === 'R' ? k.slice(0, -1) + 'L' : k;
      m[key] = v;
    }
    for (const k of ['rootX', 'rootYaw', 'rootRoll', 'spineRoll', 'spineYaw', 'neckRoll', 'neckYaw']) {
      if (m[k]) m[k] = -m[k];
    }
    return m;
  }

  /** Real turntable yaw (degrees) of a sprite frame drawn at `frameAngleDeg`. */
  visualYawDeg(frameAngleDeg) {
    const t = this.profile.yawTable;
    return t ? interpTable(t, frameAngleDeg) : frameAngleDeg;
  }

  _armRestAt(frameAngleDeg) {
    const t = this.profile.armTable;
    if (!t) return null;
    let i = 1;
    while (i < t.length - 1 && frameAngleDeg > t[i][0]) i++;
    const a = t[i - 1], b = t[i];
    const k = Math.max(0, Math.min(1, (frameAngleDeg - a[0]) / (b[0] - a[0] || 1)));
    const lerp = (n) => a[n] + (b[n] - a[n]) * k;
    const nearest = k < 0.5 ? a : b;
    return { shL: lerp(1), wrL: lerp(2), shR: lerp(3), wrR: lerp(4), farArmVisible: nearest[5] === 1 };
  }

  /**
   * Horizontal distance the body travels per full gait cycle (two steps) in sprite pixels.
   * Advance walkPhase by `speed * 2π / strideCycleLength()` to keep the planted foot from sliding.
   */
  strideCycleLength(walkIntensity = 1, run = 0) {
    const w = Math.max(0.25, Math.min(1, walkIntensity));
    const amp = this.profile.gait.hipAmplitude * (1 + 0.45 * run);
    return 4 * this.legLength * Math.sin(amp * w);
  }

  /**
   * Procedural locomotion pose (phase φ per leg, left leg uses walkPhase, right leg walkPhase + π):
   * - Hip:   flexion = sin φ  → heel strike at φ = π/2, toe-off at φ ≈ 3π/2
   * - Knee:  hinge, flexes only backward; ~60° in early swing so the foot clears the floor,
   *          nearly straight at heel strike, small cushion flex just after heel strike
   * - Foot:  absolute pitch: toe up at heel strike, flat through mid stance,
   *          heel rises before toe-off, slightly toe up during swing
   * - Pelvis height comes from ground contact (see _solveFK), so the body bobs because the
   *   leg rotates over a planted foot, instead of an arbitrary sine bounce.
   * @param run  0 = walk, 1 = run (longer stride, more knee lift, lean, bent arms)
   */
  gaitPose(walkPhase, walkIntensity, run = 0) {
    const g = this.profile.gait;
    const w = Math.max(0, Math.min(1, walkIntensity));
    const r = Math.max(0, Math.min(1, run));
    const p = { ground: 1 };
    if (w <= 0) return p;

    const leg = (phi, s) => {
      const hip = (Math.sin(phi) + 0.12 * Math.sin(2 * phi - 0.6)) * g.hipAmplitude * (1 + 0.45 * r) * w;
      const knee = (smoothBump(Math.cos(phi + 0.35), 1.3) * g.kneeFlex * (1 + 0.5 * r) +
        smoothBump(Math.cos(phi - 2.05), 2) * 0.24) * w;
      const foot = (
        0.24 * smoothBump(Math.cos(phi - 1.3), 2) -
        0.38 * smoothBump(Math.cos(phi - 4.85), 3) +
        0.10 * smoothBump(Math.cos(phi + 0.2), 1)
      ) * g.footRoll * w;
      p['hipFlex' + s] = hip;
      p['kneeFlex' + s] = knee;
      p['ankleFlex' + s] = foot - (hip - knee);
    };
    leg(walkPhase, 'L');
    leg(walkPhase + Math.PI, 'R');

    // Arms swing opposite to the leg on the same side; the elbow bends more when the arm is forward
    for (const [phi, s] of [[walkPhase, 'L'], [walkPhase + Math.PI, 'R']]) {
      p['shoulderFlex' + s] = -Math.sin(phi) * g.armSwing * (1 + 0.6 * r) * w;
      p['elbowFlex' + s] = (0.12 + smoothBump(-Math.sin(phi)) * g.elbowFlex + 0.9 * r) * w;
    }

    // Pelvis rotates with the swinging leg, shoulders counter-rotate; slight forward lean
    p.rootRoll = Math.sin(2 * walkPhase) * 0.035 * w;
    p.rootYaw = Math.sin(walkPhase) * g.pelvisYaw * w;
    p.spinePitch = (g.lean + 0.12 * r) * w + Math.cos(2 * walkPhase) * 0.015 * w;
    p.spineRoll = -p.rootRoll * 0.6;
    p.spineYaw = -p.rootYaw * 1.4;
    p.neckPitch = -p.spinePitch * 0.8;
    p.neckYaw = p.rootYaw * 0.9;

    // Front tabard gets pushed by whichever thigh swings forward; back cape trails behind
    const maxHipFlex = Math.max(p.hipFlexL, p.hipFlexR, 0);
    p.tabardPitch = maxHipFlex * g.tabardPush + Math.sin(2 * walkPhase - 0.8) * 0.05 * w;
    p.capePitch = -(g.capeTrail * (1 + r) + 0.06 * Math.sin(2 * walkPhase - 1.2)) * w;
    return p;
  }

  /** Breathing / weight shift while standing. */
  idlePose(time, amount = 1) {
    const b = Math.sin(time * 2.1) * amount;
    return {
      ground: 1,
      plantL: 1,
      plantR: 1,
      rootY: 0.008 * (b + 1) * amount,
      spinePitch: -0.015 * b,
      neckPitch: 0.02 * Math.sin(time * 2.1 + 0.6) * amount,
      shoulderAbdL: 0.03 * (b + 1) * amount,
      shoulderAbdR: 0.03 * (b + 1) * amount,
      elbowFlexL: 0.05 * amount,
      elbowFlexR: 0.05 * amount
    };
  }

  /** Legacy pose: walk + simple jump tuck + slash (used by renderRiggedFrame). */
  solveGaitKinematics(walkPhase, walkIntensity, jumpZ = 0, attackTimer = 0) {
    let p;
    if (jumpZ > 2) {
      const air = Math.min(1, jumpZ / 55);
      p = {
        ground: 0,
        hipFlexL: 0.62 * air, kneeFlexL: 1.05 * air, ankleFlexL: -0.15 * air,
        hipFlexR: 0.15 * air, kneeFlexR: 0.65 * air, ankleFlexR: -0.2 * air,
        shoulderFlexL: 0.35 * air, elbowFlexL: 0.6 * air,
        shoulderFlexR: -0.25 * air, elbowFlexR: 0.5 * air,
        spinePitch: 0.08 * air, neckPitch: -0.05 * air,
        tabardPitch: 0.35 * air, capePitch: -0.3 * air
      };
    } else {
      p = this.gaitPose(walkPhase, walkIntensity);
    }
    if (attackTimer > 0) {
      const slash = Math.sin((1 - attackTimer / 0.42) * Math.PI);
      p.shoulderFlexR = 1.25 * slash;
      p.elbowFlexR = 0.45 * slash;
    }
    this.pose = p;
    return p;
  }

  /**
   * Forward kinematics in 3D character space (relative to the rest pelvis), with planted-foot IK
   * and ground contact.
   */
  _solveFK(pose, mirrored = false) {
    const p = mirrored ? SkeletalRig.mirrorPose(pose) : pose;
    const v = (k) => p[k] || 0;
    const r = this.restJoints;
    const L = this.legLength;
    const j = {};
    const off = (name) => [r[name].x, r[name].y, r[name].z];
    const place = (name, from, R, vec = off(name)) => {
      const d = mat3Apply(R, vec);
      j[name] = { x: j[from].x + d[0], y: j[from].y + d[1], z: j[from].z + d[2] };
    };

    const R_root = mat3Mul(mat3Mul(rotY(v('rootYaw')), rotZ(v('rootRoll'))), rotX(v('rootPitch')));
    j.pelvis = { x: v('rootX') * L, y: v('rootY') * L, z: v('rootZ') * L };

    // Spine: the lower back takes half of the bend, the chest the rest
    const spineRot = (k) => mat3Mul(mat3Mul(rotY(v('spineYaw') * k), rotZ(v('spineRoll') * k)), rotX(-v('spinePitch') * k));
    place('spine', 'pelvis', mat3Mul(R_root, spineRot(0.5)));
    const R_chest = mat3Mul(R_root, spineRot(1));
    place('neck', 'spine', R_chest);
    const R_head = mat3Mul(R_chest, mat3Mul(mat3Mul(rotY(v('neckYaw')), rotZ(v('neckRoll'))), rotX(-v('neckPitch'))));
    place('headTop', 'neck', R_head);

    // Arms. Raising to the side (abduction) is outward for both sides.
    for (const [s, sign] of [['L', 1], ['R', -1]]) {
      place('shoulder' + s, 'spine', R_chest);
      const R_up = mat3Mul(R_chest, mat3Mul(mat3Mul(
        rotZ(sign * v('shoulderAbd' + s)), rotX(v('shoulderFlex' + s))), rotY(sign * v('shoulderTwist' + s))));
      place('elbow' + s, 'shoulder' + s, R_up);
      place('wrist' + s, 'elbow' + s, mat3Mul(R_up, rotX(v('elbowFlex' + s))));
    }

    place('tabardRoot', 'pelvis', R_root);
    place('tabardTip', 'tabardRoot', mat3Mul(R_root, rotX(v('tabardPitch'))));
    place('capeRoot', 'pelvis', R_chest);
    place('capeTip', 'capeRoot', mat3Mul(R_root, rotX(v('capePitch'))));

    // Legs: FK from the hip angles, then optional IK to keep a planted foot where it stood
    const rest = this._rest3D;
    const R_footFlat = rotY(v('rootYaw'));
    for (const [s, sign] of [['L', 1], ['R', -1]]) {
      place('hip' + s, 'pelvis', R_root);
      const R_th = mat3Mul(R_root, mat3Mul(mat3Mul(
        rotZ(sign * v('hipAbd' + s)), rotX(v('hipFlex' + s))), rotY(sign * v('hipTwist' + s))));
      place('knee' + s, 'hip' + s, R_th);
      const R_sh = mat3Mul(R_th, rotX(-v('kneeFlex' + s)));
      place('ankle' + s, 'knee' + s, R_sh);
      const R_ft = mat3Mul(R_sh, rotX(v('ankleFlex' + s)));
      place('toe' + s, 'ankle' + s, R_ft);
      place('heel' + s, 'ankle' + s, R_ft);

      const w = Math.max(0, Math.min(1, v('plant' + s)));
      if (w > 0 && rest) {
        const hip = j['hip' + s];
        const fk = j['ankle' + s];
        const target = {
          x: fk.x + (rest['ankle' + s].x - fk.x) * w,
          y: fk.y + (rest['ankle' + s].y - fk.y) * w,
          z: fk.z + (rest['ankle' + s].z - fk.z) * w
        };
        const fwd = mat3Apply(R_root, [0, 0, 1]);
        const knee = solveTwoBoneIK(hip, target, this._thighLen[s], this._shinLen[s], fwd);
        j['knee' + s] = knee.mid;
        j['ankle' + s] = knee.end;
        for (const part of ['toe', 'heel']) {
          const flat = mat3Apply(R_footFlat, off(part + s));
          const fkPart = j[part + s];
          const planted = { x: knee.end.x + flat[0], y: knee.end.y + flat[1], z: knee.end.z + flat[2] };
          const lerp = (a, b) => a + (b - a) * w;
          // the FK foot was attached to the FK ankle: move it with the ankle, then blend to flat
          const moved = { x: fkPart.x - fk.x + knee.end.x, y: fkPart.y - fk.y + knee.end.y, z: fkPart.z - fk.z + knee.end.z };
          j[part + s] = { x: lerp(moved.x, planted.x), y: lerp(moved.y, planted.y), z: lerp(moved.z, planted.z) };
        }
      }
    }

    // Ground contact: the lowest point of either foot (heel or toe) stays on the floor,
    // so the pelvis drops when legs are spread and rises over the stance leg.
    if (this._restSole !== undefined) {
      const ground = p.ground ?? 1;
      const sole = Math.max(j.heelL.y, j.toeL.y, j.heelR.y, j.toeR.y);
      const drop = (this._restSole - sole) * ground - v('lift') * L;
      this.bodyDropY = drop;
      if (drop) for (const k in j) j[k].y += drop;
    }
    return j;
  }

  /**
   * Solves 3D FK for a pose and projects all joints into sprite frame space.
   * @param normAngleDeg   current facing (0..360), decides mirroring
   * @param frameAngleDeg  angle of the sprite frame actually drawn (0..180); the rest pose is
   *                       projected at this angle so bones line up with the pixels of that frame
   * @param pose           pose to use (defaults to this.pose)
   */
  computeProjectedJoints(normAngleDeg = 0, frameAngleDeg = null, pose = this.pose) {
    const norm = ((normAngleDeg % 360) + 360) % 360;
    const isMirrored = norm > 180;
    const lookupDeg = frameAngleDeg ?? (isMirrored ? 360 - norm : norm);
    const yawRad = (this.visualYawDeg(lookupDeg) * Math.PI) / 180;
    const cosY = Math.cos(yawRad);
    const sinY = Math.sin(yawRad);
    const tilt = this.profile.gait.cameraTilt;

    const j3D = this._solveFK(pose, isMirrored);
    const rest = this._rest3D;

    const projected = {};
    for (const key of Object.keys(j3D)) {
      const pt = j3D[key];
      const rs = rest[key];
      const restX = this.originX + rs.x * cosY + rs.z * sinY;
      const restY = this.originY + rs.y;
      const x = this.originX + pt.x * cosY + pt.z * sinY;
      const y = this.originY + pt.y - (pt.z - rs.z) * cosY * tilt;
      projected[key] = {
        x, y, restX, restY,
        dx: x - restX,
        dy: y - restY,
        z: -pt.x * sinY + pt.z * cosY,
        restZ: -rs.x * sinY + rs.z * cosY
      };
    }

    // Optional measured arm table: snap the arm rest pose onto the sprite's arms and keep
    // the model's motion deltas
    const arm = this._armRestAt(lookupDeg);
    if (arm) {
      const pj = this.profile.joints;
      const setRest = (name, rx, ry) => {
        const q = projected[name];
        q.restX = rx;
        q.restY = ry;
        q.x = rx + q.dx;
        q.y = ry + q.dy;
      };
      for (const [s, sh, wr] of [['L', arm.shL, arm.wrL], ['R', arm.shR, arm.wrR]]) {
        setRest('shoulder' + s, sh, pj['shoulder' + s].y);
        setRest('elbow' + s, sh + (wr - sh) * 0.55, pj['elbow' + s].y);
        setRest('wrist' + s, wr, pj['wrist' + s].y);
      }
    }

    this.joints2D = projected;
    return projected;
  }

  /** Rest-pose joints projected for a sprite frame angle (does not change the current pose). */
  restJoints2D(frameAngleDeg) {
    const savedJoints = this.joints2D;
    const j = this.computeProjectedJoints(0, frameAngleDeg, SkeletalRig.zeroPose());
    this.joints2D = savedJoints;
    return j;
  }

  /**
   * Inverse 2D bone transform: maps a posed pixel back to the rest-pose pixel by undoing the
   * bone's rotation around jointA and its foreshortening along the bone axis.
   * Very short bones on screen (e.g. a foot seen from the front) only translate,
   * since their 2D angle is meaningless.
   */
  _buildInverseBoneTransform(jointA, jointB, maxRot = 0.75) {
    const rdx = jointB.restX - jointA.restX;
    const rdy = jointB.restY - jointA.restY;
    const cdx = jointB.x - jointA.x;
    const cdy = jointB.y - jointA.y;
    const restLen = Math.hypot(rdx, rdy) || 1;
    const curLen = Math.hypot(cdx, cdy) || 1;

    let dTheta = 0;
    let invScale = 1;
    if (restLen >= 16 * this.unit) {
      dTheta = Math.atan2(cdx, cdy) - Math.atan2(rdx, rdy);
      if (dTheta > Math.PI) dTheta -= 2 * Math.PI;
      if (dTheta < -Math.PI) dTheta += 2 * Math.PI;
      dTheta = Math.max(-maxRot, Math.min(maxRot, dTheta));
      invScale = restLen / Math.max(restLen * 0.7, Math.min(restLen * 1.2, curLen));
    }

    return {
      ax: jointA.x,
      ay: jointA.y,
      rx: jointA.restX,
      ry: jointA.restY,
      cosT: Math.cos(dTheta),
      sinT: Math.sin(dTheta),
      ux: rdx / restLen,
      uy: rdy / restLen,
      restLen,
      invScale
    };
  }

  /**
   * Evaluates a bone chain: the pixel is mapped back through every bone, and the bone whose
   * rest segment the result lands closest to wins (blending the two best near joints).
   * Unlike a fixed y-band per joint, this stays correct when a joint is bent or a limb swings
   * sideways, and it never pulls a bent foot's pixels through the shin.
   */
  _evalChain(chain, x, y) {
    // Hot path (runs per pixel per layer): no allocations, squared distances
    const out = this._chainOut || (this._chainOut = { sx: 0, sy: 0 });
    let bestD2 = Infinity, secondD2 = Infinity;
    let bx = 0, by = 0, sx2 = 0, sy2 = 0, blendR = 4;
    for (let i = 0; i < chain.length; i++) {
      const b = chain[i];
      const tf = b.tf;
      const dx = x - tf.ax;
      const dy = y - tf.ay;
      const lx = dx * tf.cosT - dy * tf.sinT;
      const ly = dx * tf.sinT + dy * tf.cosT;
      const along = (lx * tf.ux + ly * tf.uy) * (tf.invScale - 1);
      const qx = tf.rx + lx + along * tf.ux;
      const qy = tf.ry + ly + along * tf.uy;
      if (chain.length === 1) { out.sx = qx; out.sy = qy; return out; }

      const ex = b.s1x - b.s0x, ey = b.s1y - b.s0y;
      let t = ((qx - b.s0x) * ex + (qy - b.s0y) * ey) / (ex * ex + ey * ey || 1);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = qx - (b.s0x + ex * t), py = qy - (b.s0y + ey * t);
      const d2 = px * px + py * py;
      if (d2 < bestD2) {
        secondD2 = bestD2; sx2 = bx; sy2 = by;
        bestD2 = d2; bx = qx; by = qy; blendR = b.radius;
      } else if (d2 < secondD2) {
        secondD2 = d2; sx2 = qx; sy2 = qy;
      }
    }
    out.sx = bx; out.sy = by;
    if (secondD2 !== Infinity && secondD2 < (Math.sqrt(bestD2) + blendR) ** 2) {
      const gap = Math.sqrt(secondD2) - Math.sqrt(bestD2);
      const t = 0.5 * (1 - gap / blendR);
      out.sx = bx + (sx2 - bx) * t;
      out.sy = by + (sy2 - by) * t;
    }
    return out;
  }

  /**
   * Like _evalChain, but a bone may only sample rest pixels it owns (seg.owner / splitY for the
   * body), or pixels of the neighbouring bone close to their shared joint. Returns false when no
   * bone owns the sample, so nothing is drawn there.
   */
  _evalChainOwned(chain, x, y, owner, w, h, splitY) {
    const out = this._chainOut || (this._chainOut = { sx: 0, sy: 0 });
    let bestD2 = Infinity, secondD2 = Infinity;
    let bx = 0, by = 0, sx2 = 0, sy2 = 0, blendR = 4;
    for (let i = 0; i < chain.length; i++) {
      const b = chain[i];
      const tf = b.tf;
      const dx = x - tf.ax;
      const dy = y - tf.ay;
      const lx = dx * tf.cosT - dy * tf.sinT;
      const ly = dx * tf.sinT + dy * tf.cosT;
      const along = (lx * tf.ux + ly * tf.uy) * (tf.invScale - 1);
      const qx = tf.rx + lx + along * tf.ux;
      const qy = tf.ry + ly + along * tf.uy;
      const ix = (qx + 0.5) | 0, iy = (qy + 0.5) | 0;
      if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
      const o = splitY !== undefined ? (qy < splitY ? 2 : 1) : owner[iy * w + ix];
      if (o !== i + 1) {
        // a neighbouring bone's pixel is fine right at the shared joint (fills the crease)
        const jx = o === i ? b.jax : o === i + 2 ? b.jbx : NaN;
        const jy = o === i ? b.jay : b.jby;
        if (!(Math.abs(qx - jx) < b.joint && Math.abs(qy - jy) < b.joint)) continue;
      }
      const ex = b.s1x - b.s0x, ey = b.s1y - b.s0y;
      let t = ((qx - b.s0x) * ex + (qy - b.s0y) * ey) / (ex * ex + ey * ey || 1);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = qx - (b.s0x + ex * t), py = qy - (b.s0y + ey * t);
      const d2 = px * px + py * py;
      if (d2 < bestD2) {
        secondD2 = bestD2; sx2 = bx; sy2 = by;
        bestD2 = d2; bx = qx; by = qy; blendR = b.radius;
      } else if (d2 < secondD2) {
        secondD2 = d2; sx2 = qx; sy2 = qy;
      }
    }
    if (bestD2 === Infinity) return false;
    out.sx = bx; out.sy = by;
    if (secondD2 !== Infinity && secondD2 < (Math.sqrt(bestD2) + blendR) ** 2) {
      const gap = Math.sqrt(secondD2) - Math.sqrt(bestD2);
      const t = 0.5 * (1 - gap / blendR);
      out.sx = bx + (sx2 - bx) * t;
      out.sy = by + (sy2 - by) * t;
    }
    return true;
  }

  /** True when a pixel color belongs to the character's cloth (tabard / cape). */
  _isClothColor(r, g, b) {
    const c = this.profile.cloth;
    if (c.mode === 'dominantRed') return r > g + c.minOverGreen && r > b + c.minOverBlue;
    if (c.mode === 'colors') {
      const tol2 = c.tolerance * c.tolerance;
      for (const [cr, cg, cb] of c.colors) {
        const dr = r - cr, dg = g - cg, db = b - cb;
        if (dr * dr + dg * dg + db * db <= tol2) return true;
      }
    }
    return false;
  }

  /**
   * Segments a sprite frame into body-part labels (cached per frame). Also builds a
   * torso "fill" image: where the near arm covers the body in profile, the hidden body
   * is reconstructed from the neighbouring torso pixels so the arm can swing away
   * without leaving a hole or a frozen copy of itself.
   */
  getFrameSegmentation(frame, lookupDeg) {
    const key = Math.round(lookupDeg * 100);
    const cached = this._segCache.get(frame);
    if (cached && cached.key === key) return cached;

    const w = frame.width;
    const h = frame.height;
    const src = frame.imageData.data;
    const S = this.profile.segmentation;
    const u = this.unit;

    const j = this.restJoints2D(lookupDeg);

    const yaw = (this.visualYawDeg(lookupDeg) * Math.PI) / 180;
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);
    const sideWeight = sinY * sinY;
    const sharedLegs = sideWeight > 0.72;     // both legs overlap in the sprite
    const armTableEntry = this._armRestAt(lookupDeg);
    const farArmVisible = armTableEntry ? armTableEntry.farArmVisible : sideWeight < 0.75;

    const armCapsule = (s) => {
      const sh = j['shoulder' + s], el = j['elbow' + s], wr = j['wrist' + s];
      const fx = wr.restX - el.restX, fy = wr.restY - el.restY;
      const fl = Math.hypot(fx, fy) || 1;
      return {
        sh, el, wr,
        tipX: wr.restX + (fx / fl) * S.handLength,
        tipY: wr.restY + (fy / fl) * S.handLength
      };
    };
    const capL = armCapsule('L');
    const capR = armCapsule('R');
    const armDist = (c, x, y) => Math.min(
      distToSegment(x, y, c.sh.restX, c.sh.restY, c.el.restX, c.el.restY) - S.upperArmRadius,
      distToSegment(x, y, c.el.restX, c.el.restY, c.wr.restX, c.wr.restY) - S.forearmRadius,
      distToSegment(x, y, c.wr.restX, c.wr.restY, c.tipX, c.tipY) - S.handRadius
    );
    const legDist = (s, x, y) => Math.min(
      distToSegment(x, y, j['hip' + s].restX, j['hip' + s].restY, j['knee' + s].restX, j['knee' + s].restY),
      distToSegment(x, y, j['knee' + s].restX, j['knee' + s].restY, j['ankle' + s].restX, j['ankle' + s].restY),
      distToSegment(x, y, j['heel' + s].restX, j['heel' + s].restY, j['toe' + s].restX, j['toe' + s].restY)
    );

    const neckY = j.neck.restY;
    const legTopY = j.hipL.restY + (sharedLegs ? S.legTopSide : S.legTopFront);
    const clothTopY = j.tabardRoot.restY - 4 * u;
    const centerX = j.pelvis.restX;
    const handGuard = 13 * u;

    const labels = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const p = idx * 4;
        if (src[p + 3] < 40) continue;

        const dL = armDist(capL, x, y);
        const dR = farArmVisible ? armDist(capR, x, y) : Infinity;
        // cloth-colored details on a glove / bracer belong to the hand, not the cloth
        const handDist = (c) => distToSegment(x, y, c.el.restX + (c.wr.restX - c.el.restX) * 0.6,
          c.el.restY + (c.wr.restY - c.el.restY) * 0.6, c.tipX, c.tipY);
        const nearHand = Math.min(handDist(capL) - S.handRadius,
          farArmVisible ? handDist(capR) - S.handRadius : Infinity,
          Math.hypot(x - capL.wr.restX, y - capL.wr.restY) - handGuard) < 0;
        const isCloth = y > clothTopY && !nearHand && this._isClothColor(src[p], src[p + 1], src[p + 2]);

        let label, legDistL, legDistR;
        if (isCloth) {
          const forward = (x - centerX) * sinY + 30 * u * cosY;
          label = forward > 0 ? LBL.CLOTH_F : LBL.CLOTH_B;
        } else if (dL < 0 || dR < 0) {
          label = dL <= dR ? LBL.ARM_L : LBL.ARM_R;
        } else if (y < neckY) {
          label = LBL.HEAD;
        } else if (y >= legTopY && Math.min(legDistL = legDist('L', x, y), legDistR = legDist('R', x, y)) < S.legRadius) {
          // (skirt / cape fringe hanging further from the legs stays with the body)
          label = sharedLegs ? LBL.LEGS : (legDistL <= legDistR ? LBL.LEG_L : LBL.LEG_R);
        } else {
          label = LBL.TORSO;
        }
        labels[idx] = label;
      }
    }

    // Edge-aware arms: inside each arm capsule, keep only pixels connected to the arm bone by
    // gentle color steps; the rest (shirt, belly, pockets touching the arm) goes back to the torso
    if (S.armEdges > 0) {
      const tol = S.armEdges;
      for (const [lbl, c] of [[LBL.ARM_L, capL], [LBL.ARM_R, capR]]) {
        const reached = new Uint8Array(w * h);
        const stack = [];
        const pts = [[c.sh, c.el], [c.el, c.wr], [c.wr, { restX: c.tipX, restY: c.tipY }]];
        for (const [a, b] of pts) {
          const n = Math.ceil(Math.hypot(b.restX - a.restX, b.restY - a.restY));
          for (let k = 0; k <= n; k++) {
            const x = Math.round(a.restX + ((b.restX - a.restX) * k) / (n || 1));
            const y = Math.round(a.restY + ((b.restY - a.restY) * k) / (n || 1));
            const i = y * w + x;
            if (x >= 0 && y >= 0 && x < w && y < h && labels[i] === lbl && !reached[i]) { reached[i] = 1; stack.push(i); }
          }
        }
        while (stack.length) {
          const cur = stack.pop();
          const cx = cur % w;
          for (const nb of [cur - w, cur + w, cx > 0 ? cur - 1 : -1, cx < w - 1 ? cur + 1 : -1]) {
            if (nb < 0 || nb >= w * h || reached[nb] || labels[nb] !== lbl) continue;
            const d = Math.abs(src[nb * 4] - src[cur * 4]) + Math.abs(src[nb * 4 + 1] - src[cur * 4 + 1]) +
              Math.abs(src[nb * 4 + 2] - src[cur * 4 + 2]);
            if (d > tol) continue;
            reached[nb] = 1;
            stack.push(nb);
          }
        }
        for (let i = 0; i < w * h; i++) {
          if (labels[i] === lbl && !reached[i]) labels[i] = (i / w | 0) < neckY ? LBL.HEAD : LBL.TORSO;
        }
      }
    }

    // Small islands of body pixels cut off by a limb (e.g. the edge of a glove just outside
    // the arm capsule) would stay frozen while the limb moves away; give them to the limb they touch.
    const isBodyLabel = (l) => l === LBL.TORSO || l === LBL.HEAD;
    const islandSize = 300 * u * u;
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    for (let start = 0; start < w * h; start++) {
      if (seen[start] || !isBodyLabel(labels[start])) continue;
      const comp = [];
      const touching = new Uint16Array(16);
      let sp = 0;
      stack[sp++] = start;
      seen[start] = 1;
      while (sp > 0) {
        const cur = stack[--sp];
        comp.push(cur);
        const cx = cur % w;
        const nbs = [cur - w, cur + w, cx > 0 ? cur - 1 : -1, cx < w - 1 ? cur + 1 : -1];
        for (const nb of nbs) {
          if (nb < 0 || nb >= w * h) continue;
          const l = labels[nb];
          if (isBodyLabel(l)) {
            if (!seen[nb]) { seen[nb] = 1; stack[sp++] = nb; }
          } else if (l) {
            touching[l]++;
          }
        }
      }
      if (comp.length >= islandSize) continue;
      let owner = 0;
      for (let l = 1; l < 16; l++) if (touching[l] > touching[owner]) owner = l;
      if (owner) for (const idx of comp) labels[idx] = owner;
    }

    // Body parts painted by hand in the editor (frame.labelOverride: 0 = automatic)
    const ov = frame.labelOverride;
    if (ov) {
      for (let i = 0; i < w * h; i++) {
        let l = ov[i];
        if (!l || src[i * 4 + 3] < 40) continue;
        // (in side views, legs marked by hand stay separate: L = near leg, R = far leg for 0..180°)
        if (!sharedLegs && l === LBL.LEGS) l = legDist('L', i % w, (i / w) | 0) <= legDist('R', i % w, (i / w) | 0) ? LBL.LEG_L : LBL.LEG_R;
        labels[i] = l;
      }
    }

    // Torso fill under the near arm where it overlaps the body (near-profile views only;
    // in front / 3/4 views the arms hang beside the body and only background is behind them)
    const fill = new Uint8ClampedArray(src);
    const isBody = (l) => l === LBL.TORSO || l === LBL.HEAD || l === LBL.CLOTH_B || l === LBL.CLOTH_F;
    const fillScan = Math.ceil(60 * u);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const l = labels[idx];
        if (sideWeight < 0.72 || (l !== LBL.ARM_L && l !== LBL.ARM_R)) continue;
        let left = -1, right = -1;
        for (let k = 1; k <= fillScan && (left < 0 || right < 0); k++) {
          if (left < 0 && x - k >= 0 && isBody(labels[idx - k])) left = k;
          if (right < 0 && x + k < w && isBody(labels[idx + k])) right = k;
        }
        if (left < 0 || right < 0) continue; // arm is outside the body silhouette: nothing behind it
        // Continue the neighbouring body texture across the arm (copy from just past the
        // farther edge) instead of interpolating colours, which smears into streaks.
        const span = left + right;
        let sxFill = x + span;
        if (sxFill >= w || !isBody(labels[idx + span])) sxFill = x - span;
        if (sxFill < 0 || !isBody(labels[y * w + sxFill])) sxFill = right <= left ? x + right : x - left;
        const sp = (y * w + sxFill) * 4;
        const p = idx * 4;
        for (let c = 0; c < 3; c++) fill[p + c] = src[sp + c] * 0.72;
        fill[p + 3] = 255;
        labels[idx] |= 0x80; // keep arm label, flag that a torso fill exists here
      }
    }

    // Rest-space horizontal extent of every label per row, used to limit each layer's paint
    // area. Torso pixels reconstructed under an arm are tracked under LBL.FILL.
    const spans = {};
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const raw = labels[y * w + x];
        if (!raw) continue;
        const ls = raw & 0x80 ? [raw & 0x7f, LBL.FILL] : [raw];
        for (const l of ls) {
          const sp = spans[l] || (spans[l] = { min: new Int16Array(h).fill(w), max: new Int16Array(h).fill(-1) });
          if (x < sp.min[y]) sp.min[y] = x;
          if (x > sp.max[y]) sp.max[y] = x;
        }
      }
    }

    // Which bone of its limb owns each pixel (1 = upper arm / thigh, 2 = forearm+hand / shin,
    // 3 = foot): a bone only draws pixels it owns, so a bent elbow can't drag hand pixels along
    // the upper arm (or the shin along the thigh)
    const owner = new Uint8Array(w * h);
    const segD = (x, y, a, b) => distToSegment(x, y, j[a].restX, j[a].restY, j[b].restX, j[b].restY);
    for (let i = 0; i < w * h; i++) {
      const l = labels[i] & 0x7f;
      if (!l) continue;
      const x = i % w, y = (i / w) | 0;
      if (l === LBL.ARM_L || l === LBL.ARM_R) {
        const s = l === LBL.ARM_L ? 'L' : 'R';
        const c = s === 'L' ? capL : capR;
        const fore = Math.min(segD(x, y, 'elbow' + s, 'wrist' + s),
          distToSegment(x, y, c.wr.restX, c.wr.restY, c.tipX, c.tipY));
        owner[i] = segD(x, y, 'shoulder' + s, 'elbow' + s) <= fore ? 1 : 2;
      } else if (l === LBL.LEG_L || l === LBL.LEG_R || l === LBL.LEGS) {
        const s = l === LBL.LEG_R ? 'R' : 'L';
        const d1 = segD(x, y, 'hip' + s, 'knee' + s);
        const d2 = segD(x, y, 'knee' + s, 'ankle' + s);
        const d3 = Math.min(segD(x, y, 'heel' + s, 'toe' + s), y > j['ankle' + s].restY ? d2 : Infinity);
        owner[i] = d1 <= d2 && d1 <= d3 ? 1 : d2 < d3 ? 2 : 3;
      } else {
        owner[i] = 1;
      }
    }

    const seg = { key, labels, owner, fill, spans, sharedLegs, farArmVisible, sinY, cosY, sideWeight, neckY };
    this._segCache.set(frame, seg);
    return seg;
  }

  /**
   * Legacy entry point: walk cycle + jump tuck + slash. Prefer renderPose() with poses from
   * gaitPose() / animations.js.
   */
  renderRiggedFrame(frame, walkPhase, walkIntensity, normAngleDeg = 0, jumpZ = 0, attackTimer = 0) {
    // Plain walking repeats every cycle: snap it to 32 poses per cycle so skinned frames are reused
    if (jumpZ <= 1 && attackTimer <= 0 && walkIntensity > 0.01) {
      const steps = SkeletalRig.POSES_PER_CYCLE;
      const phaseStep = ((Math.round((walkPhase / (Math.PI * 2)) * steps) % steps) + steps) % steps;
      walkPhase = (phaseStep / steps) * Math.PI * 2;
      walkIntensity = Math.round(walkIntensity * 10) / 10;
    }
    const pose = this.solveGaitKinematics(walkPhase, walkIntensity, jumpZ, attackTimer);
    return this.renderPose(frame, pose, normAngleDeg);
  }

  /**
   * Skins a sprite frame into `pose` (see zeroPose() for the fields). Results are cached by the
   * (quantized) pose, so looping animations cost nothing after their first cycle.
   * Layers are painted back to front; each layer inverse-warps through its bone chain and only
   * accepts source pixels with its own labels.
   */
  renderPose(frame, pose, normAngleDeg = 0) {
    const norm = ((normAngleDeg % 360) + 360) % 360;
    const lookupDeg = frame.angleDeg ?? (norm > 180 ? 360 - norm : norm);
    this.pose = pose;

    let still = true;
    const parts = [frame.index ?? lookupDeg, norm > 180 ? 1 : 0];
    for (const k of SkeletalRig.POSE_KEYS) {
      const val = pose[k];
      if (k === 'ground') { parts.push(val ?? 1); continue; }
      if (k === 'plantL' || k === 'plantR') { parts.push(Math.round((val || 0) * 20)); continue; }
      const q = Math.round((val || 0) * 60); // ~1° / 1.7% of leg length steps
      if (q !== 0) still = false;
      parts.push(q);
    }
    const j = this.computeProjectedJoints(normAngleDeg, lookupDeg, pose);
    if (still) return this.paddedFrame(frame);

    const cacheKey = parts.join(',');
    const cache = this._poseCache || (this._poseCache = new Map());
    const hit = cache.get(cacheKey);
    if (hit && hit.frame === frame) {
      cache.delete(cacheKey);
      cache.set(cacheKey, hit);
      return hit.out;
    }
    const out = this._skinFrame(frame, j, lookupDeg);
    cache.set(cacheKey, { frame, out });
    if (cache.size > SkeletalRig.POSE_CACHE_SIZE) cache.delete(cache.keys().next().value);
    return out;
  }

  /**
   * Margin (sprite pixels) around every skinned frame, so raised arms and kicks are not cut off
   * at the frame border. Rendered ImageData is (width + 2*pad) x (height + 2*pad) and carries
   * `.pad`; draw it offset by -pad.
   */
  get pad() {
    return Math.round(0.33 * profileHeight(this.profile.joints));
  }

  /** The unposed frame inside the same padded canvas as renderPose() output. */
  paddedFrame(frame) {
    this._padCache = this._padCache || new WeakMap();
    let img = this._padCache.get(frame);
    if (img) return img;
    const pad = this.pad;
    const w = frame.width, h = frame.height, W = w + 2 * pad;
    img = new ImageData(W, h + 2 * pad);
    const src = frame.imageData.data;
    for (let y = 0; y < h; y++) {
      img.data.set(src.subarray(y * w * 4, (y + 1) * w * 4), ((y + pad) * W + pad) * 4);
    }
    img.pad = pad;
    this._padCache.set(frame, img);
    return img;
  }

  /** Call after editing a frame's pixels or label overrides. */
  invalidateFrame(frame) {
    this._segCache.delete(frame);
    this._padCache?.delete(frame);
    this._poseCache?.clear();
  }

  _skinFrame(frame, j, lookupDeg) {
    const seg = this.getFrameSegmentation(frame, lookupDeg);
    const w = frame.width;
    const h = frame.height;
    const src = frame.imageData.data;
    const pad = this.pad;
    const OW = w + 2 * pad, OH = h + 2 * pad;
    const out = new ImageData(OW, OH);
    out.pad = pad;
    const dst = out.data;
    const labels = seg.labels;
    const u = this.unit;

    // segFrom: rest segment used to decide which bone owns a pixel (the foot spans heel -> toe)
    const bone = (a, b, maxRot, radius = 5, segFrom = a) => ({
      tf: this._buildInverseBoneTransform(j[a], j[b], maxRot),
      radius: radius * u,
      joint: 9 * u, // crease tolerance around the joints shared with the neighbouring bones
      s0x: j[segFrom].restX, s0y: j[segFrom].restY,
      s1x: j[b].restX, s1y: j[b].restY,
      jax: j[a].restX, jay: j[a].restY,
      jbx: j[b].restX, jby: j[b].restY
    });
    const chains = {
      body: [bone('pelvis', 'neck', 0.9, 6), bone('neck', 'headTop', 0.9, 6)],
      armL: [bone('shoulderL', 'elbowL', 3.1, 6), bone('elbowL', 'wristL', 3.1, 6)],
      armR: [bone('shoulderR', 'elbowR', 3.1, 6), bone('elbowR', 'wristR', 3.1, 6)],
      legL: [bone('hipL', 'kneeL', 2.0, 5), bone('kneeL', 'ankleL', 2.6, 4), bone('ankleL', 'toeL', 1.4, 4, 'heelL')],
      legR: [bone('hipR', 'kneeR', 2.0, 5), bone('kneeR', 'ankleR', 2.6, 4), bone('ankleR', 'toeR', 1.4, 4, 'heelR')],
      tabard: [bone('tabardRoot', 'tabardTip', 0.6)],
      cape: [bone('capeRoot', 'capeTip', 0.6)]
    };
    const chainJoints = {
      body: ['pelvis', 'neck', 'headTop'],
      armL: ['shoulderL', 'elbowL', 'wristL'],
      armR: ['shoulderR', 'elbowR', 'wristR'],
      legL: ['hipL', 'kneeL', 'ankleL', 'toeL', 'heelL'],
      legR: ['hipR', 'kneeR', 'ankleR', 'toeR', 'heelR'],
      tabard: ['tabardRoot', 'tabardTip'],
      cape: ['capeRoot', 'capeTip']
    };

    const paint = (chainName, accept, opts = {}) => {
      const { shade = 1, useFill = false } = opts;
      const spanLabels = useFill ? [...accept, LBL.FILL] : accept;
      const rowMin = new Int16Array(h).fill(w);
      const rowMax = new Int16Array(h).fill(-1);
      let any = false;
      for (const l of spanLabels) {
        const sp = seg.spans[l];
        if (!sp) continue;
        any = true;
        for (let y = 0; y < h; y++) {
          if (sp.min[y] < rowMin[y]) rowMin[y] = sp.min[y];
          if (sp.max[y] > rowMax[y]) rowMax[y] = sp.max[y];
        }
      }
      if (!any) return;
      let reach = 0;
      for (const name of chainJoints[chainName]) {
        reach = Math.max(reach, Math.abs(j[name].dx), Math.abs(j[name].dy));
      }
      reach = Math.ceil(reach + 10 * u);

      const acceptMask = new Uint8Array(16);
      for (const l of accept) acceptMask[l] = 1;
      const chain = chains[chainName];
      const pix = useFill ? seg.fill : src;
      const owned = chain.length > 1;
      const splitY = chainName === 'body' ? seg.neckY : undefined;
      const owner = seg.owner;

      for (let y = -pad; y < h + pad; y++) {
        // posed row y can only show rest pixels from rows within `reach`
        let lo = w, hi = -1;
        for (let yy = Math.max(0, y - reach), ye = Math.min(h - 1, y + reach); yy <= ye; yy++) {
          if (rowMin[yy] < lo) lo = rowMin[yy];
          if (rowMax[yy] > hi) hi = rowMax[yy];
        }
        if (hi < 0) continue;
        const x0 = Math.max(-pad, lo - reach);
        const x1 = Math.min(w - 1 + pad, hi + reach);
        for (let x = x0; x <= x1; x++) {
          let m;
          if (owned) {
            if (!this._evalChainOwned(chain, x, y, owner, w, h, splitY)) continue;
            m = this._chainOut;
          } else {
            m = this._evalChain(chain, x, y);
          }
          const isx = (m.sx + 0.5) | 0;
          const isy = (m.sy + 0.5) | 0;
          if (isx < 0 || isx >= w || isy < 0 || isy >= h) continue;
          const sIdx = isy * w + isx;
          const raw = labels[sIdx];
          let ok = acceptMask[raw & 0x7f] === 1;
          if (!ok && useFill && (raw & 0x80)) ok = true; // torso pixel hidden under an arm
          if (!ok) continue;
          const sp = sIdx * 4;
          const a = useFill && (raw & 0x80) ? 255 : src[sp + 3];
          if (a < 25) continue;
          const dp = ((y + pad) * OW + x + pad) * 4;
          if (shade === 1) {
            dst[dp] = pix[sp];
            dst[dp + 1] = pix[sp + 1];
            dst[dp + 2] = pix[sp + 2];
          } else {
            dst[dp] = (pix[sp] * shade) | 0;
            dst[dp + 1] = (pix[sp + 1] * shade) | 0;
            dst[dp + 2] = (pix[sp + 2] * shade) | 0;
          }
          dst[dp + 3] = a;
        }
      }
    };

    // Near side = the limb closer to the viewer (larger depth)
    const leftLegNear = j.hipL.z >= j.hipR.z;
    const leftArmNear = j.shoulderL.z >= j.shoulderR.z;
    const nearLeg = leftLegNear ? 'legL' : 'legR';
    const farLeg = leftLegNear ? 'legR' : 'legL';
    const backView = seg.cosY < -0.3;

    // An arm (or a kicking leg) moved in front of the body is painted over it, otherwise behind:
    // compare the limb's depth with the body's (works for hands to the face, crossed arms, ...)
    const bodyDepth = j.spine.z;
    const depthOf = (names) => names.reduce((a, n) => a + j[n].z, 0) / names.length;
    const arms = [
      { chain: 'armL', label: LBL.ARM_L, near: leftArmNear, depth: depthOf(['elbowL', 'wristL']) },
      { chain: 'armR', label: LBL.ARM_R, near: !leftArmNear, depth: depthOf(['elbowR', 'wristR']) }
    ].filter((a) => a.near || seg.farArmVisible);
    const inFront = (a) => a.depth > bodyDepth + 4 * u || (a.near && seg.sideWeight > 0.4);
    const front = arms.filter(inFront).sort((a, b) => a.depth - b.depth);
    const behind = arms.filter((a) => !inFront(a)).sort((a, b) => a.depth - b.depth);
    const ownLegLabel = leftLegNear ? LBL.LEG_L : LBL.LEG_R;
    const nearLegLabels = seg.sharedLegs ? [LBL.LEGS, ownLegLabel] : [ownLegLabel];
    const nearLegForward = depthOf([nearLeg === 'legL' ? 'kneeL' : 'kneeR', nearLeg === 'legL' ? 'ankleL' : 'ankleR']) > bodyDepth + 14 * u;

    // Back to front
    if (!backView) paint('cape', [LBL.CLOTH_B]);
    for (const a of behind) paint(a.chain, [a.label]);
    if (seg.sharedLegs) {
      // overlapping legs: the far leg is a darkened copy of the shared pixels, plus any pixels
      // marked as the far leg (a far foot that is still visible behind the near one)
      paint(farLeg, [LBL.LEGS], { shade: 0.72 });
      paint(farLeg, [leftLegNear ? LBL.LEG_R : LBL.LEG_L]);
    } else {
      paint(farLeg, [leftLegNear ? LBL.LEG_R : LBL.LEG_L]);
    }
    paint('body', [LBL.TORSO, LBL.HEAD], { useFill: true });
    if (!nearLegForward) paint(nearLeg, nearLegLabels);
    if (backView) paint('cape', [LBL.CLOTH_B]);
    paint('tabard', [LBL.CLOTH_F]);
    if (nearLegForward) paint(nearLeg, nearLegLabels);
    for (const a of front) paint(a.chain, [a.label]);

    return out;
  }

  /**
   * Draws a Spine2D-style Bone & Joint Skeleton Overlay on the main canvas.
   * The sprite is assumed drawn centered on centerX with 75% of its height above centerY.
   */
  drawDebugSkeleton(ctx, centerX, centerY, scale, flipX = false) {
    const j = this.joints2D;
    if (!j || !j.pelvis) return;
    const fw = this.profile.frameWidth;
    const fh = this.profile.frameHeight;

    const toWorld = (pt) => {
      const localX = flipX ? (fw - pt.x) : pt.x;
      return {
        x: (centerX - fw * 0.5 * scale) + localX * scale,
        y: (centerY - fh * 0.75 * scale) + pt.y * scale
      };
    };

    const bones = [
      ['pelvis', 'spine', '#38bdf8'],
      ['spine', 'neck', '#38bdf8'],
      ['neck', 'headTop', '#38bdf8'],

      ['spine', 'shoulderL', '#a855f7'],
      ['shoulderL', 'elbowL', '#a855f7'],
      ['elbowL', 'wristL', '#a855f7'],

      ['spine', 'shoulderR', '#ec4899'],
      ['shoulderR', 'elbowR', '#ec4899'],
      ['elbowR', 'wristR', '#ec4899'],

      ['tabardRoot', 'tabardTip', '#f97316'],
      ['capeRoot', 'capeTip', '#fb923c'],

      ['pelvis', 'hipL', '#22c55e'],
      ['hipL', 'kneeL', '#22c55e'],
      ['kneeL', 'ankleL', '#22c55e'],
      ['ankleL', 'toeL', '#22c55e'],
      ['ankleL', 'heelL', '#22c55e'],

      ['pelvis', 'hipR', '#eab308'],
      ['hipR', 'kneeR', '#eab308'],
      ['kneeR', 'ankleR', '#eab308'],
      ['ankleR', 'toeR', '#eab308'],
      ['ankleR', 'heelR', '#eab308']
    ];

    ctx.save();
    ctx.lineCap = 'round';

    for (const [aName, bName, color] of bones) {
      const a = toWorld(j[aName]);
      const b = toWorld(j[bName]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    for (const [name, pt] of Object.entries(j)) {
      const wPt = toWorld(pt);
      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = name.includes('knee') || name.includes('ankle') || name.includes('hip')
        ? '#4ade80'
        : '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(wPt.x, wPt.y, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** The included knight character (kept for backwards compatibility). */
export class KnightSkeletalRig extends SkeletalRig {
  constructor() {
    super(KNIGHT_PROFILE);
  }
}
