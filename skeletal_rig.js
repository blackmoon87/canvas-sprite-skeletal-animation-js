/**
 * skeletal_rig.js
 * ============================================================================
 * 3D-Projected Hierarchical Bone & Joint Kinematics + Layered Skinned Pixel Engine
 *
 * Skeleton (joints, character space, +X = viewer Left->Right at 0°, +Y = Down, +Z = Forward):
 * - Pelvis (Root) -> Spine -> Neck -> HeadTop
 * - Shoulder L/R -> Elbow L/R -> Wrist L/R
 * - Hip L/R -> Knee L/R (Hinge) -> Ankle L/R -> Toe L/R (+ virtual Heel for ground contact)
 * - Tabard (front cloth) & Cape (back cloth), both hanging from the belt
 *
 * Skinning works in layers. Every sprite frame is segmented once (cached) into
 * body-part labels using the rest pose projected at that frame's real turntable
 * angle: arms are found with capsules around the arm bones (not by x-distance from
 * the sprite center, which in side view made the chest/back swing with the arm),
 * red cloth is split into front tabard / back cape, and legs are split per side.
 * Each layer then inverse-warps only the pixels carrying its own label and the
 * layers are painted back-to-front, so a part can never drag pixels of another.
 */

// Sprite frames are sampled uniformly from the GIF, but the turntable does not rotate
// uniformly. Measured from the sprite's hand / shoulder positions: frame angle -> real yaw.
const VISUAL_YAW_TABLE = [
  [0, 0], [20, 12], [46, 38], [67, 57], [77, 71], [87, 83],
  [93, 93], [103, 109], [113, 121], [134, 150], [160, 170], [180, 180]
];

// The chibi arms do not follow a rigid 3D shoulder model (the far arm stays wide until it
// disappears behind the body), so their rest positions are measured from the sprite:
// [frameAngle, shoulderL.x, wristL.x, shoulderR.x, wristR.x, farArmVisible]
// (L = arm on the viewer's left in front view = the near arm for 0..180°)
const ARM_REST_TABLE = [
  [0, 62, 35, 168, 200, 1], [20, 60, 35, 172, 197, 1], [46, 62, 45, 170, 190, 1],
  [67, 70, 52, 162, 175, 1], [77, 80, 70, 150, 160, 0], [87, 90, 85, 140, 150, 0],
  [93, 90, 100, 130, 140, 0], [103, 110, 125, 110, 120, 0], [113, 120, 142, 100, 100, 0],
  [134, 145, 180, 75, 55, 1], [160, 165, 197, 62, 45, 1], [180, 168, 202, 62, 40, 1]
];
const ARM_REST_Y = { shoulder: 158, elbow: 195, wrist: 230 };

function armRestAt(lookupDeg) {
  const t = ARM_REST_TABLE;
  let i = 1;
  while (i < t.length - 1 && lookupDeg > t[i][0]) i++;
  const a = t[i - 1], b = t[i];
  const k = Math.max(0, Math.min(1, (lookupDeg - a[0]) / (b[0] - a[0])));
  const lerp = (n) => a[n] + (b[n] - a[n]) * k;
  const nearest = k < 0.5 ? a : b;
  return { shL: lerp(1), wrL: lerp(2), shR: lerp(3), wrR: lerp(4), farArmVisible: nearest[5] === 1 };
}

const LBL = {
  NONE: 0, TORSO: 1, HEAD: 2, FILL: 3,
  ARM_L: 4, ARM_R: 5,
  LEG_L: 6, LEG_R: 7, LEGS: 8,
  CLOTH_F: 9, CLOTH_B: 10
};

const ORIGIN_X = 116;
const ORIGIN_Y = 232;
const CAMERA_TILT = 0.22; // fake top-down camera: points moving toward the camera rise on screen

const HIP_AMPLITUDE = 0.5;   // rad, thigh swing at full walk intensity
const LEG_LENGTH = 86;       // hip -> sole, sprite pixels (for stride matching)

function visualYawDeg(lookupDeg) {
  const t = VISUAL_YAW_TABLE;
  if (lookupDeg <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (lookupDeg <= t[i][0]) {
      const k = (lookupDeg - t[i - 1][0]) / (t[i][0] - t[i - 1][0]);
      return t[i - 1][1] + (t[i][1] - t[i - 1][1]) * k;
    }
  }
  return t[t.length - 1][1];
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function rotateBone3D(bx, by, bz, pitch, roll = 0, localYaw = 0) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  let y1 = by * cp - bz * sp;
  let z1 = by * sp + bz * cp;
  let x1 = bx;

  if (roll !== 0) {
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const nx = x1 * cr - y1 * sr;
    const ny = x1 * sr + y1 * cr;
    x1 = nx; y1 = ny;
  }
  if (localYaw !== 0) {
    const cy = Math.cos(localYaw), sy = Math.sin(localYaw);
    const nx = x1 * cy + z1 * sy;
    const nz = -x1 * sy + z1 * cy;
    x1 = nx; z1 = nz;
  }
  return { x: x1, y: y1, z: z1 };
}

function smoothBump(v, power = 1) {
  return Math.pow(Math.max(0, v), power);
}

export class KnightSkeletalRig {
  constructor() {
    // Rest-pose bone offsets (relative to parent), fitted to the sprite:
    // shoulders sit slightly behind the body center (visible in profile), arms hang down
    // to the hands at y≈232, boots are ~70px apart in front view and point forward in profile.
    this.restJoints = {
      pelvis:     { x:   0, y:    0, z:   0, parent: null },
      spine:      { x:   0, y:  -38, z:   0, parent: 'pelvis' },
      neck:       { x:   0, y:  -46, z:   0, parent: 'spine' },
      headTop:    { x:   0, y: -136, z:   2, parent: 'neck' },

      shoulderL:  { x: -52, y:  -36, z: -26, parent: 'spine' },
      elbowL:     { x: -18, y:   37, z:   4, parent: 'shoulderL' },
      wristL:     { x: -15, y:   35, z:   2, parent: 'elbowL' },

      shoulderR:  { x:  52, y:  -36, z: -26, parent: 'spine' },
      elbowR:     { x:  18, y:   37, z:   4, parent: 'shoulderR' },
      wristR:     { x:  15, y:   35, z:   2, parent: 'elbowR' },

      tabardRoot: { x:   0, y:  -20, z:  12, parent: 'pelvis' },
      tabardTip:  { x:   0, y:   68, z:   4, parent: 'tabardRoot' },
      capeRoot:   { x:   0, y:  -24, z: -26, parent: 'pelvis' },
      capeTip:    { x:   0, y:   74, z:  -4, parent: 'capeRoot' },

      hipL:       { x: -24, y:    6, z:   0, parent: 'pelvis' },
      kneeL:      { x:  -8, y:   40, z:   2, parent: 'hipL' },
      ankleL:     { x:  -2, y:   27, z:  -2, parent: 'kneeL' },
      toeL:       { x:   0, y:   12, z:  52, parent: 'ankleL' },
      heelL:      { x:   0, y:   13, z: -12, parent: 'ankleL' },

      hipR:       { x:  24, y:    6, z:   0, parent: 'pelvis' },
      kneeR:      { x:   8, y:   40, z:   2, parent: 'hipR' },
      ankleR:     { x:   2, y:   27, z:  -2, parent: 'kneeR' },
      toeR:       { x:   0, y:   12, z:  52, parent: 'ankleR' },
      heelR:      { x:   0, y:   13, z: -12, parent: 'ankleR' }
    };

    this.pose = KnightSkeletalRig.zeroPose();
    this.joints2D = {};
    this._rest3D = this._solveFK(KnightSkeletalRig.zeroPose());
    this._restSole = Math.max(this._rest3D.heelL.y, this._rest3D.toeL.y);
  }

  static POSES_PER_CYCLE = 32;
  static POSE_CACHE_SIZE = 72; // ~21 MB of 220x335 frames

  static zeroPose() {
    return {
      bodyDropY: 0,
      airborne: false,
      pelvisRoll: 0,
      pelvisYaw: 0,
      spinePitch: 0,
      spineRoll: 0,
      neckPitch: 0,
      neckYaw: 0,

      shoulderPitchL: 0,
      elbowPitchL: 0,
      shoulderPitchR: 0,
      elbowPitchR: 0,

      hipPitchL: 0,
      kneePitchL: 0,
      anklePitchL: 0,

      hipPitchR: 0,
      kneePitchR: 0,
      anklePitchR: 0,

      tabardPitch: 0,
      capePitch: 0
    };
  }

  /**
   * Horizontal distance the body travels per full gait cycle (two steps) in sprite pixels.
   * Advance walkPhase by `speed * 2π / strideCycleLength()` to keep the planted foot from sliding.
   */
  strideCycleLength(walkIntensity = 1) {
    const w = Math.max(0.25, Math.min(1, walkIntensity));
    return 4 * LEG_LENGTH * Math.sin(HIP_AMPLITUDE * w);
  }

  /**
   * Gait model (phase φ per leg, left leg uses walkPhase, right leg walkPhase + π):
   * - Hip:   flexion = sin φ  → heel strike at φ = π/2, toe-off at φ ≈ 3π/2
   * - Knee:  hinge, flexes only backward; ~60° in early swing so the boot clears the floor,
   *          nearly straight at heel strike, small cushion flex just after heel strike
   * - Foot:  absolute pitch: toe up at heel strike, flat through mid stance,
   *          heel rises before toe-off, slightly toe up during swing
   * - Pelvis height is solved from the stance foot (see _solveFK), so the body bobs because
   *   the leg actually rotates over a planted foot, instead of an arbitrary sine bounce.
   */
  solveGaitKinematics(walkPhase, walkIntensity, jumpZ = 0, attackTimer = 0) {
    const p = this.pose;
    const w = Math.max(0, Math.min(1, walkIntensity));
    const phiL = walkPhase;
    const phiR = walkPhase + Math.PI;

    const solveLegJoints = (phi) => {
      const hipPitch = (Math.sin(phi) + 0.12 * Math.sin(2 * phi - 0.6)) * HIP_AMPLITUDE * w;

      const swingFlex = smoothBump(Math.cos(phi + 0.35), 1.3) * 1.05;
      const loadingFlex = smoothBump(Math.cos(phi - 2.05), 2) * 0.24;
      const kneePitch = (swingFlex + loadingFlex) * w;

      const footPitch = (
        0.24 * smoothBump(Math.cos(phi - 1.3), 2) -
        0.38 * smoothBump(Math.cos(phi - 4.85), 3) +
        0.10 * smoothBump(Math.cos(phi + 0.2), 1)
      ) * w;
      const shinPitch = hipPitch - kneePitch;
      return { hipPitch, kneePitch, anklePitch: footPitch - shinPitch };
    };

    p.airborne = jumpZ > 2;
    if (p.airborne) {
      const air = Math.min(1, jumpZ / 55);
      p.hipPitchL = 0.62 * air;
      p.kneePitchL = 1.05 * air;
      p.anklePitchL = -0.15 * air;

      p.hipPitchR = 0.15 * air;
      p.kneePitchR = 0.65 * air;
      p.anklePitchR = -0.2 * air;

      p.shoulderPitchL = 0.35 * air;
      p.elbowPitchL = 0.6 * air;
      p.shoulderPitchR = -0.25 * air;
      p.elbowPitchR = 0.5 * air;
      p.spinePitch = 0.08 * air;
      p.spineRoll = 0;
      p.pelvisRoll = 0;
      p.pelvisYaw = 0;
      p.neckPitch = -0.05 * air;
      p.neckYaw = 0;
      p.tabardPitch = 0.35 * air;
      p.capePitch = -0.3 * air;
      return;
    }

    const legL = solveLegJoints(phiL);
    const legR = solveLegJoints(phiR);

    p.hipPitchL = legL.hipPitch;
    p.kneePitchL = legL.kneePitch;
    p.anklePitchL = legL.anklePitch;

    p.hipPitchR = legR.hipPitch;
    p.kneePitchR = legR.kneePitch;
    p.anklePitchR = legR.anklePitch;

    // Arms swing opposite to the leg on the same side; the elbow bends more when the arm is forward
    const armSwing = 0.38;
    p.shoulderPitchL = -Math.sin(phiL) * armSwing * w;
    p.elbowPitchL = (0.12 + smoothBump(-Math.sin(phiL)) * 0.38) * w;
    p.shoulderPitchR = -Math.sin(phiR) * armSwing * w;
    p.elbowPitchR = (0.12 + smoothBump(-Math.sin(phiR)) * 0.38) * w;

    if (attackTimer > 0) {
      const slash = Math.sin((1 - attackTimer / 0.42) * Math.PI);
      p.shoulderPitchR = 1.25 * slash;
      p.elbowPitchR = 0.45 * slash;
    }

    // Pelvis rotates with the swinging leg, shoulders counter-rotate; slight forward lean
    p.pelvisRoll = Math.sin(2 * walkPhase) * 0.035 * w;
    p.pelvisYaw = Math.sin(walkPhase) * 0.12 * w;
    p.spinePitch = 0.07 * w + Math.cos(2 * walkPhase) * 0.015 * w;
    p.spineRoll = -p.pelvisRoll * 0.6;
    p.neckPitch = -p.spinePitch * 0.8;
    p.neckYaw = -p.pelvisYaw * 0.5;

    // Front tabard gets pushed by whichever thigh swings forward; back cape trails behind
    const maxHipFlex = Math.max(p.hipPitchL, p.hipPitchR, 0);
    p.tabardPitch = maxHipFlex * 0.75 + Math.sin(2 * walkPhase - 0.8) * 0.05 * w;
    p.capePitch = -(0.16 + 0.06 * Math.sin(2 * walkPhase - 1.2)) * w;
  }

  /** Forward kinematics in 3D character space. */
  _solveFK(p, mirrored = false) {
    const r = this.restJoints;
    const j = {};
    const add = (name, parent, d) => {
      j[name] = { x: j[parent].x + d.x, y: j[parent].y + d.y, z: j[parent].z + d.z };
    };
    const rb = (name, pitch, roll, yaw) => {
      const n = r[name];
      return rotateBone3D(n.x, n.y, n.z, pitch, roll, yaw);
    };

    // Sprite is mirrored for 180°..360°: the near limb on screen is the other anatomical side
    const side = (left, right) => (mirrored ? right : left);
    const hipL_P = side(p.hipPitchL, p.hipPitchR), hipR_P = side(p.hipPitchR, p.hipPitchL);
    const kneeL_P = side(p.kneePitchL, p.kneePitchR), kneeR_P = side(p.kneePitchR, p.kneePitchL);
    const ankleL_P = side(p.anklePitchL, p.anklePitchR), ankleR_P = side(p.anklePitchR, p.anklePitchL);
    const shL_P = side(p.shoulderPitchL, p.shoulderPitchR), shR_P = side(p.shoulderPitchR, p.shoulderPitchL);
    const elL_P = side(p.elbowPitchL, p.elbowPitchR), elR_P = side(p.elbowPitchR, p.elbowPitchL);

    j.pelvis = { x: 0, y: 0, z: 0 };
    add('spine', 'pelvis', rb('spine', -p.spinePitch, p.spineRoll, -p.pelvisYaw * 0.5));
    add('neck', 'spine', rb('neck', -p.spinePitch, p.spineRoll, 0));
    add('headTop', 'neck', rb('headTop', -(p.spinePitch + p.neckPitch), 0, p.neckYaw));

    add('shoulderL', 'spine', rb('shoulderL', -p.spinePitch, p.spineRoll, -p.pelvisYaw * 0.4));
    add('elbowL', 'shoulderL', rb('elbowL', shL_P));
    add('wristL', 'elbowL', rb('wristL', shL_P + elL_P));

    add('shoulderR', 'spine', rb('shoulderR', -p.spinePitch, p.spineRoll, -p.pelvisYaw * 0.4));
    add('elbowR', 'shoulderR', rb('elbowR', shR_P));
    add('wristR', 'elbowR', rb('wristR', shR_P + elR_P));

    add('tabardRoot', 'pelvis', rb('tabardRoot', 0));
    add('tabardTip', 'tabardRoot', rb('tabardTip', p.tabardPitch));
    add('capeRoot', 'pelvis', rb('capeRoot', -p.spinePitch));
    add('capeTip', 'capeRoot', rb('capeTip', p.capePitch));

    const leg = (s, hipP, kneeP, ankleP) => {
      add('hip' + s, 'pelvis', rb('hip' + s, 0, p.pelvisRoll, p.pelvisYaw));
      add('knee' + s, 'hip' + s, rb('knee' + s, hipP));
      const shinP = hipP - kneeP;
      add('ankle' + s, 'knee' + s, rb('ankle' + s, shinP));
      const footP = shinP + ankleP;
      add('toe' + s, 'ankle' + s, rb('toe' + s, footP));
      add('heel' + s, 'ankle' + s, rb('heel' + s, footP));
    };
    leg('L', hipL_P, kneeL_P, ankleL_P);
    leg('R', hipR_P, kneeR_P, ankleR_P);

    // Ground contact: the lowest point of either foot (heel or toe) stays on the floor,
    // so the pelvis drops when legs are spread and rises over the stance leg.
    if (!p.airborne && this._restSole !== undefined) {
      const sole = Math.max(j.heelL.y, j.toeL.y, j.heelR.y, j.toeR.y);
      const drop = this._restSole - sole;
      p.bodyDropY = drop;
      for (const k in j) j[k].y += drop;
    }
    return j;
  }

  /**
   * Solves 3D FK and projects all joints into the 220x335 sprite space.
   * @param normAngleDeg   current facing (0..360), decides mirroring
   * @param frameAngleDeg  angle of the sprite frame actually drawn (0..180); the rest pose is
   *                       projected at this angle so bones line up with the pixels of that frame
   */
  computeProjectedJoints(normAngleDeg = 0, frameAngleDeg = null) {
    const norm = ((normAngleDeg % 360) + 360) % 360;
    const isMirrored = norm > 180;
    const lookupDeg = frameAngleDeg ?? (isMirrored ? 360 - norm : norm);
    const yawRad = (visualYawDeg(lookupDeg) * Math.PI) / 180;
    const cosY = Math.cos(yawRad);
    const sinY = Math.sin(yawRad);

    const j3D = this._solveFK(this.pose, isMirrored);
    const rest = this._rest3D;

    const projected = {};
    for (const key of Object.keys(j3D)) {
      const pt = j3D[key];
      const rs = rest[key];
      const restX = ORIGIN_X + rs.x * cosY + rs.z * sinY;
      const restY = ORIGIN_Y + rs.y;
      const x = ORIGIN_X + pt.x * cosY + pt.z * sinY;
      const y = ORIGIN_Y + pt.y - (pt.z - rs.z) * cosY * CAMERA_TILT;
      projected[key] = {
        x, y, restX, restY,
        dx: x - restX,
        dy: y - restY,
        z: -pt.x * sinY + pt.z * cosY
      };
    }

    // Snap the arm rest pose onto the measured sprite arms; keep the model's motion deltas
    const arm = armRestAt(lookupDeg);
    const setRest = (name, rx, ry) => {
      const pj = projected[name];
      pj.restX = rx;
      pj.restY = ry;
      pj.x = rx + pj.dx;
      pj.y = ry + pj.dy;
    };
    for (const [s, sh, wr] of [['L', arm.shL, arm.wrL], ['R', arm.shR, arm.wrR]]) {
      setRest('shoulder' + s, sh, ARM_REST_Y.shoulder);
      setRest('elbow' + s, sh + (wr - sh) * 0.55, ARM_REST_Y.elbow);
      setRest('wrist' + s, wr, ARM_REST_Y.wrist);
    }

    this.joints2D = projected;
    return projected;
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
    if (restLen >= 16) {
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
   * sideways, and it never pulls a bent boot's pixels through the shin.
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
   * Segments a sprite frame into body-part labels (cached per frame). Also builds a
   * torso "fill" image: where the near arm covers the body in profile, the hidden body
   * is reconstructed from the neighbouring torso pixels so the arm can swing away
   * without leaving a hole or a frozen copy of itself.
   */
  _getFrameSegmentation(frame, lookupDeg) {
    const key = Math.round(lookupDeg * 100);
    if (frame._rigSeg && frame._rigSeg.key === key) return frame._rigSeg;

    const w = frame.width;
    const h = frame.height;
    const src = frame.imageData.data;

    const savedPose = this.pose;
    const savedJoints = this.joints2D;
    this.pose = KnightSkeletalRig.zeroPose();
    const j = this.computeProjectedJoints(0, lookupDeg);
    this.pose = savedPose;
    this.joints2D = savedJoints;

    const yaw = (visualYawDeg(lookupDeg) * Math.PI) / 180;
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);
    const sideWeight = sinY * sinY;
    const sharedLegs = sideWeight > 0.72;     // both legs overlap in the sprite
    const farArmVisible = armRestAt(lookupDeg).farArmVisible; // hidden behind the body in profile

    const armCapsule = (s) => {
      const sh = j['shoulder' + s], el = j['elbow' + s], wr = j['wrist' + s];
      const fx = wr.restX - el.restX, fy = wr.restY - el.restY;
      const fl = Math.hypot(fx, fy) || 1;
      return {
        sh, el, wr,
        tipX: wr.restX + (fx / fl) * 16,
        tipY: wr.restY + (fy / fl) * 16
      };
    };
    const capL = armCapsule('L');
    const capR = armCapsule('R');
    const armDist = (c, x, y) => Math.min(
      distToSegment(x, y, c.sh.restX, c.sh.restY, c.el.restX, c.el.restY) - 17,
      distToSegment(x, y, c.el.restX, c.el.restY, c.wr.restX, c.wr.restY) - 17,
      distToSegment(x, y, c.wr.restX, c.wr.restY, c.tipX, c.tipY) - 19
    );
    const legDist = (s, x, y) => Math.min(
      distToSegment(x, y, j['hip' + s].restX, j['hip' + s].restY, j['knee' + s].restX, j['knee' + s].restY),
      distToSegment(x, y, j['knee' + s].restX, j['knee' + s].restY, j['ankle' + s].restX, j['ankle' + s].restY),
      distToSegment(x, y, j['heel' + s].restX, j['heel' + s].restY, j['toe' + s].restX, j['toe' + s].restY)
    );

    const neckY = j.neck.restY;
    // The chibi thighs are hidden under the chainmail skirt, which stays with the pelvis;
    // only the greaves and boots below it are moved by the leg bones.
    const legTopY = j.hipL.restY + (sharedLegs ? 22 : 16);
    const clothTopY = j.tabardRoot.restY - 4;
    const centerX = j.pelvis.restX;

    const labels = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const p = idx * 4;
        if (src[p + 3] < 40) continue;
        const r = src[p], g = src[p + 1], b = src[p + 2];

        const dL = armDist(capL, x, y);
        const dR = farArmVisible ? armDist(capR, x, y) : Infinity;
        const nearHand = Math.min(
          Math.hypot(x - capL.wr.restX, y - capL.wr.restY),
          farArmVisible ? Math.hypot(x - capR.wr.restX, y - capR.wr.restY) : Infinity
        ) < 13;
        const isRed = r > g + 22 && r > b + 12;

        let label, legDistL, legDistR;
        if (isRed && y > clothTopY && !nearHand) {
          const forward = (x - centerX) * sinY + 30 * cosY;
          label = forward > 0 ? LBL.CLOTH_F : LBL.CLOTH_B;
        } else if (dL < 0 || dR < 0) {
          label = dL <= dR ? LBL.ARM_L : LBL.ARM_R;
        } else if (y < neckY) {
          label = LBL.HEAD;
        } else if (y >= legTopY && Math.min(legDistL = legDist('L', x, y), legDistR = legDist('R', x, y)) < 30) {
          // (skirt / cape fringe hanging further from the legs stays with the body)
          label = sharedLegs ? LBL.LEGS : (legDistL <= legDistR ? LBL.LEG_L : LBL.LEG_R);
        } else {
          label = LBL.TORSO;
        }
        labels[idx] = label;
      }
    }

    // Small islands of body pixels cut off by a limb (e.g. the edge of a gauntlet just outside
    // the arm capsule) would stay frozen while the limb moves away; give them to the limb they touch.
    const isBodyLabel = (l) => l === LBL.TORSO || l === LBL.HEAD;
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
      if (comp.length >= 300) continue;
      let owner = 0;
      for (let l = 1; l < 16; l++) if (touching[l] > touching[owner]) owner = l;
      if (owner) for (const idx of comp) labels[idx] = owner;
    }

    // Torso fill under the near arm where it overlaps the body (near-profile views only;
    // in front / 3/4 views the arms hang beside the body and only background is behind them)
    const fill = new Uint8ClampedArray(src);
    const isBody = (l) => l === LBL.TORSO || l === LBL.HEAD || l === LBL.CLOTH_B || l === LBL.CLOTH_F;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const l = labels[idx];
        if (sideWeight < 0.72 || (l !== LBL.ARM_L && l !== LBL.ARM_R)) continue;
        let left = -1, right = -1;
        for (let k = 1; k <= 60 && (left < 0 || right < 0); k++) {
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

    frame._rigSeg = { key, labels, fill, spans, sharedLegs, farArmVisible, sinY, cosY, sideWeight };
    return frame._rigSeg;
  }

  /**
   * Skins the sprite with the current pose. Layers are painted back to front; each layer
   * inverse-warps through its bone chain and only accepts source pixels with its own labels.
   */
  renderRiggedFrame(frame, walkPhase, walkIntensity, normAngleDeg = 0, jumpZ = 0, attackTimer = 0) {
    const norm = ((normAngleDeg % 360) + 360) % 360;
    const lookupDeg = frame.angleDeg ?? (norm > 180 ? 360 - norm : norm);

    // Plain walking repeats every cycle: snap it to 32 poses per cycle and reuse skinned
    // frames from a small LRU cache (jumps and attacks are always rendered fresh)
    let cacheKey = null;
    if (jumpZ <= 1 && attackTimer <= 0 && walkIntensity > 0.01) {
      const steps = KnightSkeletalRig.POSES_PER_CYCLE;
      const phaseStep = ((Math.round((walkPhase / (Math.PI * 2)) * steps) % steps) + steps) % steps;
      walkPhase = (phaseStep / steps) * Math.PI * 2;
      walkIntensity = Math.round(walkIntensity * 10) / 10;
      cacheKey = `${frame.index ?? lookupDeg}|${norm > 180 ? 1 : 0}|${phaseStep}|${walkIntensity}`;
    }

    this.solveGaitKinematics(walkPhase, walkIntensity, jumpZ, attackTimer);
    const j = this.computeProjectedJoints(normAngleDeg, lookupDeg);

    if (walkIntensity <= 0.01 && jumpZ <= 1 && attackTimer <= 0) {
      return frame.imageData;
    }

    const cache = this._poseCache || (this._poseCache = new Map());
    if (cacheKey && cache.has(cacheKey)) {
      const hit = cache.get(cacheKey);
      cache.delete(cacheKey);
      cache.set(cacheKey, hit);
      return hit;
    }
    const out = this._skinFrame(frame, j, lookupDeg);
    if (cacheKey) {
      cache.set(cacheKey, out);
      if (cache.size > KnightSkeletalRig.POSE_CACHE_SIZE) cache.delete(cache.keys().next().value);
    }
    return out;
  }

  _skinFrame(frame, j, lookupDeg) {

    const seg = this._getFrameSegmentation(frame, lookupDeg);
    const w = frame.width;
    const h = frame.height;
    const src = frame.imageData.data;
    const out = new ImageData(w, h);
    const dst = out.data;
    const labels = seg.labels;

    // segFrom: rest segment used to decide which bone owns a pixel (the boot spans heel -> toe)
    const bone = (a, b, maxRot, radius = 5, segFrom = a) => ({
      tf: this._buildInverseBoneTransform(j[a], j[b], maxRot),
      radius,
      s0x: j[segFrom].restX, s0y: j[segFrom].restY,
      s1x: j[b].restX, s1y: j[b].restY
    });
    const chains = {
      body: [bone('pelvis', 'neck', 0.3, 6), bone('neck', 'headTop', 0.3, 6)],
      armL: [bone('shoulderL', 'elbowL', 1.4, 6), bone('elbowL', 'wristL', 1.8, 6)],
      armR: [bone('shoulderR', 'elbowR', 1.4, 6), bone('elbowR', 'wristR', 1.8, 6)],
      legL: [bone('hipL', 'kneeL', 0.9, 5), bone('kneeL', 'ankleL', 1.2, 4), bone('ankleL', 'toeL', 0.9, 4, 'heelL')],
      legR: [bone('hipR', 'kneeR', 0.9, 5), bone('kneeR', 'ankleR', 1.2, 4), bone('ankleR', 'toeR', 0.9, 4, 'heelR')],
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
      reach = Math.ceil(reach + 10);

      const acceptMask = new Uint8Array(16);
      for (const l of accept) acceptMask[l] = 1;
      const chain = chains[chainName];
      const pix = useFill ? seg.fill : src;

      for (let y = 0; y < h; y++) {
        // posed row y can only show rest pixels from rows within `reach`
        let lo = w, hi = -1;
        for (let yy = Math.max(0, y - reach), ye = Math.min(h - 1, y + reach); yy <= ye; yy++) {
          if (rowMin[yy] < lo) lo = rowMin[yy];
          if (rowMax[yy] > hi) hi = rowMax[yy];
        }
        if (hi < 0) continue;
        const x0 = Math.max(0, lo - reach);
        const x1 = Math.min(w - 1, hi + reach);
        for (let x = x0; x <= x1; x++) {
          const m = this._evalChain(chain, x, y);
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
          const dp = (y * w + x) * 4;
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
    const nearArm = leftArmNear ? 'armL' : 'armR';
    const farArm = leftArmNear ? 'armR' : 'armL';
    const nearArmLbl = leftArmNear ? LBL.ARM_L : LBL.ARM_R;
    const farArmLbl = leftArmNear ? LBL.ARM_R : LBL.ARM_L;
    const backView = seg.cosY < -0.3;

    // Back to front
    if (!backView) paint('cape', [LBL.CLOTH_B]);
    if (seg.sharedLegs) {
      paint(farLeg, [LBL.LEGS], { shade: 0.72 });
    } else {
      paint(farLeg, [leftLegNear ? LBL.LEG_R : LBL.LEG_L]);
    }
    if (seg.farArmVisible) paint(farArm, [farArmLbl]);
    paint('body', [LBL.TORSO, LBL.HEAD], { useFill: true });
    paint(nearLeg, [seg.sharedLegs ? LBL.LEGS : (leftLegNear ? LBL.LEG_L : LBL.LEG_R)]);
    if (backView) paint('cape', [LBL.CLOTH_B]);
    paint('tabard', [LBL.CLOTH_F]);
    paint(nearArm, [nearArmLbl]);

    return out;
  }

  /**
   * Draws a Spine2D-style Bone & Joint Skeleton Overlay on the main canvas.
   */
  drawDebugSkeleton(ctx, centerX, centerY, scale, flipX = false) {
    const j = this.joints2D;
    if (!j || !j.pelvis) return;

    const toWorld = (pt) => {
      const localX = flipX ? (220 - pt.x) : pt.x;
      return {
        x: (centerX - 110 * scale) + localX * scale,
        y: (centerY - 335 * 0.75 * scale) + pt.y * scale
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
