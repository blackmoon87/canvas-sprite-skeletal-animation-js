/**
 * editor.js — Character Rig Editor
 * Load any biped character art, auto-rig it from its silhouette, drag joints on the front and
 * side views, preview the walk cycle at any angle, and export a character profile + sprite sheet.
 */
import {
  SkeletalRig, KNIGHT_PROFILE, MIRROR_JOINTS, SEGMENT_LABELS as LBL,
  normalizeProfile, serializeProfile
} from './skeletal_rig.js';
import { GameCharacter, CanvasPixelProcessor } from './pixel_knight.js';
import {
  loadImage, decodeGifFrames, loadImageFrames, prepareFrames, framesFromSheet, buildSpriteSheet,
  buildLabelSheet, removeSpecks, keySmoothBackground
} from './sprite_tools.js';
import { GROUPS, sampleClip } from './animations.js';

const $ = (id) => document.getElementById(id);

const state = {
  profile: null,     // normalized, editable character profile
  frames: [],        // rig-ready frames
  raws: null,        // unprocessed source frames (GIF / images), for re-processing
  rig: null,
  hero: new GameCharacter({ scale: 1 }),
  selected: null,
  drag: null,
  pickCloth: false,
  input: { up: false, down: false, left: false, right: false }
};

function setStatus(html) {
  $('status').innerHTML = html;
}

// ---------------------------------------------------------------------------
// Auto-rig presets: joints normalized to the front silhouette box
// (x: fraction of box width from its center, y: fraction of height from its top, z: fraction of height)
// ---------------------------------------------------------------------------
const KNIGHT_FRONT_BOX = { x0: 22, x1: 210, y0: 11, y1: 325 };

function presetFromProfile(profile, box) {
  const W = box.x1 - box.x0, H = box.y1 - box.y0, cx = (box.x0 + box.x1) / 2;
  const out = {};
  for (const [n, j] of Object.entries(profile.joints)) {
    out[n] = [(j.x - cx) / W, (j.y - box.y0) / H, (j.z ?? 0) / H];
  }
  return out;
}

const PRESETS = {
  chibi: { aspect: 0.6, joints: presetFromProfile(KNIGHT_PROFILE, KNIGHT_FRONT_BOX), gait: {} },
  human: {
    aspect: 0.3,
    joints: {
      pelvis: [0, 0.53, 0], spine: [0, 0.41, 0], neck: [0, 0.15, 0], headTop: [0, 0, 0],
      shoulderL: [-0.34, 0.19, -0.01], elbowL: [-0.4, 0.36, -0.01], wristL: [-0.43, 0.51, 0],
      shoulderR: [0.34, 0.19, -0.01], elbowR: [0.4, 0.36, -0.01], wristR: [0.43, 0.51, 0],
      tabardRoot: [0, 0.5, 0.04], tabardTip: [0, 0.72, 0.05],
      capeRoot: [0, 0.2, -0.05], capeTip: [0, 0.72, -0.06],
      hipL: [-0.15, 0.54, 0], kneeL: [-0.16, 0.76, 0.01], ankleL: [-0.17, 0.955, -0.005],
      toeL: [-0.17, 0.995, 0.08], heelL: [-0.17, 1, -0.03],
      hipR: [0.15, 0.54, 0], kneeR: [0.16, 0.76, 0.01], ankleR: [0.17, 0.955, -0.005],
      toeR: [0.17, 0.995, 0.08], heelR: [0.17, 1, -0.03]
    },
    segmentation: { upperArmRadius: 0.045, forearmRadius: 0.04, handRadius: 0.05, handLength: 0.05, legRadius: 0.075, legTopSide: 0.01, legTopFront: 0.01 },
    gait: { hipAmplitude: 0.42, kneeFlex: 1.0, armSwing: 0.34, lean: 0.04 }
  }
};

function alphaBox(frame, threshold = 40) {
  const { width: w, height: h } = frame;
  const d = frame.imageData.data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

function opaque(frame, x, y) {
  return frame.imageData.data[(y * frame.width + x) * 4 + 3] > 40;
}

function nearestFrame(angle, maxDiff = 30) {
  let best = null, bestD = Infinity;
  for (const f of state.frames) {
    const d = Math.abs(f.angleDeg - angle);
    if (d < bestD) { bestD = d; best = f; }
  }
  return bestD <= maxDiff ? best : null;
}

function autoRig(presetName) {
  const preset = PRESETS[presetName];
  const front = nearestFrame(0);
  const side = nearestFrame(90);
  const base = front || side;
  if (!base) throw new Error('No front (0°) or side (90°) frame to rig');
  const box = alphaBox(base);
  if (!box) throw new Error('The frame is empty (background not removed?)');

  const H = box.y1 - box.y0;
  const W = front ? box.x1 - box.x0 : H * preset.aspect;
  const cx = front ? (box.x0 + box.x1) / 2 : base.width / 2;
  const joints = {};
  for (const [n, [nx, ny, nz]] of Object.entries(preset.joints)) {
    joints[n] = { x: cx + nx * W, y: box.y0 + ny * H, z: nz * H };
  }

  if (front) {
    // Hands: the outermost silhouette point between the shoulders and a bit below the hips
    const yA = Math.round(joints.elbowL.y), yB = Math.min(box.y1, Math.round(joints.hipL.y + 0.15 * H));
    let bestL = null, bestR = null;
    for (let y = yA; y <= yB; y++) {
      let l = -1, r = -1;
      for (let x = box.x0; x <= box.x1; x++) if (opaque(front, x, y)) { l = x; break; }
      for (let x = box.x1; x >= box.x0; x--) if (opaque(front, x, y)) { r = x; break; }
      if (l >= 0 && (!bestL || l < bestL.x)) bestL = { x: l, y };
      if (r >= 0 && (!bestR || r > bestR.x)) bestR = { x: r, y };
    }
    const inset = 0.07 * W;
    if (bestL) joints.wristL = { ...joints.wristL, x: bestL.x + inset, y: bestL.y };
    if (bestR) joints.wristR = { ...joints.wristR, x: bestR.x - inset, y: bestR.y };
    for (const s of ['L', 'R']) {
      const sh = joints['shoulder' + s], wr = joints['wrist' + s];
      joints['elbow' + s] = { ...joints['elbow' + s], x: (sh.x + wr.x) / 2, y: (sh.y + wr.y) / 2 };
    }

    // Feet: the two blobs in the bottom rows
    const band = Math.max(2, Math.round(0.05 * H));
    const sums = { L: [0, 0], R: [0, 0] };
    for (let y = box.y1 - band; y <= box.y1; y++) {
      for (let x = box.x0; x <= box.x1; x++) {
        if (!opaque(front, x, y)) continue;
        const s = x < cx ? 'L' : 'R';
        sums[s][0] += x; sums[s][1]++;
      }
    }
    const ankleDrop = (preset.joints.heelL[1] - preset.joints.ankleL[1]) * H;
    for (const s of ['L', 'R']) {
      if (!sums[s][1]) continue;
      const fx = sums[s][0] / sums[s][1];
      const hip = joints['hip' + s];
      joints['ankle' + s] = { ...joints['ankle' + s], x: fx, y: box.y1 - ankleDrop };
      joints['knee' + s] = { ...joints['knee' + s], x: hip.x + (fx - hip.x) * 0.75 };
      joints['heel' + s] = { ...joints['heel' + s], x: fx, y: box.y1 };
      joints['toe' + s] = { ...joints['toe' + s], x: fx, y: box.y1 - 0.003 * H };
    }
  }

  if (side) {
    // Toe / heel depth from the foot outline in profile (the character faces right)
    const sbox = alphaBox(side);
    if (sbox) {
      const band = Math.max(2, Math.round(0.03 * H));
      let minX = Infinity, maxX = -Infinity;
      for (let y = sbox.y1 - band; y <= sbox.y1; y++) {
        for (let x = sbox.x0; x <= sbox.x1; x++) {
          if (opaque(side, x, y)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
        }
      }
      const toeZ = maxX - joints.pelvis.x - 0.02 * H;
      const heelZ = minX - joints.pelvis.x + 0.02 * H;
      if (toeZ > 0 && heelZ < 0) {
        for (const s of ['L', 'R']) {
          joints['toe' + s].z = toeZ;
          joints['heel' + s].z = heelZ;
        }
      }
    }
  }

  const profile = {
    version: 1,
    name: $('txtName').value || 'my-hero',
    frameWidth: base.width,
    frameHeight: base.height,
    joints,
    yawTable: null,
    armTable: null,
    cloth: { mode: 'none', colors: [], tolerance: 40 },
    gait: { ...preset.gait }
  };
  if (preset.segmentation) {
    profile.segmentation = {};
    for (const [k, v] of Object.entries(preset.segmentation)) profile.segmentation[k] = v * H;
  }
  // new characters usually have arms touching the body: separate them by color edges
  profile.segmentation = { ...(profile.segmentation || {}), armEdges: 45 };
  return profile;
}

// ---------------------------------------------------------------------------
// Profile / rig
// ---------------------------------------------------------------------------
let rebuildQueued = false;
function scheduleRebuild() {
  if (rebuildQueued) return;
  rebuildQueued = true;
  requestAnimationFrame(() => {
    rebuildQueued = false;
    rebuild();
  });
}

function rebuild() {
  if (!state.profile) return;
  state.rig = new SkeletalRig(state.profile);
  state.hero.rig = state.rig;
  updateUsage();
}

function useProfile(profile) {
  state.profile = normalizeProfile(profile);
  $('txtName').value = state.profile.name;
  syncControls();
  rebuild();
  state.hero.animator.addClips(state.profile.animations);
  renderClipList();
}

function useFrames(frames) {
  state.frames = frames;
  state.hero.setFrames(frames);
  for (const view of Object.values(views)) view.slider.dispatchEvent(new Event('input'));
}

function processRaws() {
  const mode = $('selKeying').value;
  const keying = mode === 'studio' ? (img) => CanvasPixelProcessor.keyOutStudioBackground(img) : mode;
  const frames = prepareFrames(state.raws, {
    keying,
    tolerance: +$('rngTol').value,
    targetHeight: +$('rngHeight').value,
    mirror: $('chkMirror').checked
  });
  useFrames(frames);
}

/**
 * Pose check for the recommended input: arms held away from the body and legs apart, with a visible
 * gap (transparent pixels) between each limb and the body. Returns the parts that touch.
 */
function checkPartSpacing(profile) {
  const front = nearestFrame(0);
  if (!front) return [];
  const j = profile.joints;
  const transparentBetween = (y, x0, x1) => {
    y = Math.round(y);
    if (y < 0 || y >= front.height) return false;
    for (let x = Math.round(Math.min(x0, x1)); x <= Math.round(Math.max(x0, x1)); x++) {
      if (x >= 0 && x < front.width && !opaque(front, x, y)) return true;
    }
    return false;
  };
  const gapShare = (y0, y1, xs) => {
    let rows = 0, gaps = 0;
    for (let y = y0; y <= y1; y++) {
      rows++;
      const [a, b] = xs(y);
      if (transparentBetween(y, a, b)) gaps++;
    }
    return rows ? gaps / rows : 1;
  };
  const touching = [];
  const cx = j.pelvis.x;
  for (const [s, name] of [['L', 'left arm'], ['R', 'right arm']]) {
    // lower forearm to body center: in an A-pose there is background between them
    const share = gapShare(Math.round((j['elbow' + s].y + j['wrist' + s].y) / 2), Math.round(j['wrist' + s].y),
      (y) => [j['wrist' + s].x + (s === 'L' ? 4 : -4), cx]);
    if (share < 0.5) touching.push(name);
  }
  const legShare = gapShare(Math.round(j.kneeL.y), Math.round(j.ankleL.y), () => [j.kneeL.x + 3, j.kneeR.x - 3]);
  if (legShare < 0.5) touching.push('legs');
  return touching;
}

function runAutoRig() {
  const profile = autoRig($('selPreset').value);
  useProfile(profile);
  const touching = checkPartSpacing(state.profile);
  if (touching.length) {
    const verb = touching.length === 1 && touching[0] !== 'legs' ? 'touches' : 'touch';
    setStatus(`<strong>Auto-rigged.</strong> ⚠ In the front view the <strong>${touching.join(', ')}</strong> ${verb} the body.
      Best results need an A-pose: arms away from the body, legs apart, with a gap you can see. Otherwise outline the
      limbs in <em>Clean &amp; Parts → Body parts</em>.`);
  } else {
    setStatus(`<strong>Auto-rigged ${state.frames.length} frame(s).</strong> ✓ Arms and legs are clearly separated. Drag joints to fine-tune.`);
  }
}

// ---------------------------------------------------------------------------
// Sliders
// ---------------------------------------------------------------------------
const SEG_SLIDERS = [
  ['armEdges', 'Arm edge detection (0 = off)'],
  ['upperArmRadius', 'Upper arm thickness'], ['forearmRadius', 'Forearm thickness'],
  ['handRadius', 'Hand size'], ['handLength', 'Hand length'], ['legRadius', 'Leg thickness'],
  ['legTopFront', 'Legs start below hip (front)'], ['legTopSide', 'Legs start below hip (side)']
];
const GAIT_SLIDERS = [
  ['hipAmplitude', 'Stride (hip swing)', 0, 0.9], ['kneeFlex', 'Knee lift', 0, 1.6],
  ['footRoll', 'Heel–toe roll', 0, 2], ['armSwing', 'Arm swing', 0, 1],
  ['elbowFlex', 'Elbow bend', 0, 1], ['lean', 'Forward lean', -0.1, 0.3],
  ['pelvisYaw', 'Hip twist', 0, 0.3], ['tabardPush', 'Front cloth push', 0, 1.5],
  ['capeTrail', 'Cape trail', 0, 0.5], ['cameraTilt', 'Camera tilt', 0, 0.5]
];

function buildSliders() {
  const make = (container, group, key, label, min, max, step) => {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<label class="row"><span>${label}</span><span></span></label><input type="range" min="${min}" max="${max}" step="${step}" />`;
    const input = wrap.querySelector('input');
    const value = wrap.querySelectorAll('span')[1];
    input.dataset.group = group;
    input.dataset.key = key;
    if (key === 'armEdges') { input.max = 150; input.step = 1; }
    input.addEventListener('input', () => {
      if (!state.profile) return;
      state.profile[group][key] = +input.value;
      value.textContent = (+input.value).toFixed(2);
      scheduleRebuild();
    });
    container.appendChild(wrap);
  };
  for (const [k, label] of SEG_SLIDERS) make($('segSliders'), 'segmentation', k, label, 0, 100, 0.5);
  for (const [k, label, min, max] of GAIT_SLIDERS) make($('gaitSliders'), 'gait', k, label, min, max, 0.01);
}

function syncControls() {
  const p = state.profile;
  const height = Math.max(p.joints.heelL.y, p.joints.toeL.y) - p.joints.headTop.y;
  document.querySelectorAll('input[data-group]').forEach((input) => {
    if (input.dataset.group === 'segmentation' && input.dataset.key !== 'armEdges') input.max = Math.ceil(height * 0.3);
    input.value = p[input.dataset.group][input.dataset.key];
    input.parentElement.querySelectorAll('span')[1].textContent = (+input.value).toFixed(2);
  });
  $('selCloth').value = p.cloth.mode;
  $('rngClothTol').value = p.cloth.tolerance;
  $('lblClothTol').textContent = p.cloth.tolerance;
  renderSwatches();
}

function renderSwatches() {
  const el = $('clothSwatches');
  el.innerHTML = '';
  for (const [r, g, b] of state.profile?.cloth.colors || []) {
    const s = document.createElement('span');
    s.style.background = `rgb(${r},${g},${b})`;
    el.appendChild(s);
  }
}

// ---------------------------------------------------------------------------
// Front / side joint views
// ---------------------------------------------------------------------------
const LABEL_COLORS = {
  [LBL.TORSO]: [150, 150, 150], [LBL.HEAD]: [80, 110, 240], [LBL.ARM_L]: [200, 60, 220],
  [LBL.ARM_R]: [240, 80, 160], [LBL.LEG_L]: [40, 200, 60], [LBL.LEG_R]: [230, 210, 30],
  [LBL.LEGS]: [60, 200, 200], [LBL.CLOTH_F]: [240, 60, 40], [LBL.CLOTH_B]: [140, 30, 20]
};
const BONES = [
  ['pelvis', 'spine'], ['spine', 'neck'], ['neck', 'headTop'],
  ['spine', 'shoulderL'], ['shoulderL', 'elbowL'], ['elbowL', 'wristL'],
  ['spine', 'shoulderR'], ['shoulderR', 'elbowR'], ['elbowR', 'wristR'],
  ['tabardRoot', 'tabardTip'], ['capeRoot', 'capeTip'],
  ['pelvis', 'hipL'], ['hipL', 'kneeL'], ['kneeL', 'ankleL'], ['ankleL', 'toeL'], ['ankleL', 'heelL'],
  ['pelvis', 'hipR'], ['hipR', 'kneeR'], ['kneeR', 'ankleR'], ['ankleR', 'toeR'], ['ankleR', 'heelR']
];
const views = {
  front: { canvas: $('cvFront'), angle: 0, slider: $('rngFrameA'), label: $('lblFrontAngle') },
  side: { canvas: $('cvSide'), angle: 90, slider: $('rngFrameB'), label: $('lblSideAngle') }
};
const viewFrame = (view) => nearestFrame(view.angle, 180);
for (const view of Object.values(views)) {
  view.slider.addEventListener('input', () => {
    view.angle = +view.slider.value;
    const f = viewFrame(view);
    view.label.textContent = f ? `frame ${f.index} · ${Math.round(f.angleDeg)}°` : '';
  });
}

function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: canvas.clientWidth, h: canvas.clientHeight };
}

function viewTransform(view, frame) {
  const { clientWidth: w, clientHeight: h } = view.canvas;
  const s = Math.min(w / frame.width, h / frame.height) * 0.94;
  return { s, ox: (w - frame.width * s) / 2, oy: (h - frame.height * s) / 2 };
}

function labelCanvas(frame) {
  const rig = state.rig;
  rig._labelCanvases = rig._labelCanvases || new WeakMap();
  let c = rig._labelCanvases.get(frame);
  if (c) return c;
  const seg = rig.getFrameSegmentation(frame, frame.angleDeg);
  c = document.createElement('canvas');
  c.width = frame.width;
  c.height = frame.height;
  const img = new ImageData(frame.width, frame.height);
  for (let i = 0; i < seg.labels.length; i++) {
    const col = LABEL_COLORS[seg.labels[i] & 0x7f];
    if (!col) continue;
    img.data[i * 4] = col[0];
    img.data[i * 4 + 1] = col[1];
    img.data[i * 4 + 2] = col[2];
    img.data[i * 4 + 3] = 150;
  }
  c.getContext('2d').putImageData(img, 0, 0);
  rig._labelCanvases.set(frame, c);
  return c;
}

function drawView(view) {
  const { ctx, w, h } = fitCanvas(view.canvas);
  ctx.clearRect(0, 0, w, h);
  const frame = viewFrame(view);
  if (!frame || !state.rig) {
    ctx.fillStyle = '#64748b';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(state.frames.length ? 'no frame near this angle' : 'load a character', w / 2, h / 2);
    return;
  }
  const { s, ox, oy } = viewTransform(view, frame);
  ctx.imageSmoothingEnabled = s < 1;
  ctx.drawImage(frame.canvas, ox, oy, frame.width * s, frame.height * s);
  if ($('chkLabels').checked) ctx.drawImage(labelCanvas(frame), ox, oy, frame.width * s, frame.height * s);

  // floor line
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.5)';
  ctx.beginPath();
  ctx.moveTo(0, oy + state.rig.floorY * s);
  ctx.lineTo(w, oy + state.rig.floorY * s);
  ctx.stroke();

  const j = state.rig.restJoints2D(frame.angleDeg);
  const P = (n) => [ox + j[n].restX * s, oy + j[n].restY * s];
  ctx.lineWidth = 2;
  for (const [a, b] of BONES) {
    ctx.strokeStyle = a.endsWith('R') || b.endsWith('R') ? '#eab308' : a.endsWith('L') || b.endsWith('L') ? '#22c55e' : '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(...P(a));
    ctx.lineTo(...P(b));
    ctx.stroke();
  }
  for (const n of Object.keys(j)) {
    const [x, y] = P(n);
    ctx.fillStyle = n === state.selected ? '#f43f5e' : '#0f172a';
    ctx.strokeStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(x, y, n === state.selected ? 6 : 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // tool overlays: border being drawn, brush outline
  if (state.lasso && state.lasso.view === view && state.lasso.pts.length > 1) {
    ctx.strokeStyle = state.tool === 'lassoErase' ? '#f87171' : state.tool === 'lassoPaint' ? '#facc15' : '#4ade80';
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    state.lasso.pts.forEach(([x, y], i) => (i ? ctx.lineTo(ox + x * s, oy + y * s) : ctx.moveTo(ox + x * s, oy + y * s)));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (state.cursor && state.cursor.view === view && ['erase', 'restore', 'paint'].includes(state.tool)) {
    ctx.strokeStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(ox + state.cursor.fx * s, oy + state.cursor.fy * s, +$('rngBrush').value * s, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function pointerToFrame(view, e) {
  const frame = viewFrame(view);
  if (!frame) return null;
  const rect = view.canvas.getBoundingClientRect();
  const { s, ox, oy } = viewTransform(view, frame);
  return { frame, s, fx: (e.clientX - rect.left - ox) / s, fy: (e.clientY - rect.top - oy) / s };
}

function setJointFromView(view, name, fx, fy) {
  const p = state.profile;
  const frame = viewFrame(view);
  const yaw = (state.rig.visualYawDeg(frame.angleDeg) * Math.PI) / 180;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const J = p.joints[name];
  const pelvis = p.joints.pelvis;

  J.y = fy;
  if (name !== 'pelvis') {
    if (Math.abs(cos) >= Math.abs(sin)) {
      J.x = pelvis.x + (fx - pelvis.x - J.z * sin) / cos;
    } else {
      J.z = (fx - pelvis.x - (J.x - pelvis.x) * cos) / sin;
    }
  } else if (Math.abs(cos) >= Math.abs(sin)) {
    J.x = fx;
  }

  const twin = MIRROR_JOINTS[name] || Object.keys(MIRROR_JOINTS).find((k) => MIRROR_JOINTS[k] === name);
  if ($('chkSymmetric').checked && twin) {
    p.joints[twin] = { x: 2 * pelvis.x - J.x, y: J.y, z: J.z };
  }
  if (p.armTable && /shoulder|elbow|wrist/.test(name)) {
    p.armTable = null;
    setStatus('<strong>Note:</strong> the measured arm table was turned off so your arm joints are used.');
  }
  scheduleRebuild();
}

// ---------------------------------------------------------------------------
// Cleanup & body-part tools
// ---------------------------------------------------------------------------
state.tool = 'joints';
const undoStack = [];

function snapshot(frames) {
  undoStack.push(frames.map((f) => ({
    frame: f,
    data: new Uint8ClampedArray(f.imageData.data),
    ov: f.labelOverride ? new Uint8Array(f.labelOverride) : null
  })));
  if (undoStack.length > 25) undoStack.shift();
}

function commit(frames) {
  for (const f of frames) {
    f.canvas.getContext('2d').putImageData(f.imageData, 0, 0);
    state.rig?.invalidateFrame(f);
    state.rig?._labelCanvases?.delete(f);
  }
}

function capture(el, e) {
  try { el.setPointerCapture(e.pointerId); } catch { /* not a capturable pointer */ }
}

function keepOriginal(f) {
  // restore brings back the source pixels from before background removal when we have them
  if (!f._orig) f._orig = f.raw ? new Uint8ClampedArray(f.raw) : new Uint8ClampedArray(f.imageData.data);
}

function brushAt(frame, fx, fy) {
  const r = +$('rngBrush').value;
  const { width: w, height: h } = frame;
  const d = frame.imageData.data;
  const part = +$('selPart').value;
  if (state.tool === 'paint' && !frame.labelOverride) frame.labelOverride = new Uint8Array(w * h);
  for (let y = Math.max(0, Math.floor(fy - r)); y <= Math.min(h - 1, Math.ceil(fy + r)); y++) {
    for (let x = Math.max(0, Math.floor(fx - r)); x <= Math.min(w - 1, Math.ceil(fx + r)); x++) {
      if ((x - fx) ** 2 + (y - fy) ** 2 > r * r) continue;
      const i = y * w + x;
      if (state.tool === 'erase') d[i * 4 + 3] = 0;
      else if (state.tool === 'restore') for (let c = 0; c < 4; c++) d[i * 4 + c] = frame._orig[i * 4 + c];
      else if (state.tool === 'paint') frame.labelOverride[i] = part;
    }
  }
}

function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, k = pts.length - 1; i < pts.length; k = i++) {
    const [xi, yi] = pts[i], [xk, yk] = pts[k];
    if ((yi > y) !== (yk > y) && x < ((xk - xi) * (y - yi)) / (yk - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Applies a closed border (lasso) to frames: keep inside, erase inside, or assign a body part. */
function applyLasso(pts, frames) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const part = +$('selPart').value;
  const limb = part >= 4 && part <= 7; // arm / leg: the border is that limb's exact outline
  for (const f of frames) {
    const { width: w, height: h } = f;
    const d = f.imageData.data;
    if (state.tool === 'lassoPaint' && !f.labelOverride) f.labelOverride = new Uint8Array(w * h);
    const auto = state.tool === 'lassoPaint' && limb ? state.rig.getFrameSegmentation(f, f.angleDeg) : null;
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(w - 1, Math.ceil(Math.max(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const inBox = x >= x0 && x <= x1 && y >= y0 && y <= y1;
        const inside = inBox && pointInPolygon(x + 0.5, y + 0.5, pts);
        const i = y * w + x;
        if (state.tool === 'lassoKeep' && !inside) d[i * 4 + 3] = 0;
        else if (state.tool === 'lassoErase' && inside) d[i * 4 + 3] = 0;
        else if (state.tool === 'lassoPaint' && inside && d[i * 4 + 3] > 40) f.labelOverride[i] = part;
        else if (auto && !inside && f.labelOverride[i] !== part && (auto.labels[i] & 0x7f) === part) {
          // automatically counted as this limb but outside its outline: give it back to the body
          f.labelOverride[i] = y < auto.neckY ? 2 : 1;
        }
      }
    }
  }
}

/** Magic wand: erases the connected region of similar color around (fx, fy). */
function applyWand(frames, fx, fy, seedFrame) {
  const tol = +$('rngWand').value;
  const sx = Math.round(fx), sy = Math.round(fy);
  const sd = seedFrame.imageData.data, si = (sy * seedFrame.width + sx) * 4;
  const seed = [sd[si], sd[si + 1], sd[si + 2]];
  for (const f of frames) {
    const { width: w, height: h } = f;
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
    const d = f.imageData.data;
    const near = (i) => d[i * 4 + 3] > 0 &&
      Math.abs(d[i * 4] - seed[0]) + Math.abs(d[i * 4 + 1] - seed[1]) + Math.abs(d[i * 4 + 2] - seed[2]) <= tol * 1.7;
    const start = sy * w + sx;
    if (!near(start)) continue;
    const seen = new Uint8Array(w * h);
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const cur = stack.pop();
      d[cur * 4 + 3] = 0;
      const cx = cur % w;
      for (const nb of [cur - w, cur + w, cx > 0 ? cur - 1 : -1, cx < w - 1 ? cur + 1 : -1]) {
        if (nb >= 0 && nb < w * h && !seen[nb] && near(nb)) { seen[nb] = 1; stack.push(nb); }
      }
    }
  }
}

document.querySelectorAll('[data-tool]').forEach((btn) => btn.addEventListener('click', () => {
  state.tool = btn.dataset.tool;
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === state.tool));
}));
$('rngBrush').addEventListener('input', (e) => { $('lblBrush').textContent = e.target.value; });
$('rngWand').addEventListener('input', (e) => { $('lblWand').textContent = e.target.value; });
$('btnUndo').addEventListener('click', () => {
  const step = undoStack.pop();
  if (!step) return setStatus('Nothing to undo.');
  for (const s of step) {
    s.frame.imageData.data.set(s.data);
    s.frame.labelOverride = s.ov;
  }
  commit(step.map((s) => s.frame));
  setStatus('Undone.');
});
$('btnCleanEdges').addEventListener('click', () => {
  const view = views.front;
  const targets = $('chkAllFrames').checked ? state.frames : [viewFrame(view)].filter(Boolean);
  snapshot(targets);
  const tol = +$('rngTol').value;
  for (const f of targets) {
    const keyed = keySmoothBackground(f.imageData, { step: tol / 7.6, fromTransparent: true });
    f.imageData.data.set(removeSpecks(keyed).data);
  }
  commit(targets);
  setStatus(`<strong>Cleaned</strong> ${targets.length} frame(s) (uses the Background tolerance slider). Undo if it ate too much.`);
});
$('btnRemoveSpecks').addEventListener('click', () => {
  snapshot(state.frames);
  for (const f of state.frames) f.imageData.data.set(removeSpecks(f.imageData).data);
  commit(state.frames);
  setStatus('<strong>Specks removed</strong> on every frame.');
});

for (const view of Object.values(views)) {
  view.canvas.addEventListener('pointerdown', (e) => {
    const pt = pointerToFrame(view, e);
    if (!pt || !state.rig) return;
    if (state.pickCloth) {
      const x = Math.round(pt.fx), y = Math.round(pt.fy);
      if (x >= 0 && y >= 0 && x < pt.frame.width && y < pt.frame.height) {
        const d = pt.frame.imageData.data, i = (y * pt.frame.width + x) * 4;
        if (d[i + 3] > 40) {
          state.profile.cloth.colors.push([d[i], d[i + 1], d[i + 2]]);
          state.profile.cloth.mode = 'colors';
          $('selCloth').value = 'colors';
          renderSwatches();
          scheduleRebuild();
        }
      }
      state.pickCloth = false;
      $('btnPickCloth').classList.remove('primary');
      return;
    }
    capture(view.canvas, e);
    const allFrames = state.tool === 'lassoPaint' ? $('chkPartAll').checked : $('chkAllFrames').checked;
    const targets = allFrames ? state.frames : [pt.frame];
    if (state.tool === 'erase' || state.tool === 'restore' || state.tool === 'paint') {
      keepOriginal(pt.frame);
      snapshot([pt.frame]);
      state.brush = { view, frame: pt.frame };
      brushAt(pt.frame, pt.fx, pt.fy);
      commit([pt.frame]);
      return;
    }
    if (state.tool.startsWith('lasso')) {
      state.lasso = { view, pts: [[pt.fx, pt.fy]], frames: targets };
      return;
    }
    if (state.tool === 'wand') {
      snapshot(targets);
      applyWand(targets, pt.fx, pt.fy, pt.frame);
      commit(targets);
      return;
    }
    const j = state.rig.restJoints2D(pt.frame.angleDeg);
    let best = null, bestD = 12 / pt.s;
    for (const [n, q] of Object.entries(j)) {
      const d = Math.hypot(q.restX - pt.fx, q.restY - pt.fy);
      if (d < bestD) { bestD = d; best = n; }
    }
    state.selected = best;
    $('lblJoint').textContent = `Selected: ${best ?? '—'}`;
    if (best) state.drag = { view, name: best };
  });
  view.canvas.addEventListener('pointermove', (e) => {
    const pt = pointerToFrame(view, e);
    if (!pt) return;
    state.cursor = { view, fx: pt.fx, fy: pt.fy };
    if (state.brush && state.brush.view === view) {
      brushAt(state.brush.frame, pt.fx, pt.fy);
      commit([state.brush.frame]);
    } else if (state.lasso && state.lasso.view === view) {
      state.lasso.pts.push([pt.fx, pt.fy]);
    } else if (state.drag && state.drag.view === view) {
      setJointFromView(view, state.drag.name, pt.fx, pt.fy);
    }
  });
  view.canvas.addEventListener('pointerup', () => {
    if (state.lasso && state.lasso.pts.length > 2) {
      snapshot(state.lasso.frames);
      applyLasso(state.lasso.pts, state.lasso.frames);
      commit(state.lasso.frames);
      setStatus(`<strong>Applied</strong> to ${state.lasso.frames.length} frame(s). Undo if needed.`);
    }
    state.lasso = null;
    state.brush = null;
    state.drag = null;
  });
  view.canvas.addEventListener('pointerleave', () => { state.cursor = null; });
}

// ---------------------------------------------------------------------------
// Preview / play test
// ---------------------------------------------------------------------------
let last = performance.now();
function frameLoop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  drawView(views.front);
  drawView(views.side);
  drawPreview(dt);
  requestAnimationFrame(frameLoop);
}

function drawPreview(dt) {
  const canvas = $('cvPreview');
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const hero = state.hero;
  if (!state.rig || !state.frames.length) return;

  const fh = state.frames[0].height;
  const fit = (h * 0.62) / fh;
  const play = $('chkPlay').checked;
  if (play) {
    hero.scale = fit * 0.55;
    hero.update(dt, { ...state.input }, { width: w, height: h });
    $('lblFacing').textContent = `${Math.round(hero.facingDeg)}°`;
  } else {
    hero.scale = fit;
    hero.x = w / 2;
    hero.y = (h - fh * fit) / 2 + fh * fit * 0.85;
    hero.vx = hero.vy = 0;
    hero.facingDeg = +$('rngFacing').value;
    hero.demoWalk = $('chkWalk').checked;
    hero.update(dt, {}, { width: w * 4, height: h * 4 });
    hero.x = w / 2;
    hero.y = (h - fh * fit) / 2 + fh * fit * 0.85;
  }
  hero.poseOverride = $('chkPoseMode').checked ? poseFromDeg(state.poseDeg) : null;

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
  ctx.beginPath();
  const floor = hero.y + hero.footOffset * hero.scale;
  ctx.moveTo(0, floor);
  ctx.lineTo(w, floor);
  ctx.stroke();
  hero.draw(ctx, { showSkeleton: $('chkSkel').checked });
}

const KEYS = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
window.addEventListener('keydown', (e) => {
  if (!$('chkPlay').checked || e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range') return;
  if (KEYS[e.code]) { state.input[KEYS[e.code]] = true; e.preventDefault(); }
  if (e.code === 'Space') { state.hero.jump(); e.preventDefault(); }
  if (e.code === 'KeyE') state.hero.attack();
});
window.addEventListener('keyup', (e) => {
  if (KEYS[e.code]) state.input[KEYS[e.code]] = false;
});
$('chkPlay').addEventListener('change', (e) => {
  const c = $('cvPreview');
  state.hero.x = c.clientWidth / 2;
  state.hero.y = c.clientHeight * 0.6;
  state.hero.demoWalk = false;
  if (e.target.checked) c.focus();
});

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------
async function guard(label, fn) {
  setStatus(`<strong>${label}…</strong>`);
  try {
    await fn();
  } catch (err) {
    console.error(err);
    setStatus(`<strong>Error:</strong> ${err.message}`);
  }
}

$('btnKnight').addEventListener('click', () => guard('Loading the knight', async () => {
  const base = './characters/knight/';
  const [atlas, img] = await Promise.all([
    fetch(base + KNIGHT_PROFILE.sprite.atlas).then((r) => r.json()),
    loadImage(base + KNIGHT_PROFILE.sprite.sheet)
  ]);
  state.raws = null;
  useFrames(framesFromSheet(img, atlas));
  useProfile({ ...KNIGHT_PROFILE, name: 'knight' });
  setStatus('<strong>Example knight loaded</strong> (hand-tuned profile). Try the preview, or press Auto-rig to see what it does from scratch.');
}));

$('fileGif').addEventListener('change', (e) => guard('Decoding GIF', async () => {
  const file = e.target.files[0];
  if (!file) return;
  state.raws = await decodeGifFrames(file, {
    frameCount: +$('numFrames').value,
    coverage: +$('selCoverage').value,
    backFrame: $('numBackFrame').value ? +$('numBackFrame').value : null
  });
  processRaws();
  runAutoRig();
  e.target.value = '';
}));

$('fileFrames').addEventListener('change', (e) => guard('Loading frames', async () => {
  const files = [...e.target.files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!files.length) return;
  state.raws = await loadImageFrames(files);
  processRaws();
  runAutoRig();
  e.target.value = '';
}));

$('fileSingle').addEventListener('change', (e) => guard('Loading image', async () => {
  const file = e.target.files[0];
  if (!file) return;
  state.raws = await loadImageFrames([file], { singleAngle: +$('selSingleAngle').value });
  processRaws();
  runAutoRig();
  e.target.value = '';
}));

$('fileSheet').addEventListener('change', (e) => guard('Loading sprite sheet', async () => {
  let atlas = null, profile = null, sheet = null, labels = null;
  for (const f of e.target.files) {
    if (f.type.startsWith('image/') && /labels/i.test(f.name)) labels = f;
    else if (f.type.startsWith('image/')) sheet = f;
    else {
      const json = JSON.parse(await f.text());
      if (json.joints) profile = json;
      else if (json.frames) atlas = json;
    }
  }
  if (!sheet || !atlas) throw new Error('select the sheet image and its atlas .json (character.json optional)');
  state.raws = null;
  useFrames(framesFromSheet(await loadImage(URL.createObjectURL(sheet)), atlas,
    labels ? await loadImage(URL.createObjectURL(labels)) : null));
  if (profile) {
    useProfile(profile);
    setStatus(`<strong>Loaded ${profile.name}</strong> with its profile.`);
  } else {
    runAutoRig();
  }
  e.target.value = '';
}));

$('btnReprocess').addEventListener('click', () => guard('Re-processing', async () => {
  if (!state.raws) throw new Error('re-processing works for GIF / image sources');
  processRaws();
  runAutoRig();
}));
$('btnAutoRig').addEventListener('click', () => guard('Auto-rigging', async () => runAutoRig()));

$('rngTol').addEventListener('input', (e) => { $('lblTol').textContent = e.target.value; });
$('rngHeight').addEventListener('input', (e) => { $('lblHeight').textContent = e.target.value; });
$('rngFacing').addEventListener('input', (e) => { $('lblFacing').textContent = `${e.target.value}°`; });

$('selCloth').addEventListener('change', (e) => {
  if (!state.profile) return;
  state.profile.cloth.mode = e.target.value;
  scheduleRebuild();
});
$('rngClothTol').addEventListener('input', (e) => {
  $('lblClothTol').textContent = e.target.value;
  if (!state.profile) return;
  state.profile.cloth.tolerance = +e.target.value;
  scheduleRebuild();
});
$('btnPickCloth').addEventListener('click', () => {
  state.pickCloth = true;
  $('btnPickCloth').classList.add('primary');
  setStatus('Click a cloth pixel in the front or side view.');
});
$('btnClearCloth').addEventListener('click', () => {
  if (!state.profile) return;
  state.profile.cloth.colors = [];
  renderSwatches();
  scheduleRebuild();
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
function slug() {
  return ($('txtName').value || 'my-hero').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'my-hero';
}

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function exportProfileText() {
  const name = slug();
  const p = {
    ...state.profile,
    name,
    frameWidth: state.frames[0].width,
    frameHeight: state.frames[0].height,
    sprite: {
      sheet: `${name}_spritesheet.png`,
      atlas: `${name}_atlas.json`,
      ...(state.frames.some((f) => f.labelOverride) ? { labels: `${name}_labels.png` } : {})
    }
  };
  return serializeProfile(p);
}

async function exportSheet() {
  const name = slug();
  const { canvas, atlas } = buildSpriteSheet(state.frames, { source: name });
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  download(`${name}_spritesheet.png`, blob);
  await new Promise((r) => setTimeout(r, 300));
  download(`${name}_atlas.json`, new Blob([JSON.stringify(atlas, null, 2)], { type: 'application/json' }));
  const labels = buildLabelSheet(state.frames, atlas);
  if (labels) {
    await new Promise((r) => setTimeout(r, 300));
    download(`${name}_labels.png`, await new Promise((r) => labels.toBlob(r, 'image/png')));
  }
}

function ready() {
  if (!state.profile || !state.frames.length) throw new Error('load and rig a character first');
}
$('btnExportJson').addEventListener('click', () => guard('Exporting', async () => {
  ready();
  download('character.json', new Blob([exportProfileText()], { type: 'application/json' }));
  setStatus('<strong>Saved character.json</strong>');
}));
$('btnExportSheet').addEventListener('click', () => guard('Exporting', async () => {
  ready();
  await exportSheet();
  setStatus('<strong>Saved sprite sheet + atlas</strong>');
}));
$('btnExportAll').addEventListener('click', () => guard('Exporting', async () => {
  ready();
  download('character.json', new Blob([exportProfileText()], { type: 'application/json' }));
  await new Promise((r) => setTimeout(r, 300));
  await exportSheet();
  setStatus(`<strong>Saved.</strong> Put the files in <code>characters/${slug()}/</code>.`);
}));

function updateUsage() {
  $('codeUsage').textContent =
`import { GameCharacter } from './pixel_knight.js';

const hero = await GameCharacter.load(
  './characters/${slug()}/character.json'
);
// each frame:
hero.update(dt, { left, right, up, down });
hero.draw(ctx);`;
}
$('txtName').addEventListener('input', updateUsage);

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.id === tab.dataset.pane));
}));

// ---------------------------------------------------------------------------
// Animate: library, pose editor (sliders + drag IK), keyframes
// ---------------------------------------------------------------------------
const LINEAR_DOF = new Set(['rootX', 'rootY', 'rootZ', 'lift', 'plantL', 'plantR']);
const DOF_RANGE = (k) => {
  if (k.startsWith('plant')) return [0, 1, 0.05];
  if (k === 'lift') return [0, 1, 0.01];
  if (LINEAR_DOF.has(k)) return [-0.6, 0.6, 0.01];
  if (k.startsWith('elbowFlex') || k.startsWith('kneeFlex')) return [0, 160, 1];
  if (k.startsWith('shoulderFlex') || k.startsWith('shoulderAbd')) return [-60, 180, 1];
  if (k.startsWith('hipFlex')) return [-60, 130, 1];
  if (k.startsWith('hipAbd')) return [-30, 90, 1];
  return [-120, 120, 1];
};
const DOF_GROUPS = { ...GROUPS, root: [...GROUPS.root] };
const ALL_DOFS = Object.values(DOF_GROUPS).flat();
state.poseDeg = {};

function poseFromDeg(deg) {
  const pose = { ground: 1 };
  for (const [k, v] of Object.entries(deg)) pose[k] = LINEAR_DOF.has(k) ? v : (v * Math.PI) / 180;
  return pose;
}
function degFromPose(pose) {
  const deg = {};
  for (const [k, v] of Object.entries(pose)) {
    if (k === 'ground') continue;
    deg[k] = LINEAR_DOF.has(k) ? v : (v * 180) / Math.PI;
  }
  return deg;
}

function buildDofSliders() {
  const box = $('dofSliders');
  for (const [group, keys] of Object.entries(DOF_GROUPS)) {
    const det = document.createElement('details');
    det.className = 'dof-group';
    det.innerHTML = `<summary>${group}</summary>`;
    for (const k of keys) {
      const [min, max, step] = DOF_RANGE(k);
      const row = document.createElement('div');
      row.innerHTML = `<label class="row"><span>${k}</span><span></span></label><input type="range" min="${min}" max="${max}" step="${step}" value="0" data-dof="${k}" />`;
      det.appendChild(row);
    }
    box.appendChild(det);
  }
  box.addEventListener('input', (e) => {
    const k = e.target.dataset.dof;
    if (!k) return;
    state.poseDeg[k] = +e.target.value;
    syncDofSliders();
  });
}
function syncDofSliders() {
  document.querySelectorAll('input[data-dof]').forEach((input) => {
    const v = state.poseDeg[input.dataset.dof] || 0;
    input.value = v;
    input.parentElement.querySelectorAll('span')[1].textContent = LINEAR_DOF.has(input.dataset.dof) ? v.toFixed(2) : `${Math.round(v)}°`;
  });
}

function renderClipList() {
  const box = $('clipList');
  box.innerHTML = '';
  for (const name of state.hero.animations) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = name;
    b.addEventListener('click', () => {
      $('chkPoseMode').checked = false;
      state.hero.play(name, { speed: +$('rngClipSpeed').value });
      setStatus(`Playing <strong>${name}</strong>${state.hero.animator.library[name].loop ? ' (loops)' : ''}.`);
    });
    box.appendChild(b);
  }
}
$('btnStopClips').addEventListener('click', () => state.hero.stop());
$('btnResetPose').addEventListener('click', () => { state.poseDeg = {}; syncDofSliders(); });

// Drag hands / feet / head / hips in the preview: numeric IK on the limb's angles
const IK_DOFS = {
  wristL: ['shoulderFlexL', 'shoulderAbdL', 'elbowFlexL'], wristR: ['shoulderFlexR', 'shoulderAbdR', 'elbowFlexR'],
  elbowL: ['shoulderFlexL', 'shoulderAbdL'], elbowR: ['shoulderFlexR', 'shoulderAbdR'],
  ankleL: ['hipFlexL', 'hipAbdL', 'kneeFlexL'], ankleR: ['hipFlexR', 'hipAbdR', 'kneeFlexR'],
  kneeL: ['hipFlexL', 'hipAbdL'], kneeR: ['hipFlexR', 'hipAbdR'],
  headTop: ['neckPitch', 'neckRoll', 'spinePitch', 'spineRoll'],
  pelvis: ['rootX', 'rootY']
};

function previewToFrame(e) {
  const hero = state.hero;
  const st = hero.getActiveFrameState();
  if (!st) return null;
  const rect = $('cvPreview').getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  let fx = (mx - hero.x) / hero.scale + st.frame.width / 2;
  const fy = (my - (hero.y - hero.z)) / hero.scale + st.frame.height * 0.75;
  if (st.flipX) fx = st.frame.width - fx;
  return { st, fx, fy };
}

function solveIK(joint, fx, fy, st) {
  const dofs = IK_DOFS[joint];
  const rig = state.rig;
  const err = () => {
    const j = rig.computeProjectedJoints(st.normAngle, st.frame.angleDeg, poseFromDeg(state.poseDeg));
    return (j[joint].x - fx) ** 2 + (j[joint].y - fy) ** 2;
  };
  if (joint.startsWith('ankle') || joint.startsWith('knee')) state.poseDeg['plant' + joint.slice(-1)] = 0;
  if (joint === 'pelvis') { state.poseDeg.plantL = 1; state.poseDeg.plantR = 1; }
  let e0 = err();
  for (const start of [16, 6, 2, 0.6]) {
    for (let pass = 0; pass < 6; pass++) {
      let improved = false;
      for (const k of dofs) {
        const [min, max] = DOF_RANGE(k);
        const step = LINEAR_DOF.has(k) ? start / 120 : start;
        for (const dir of [1, -1]) {
          const old = state.poseDeg[k] || 0;
          state.poseDeg[k] = Math.max(min, Math.min(max, old + dir * step));
          const e1 = err();
          if (e1 < e0) { e0 = e1; improved = true; break; }
          state.poseDeg[k] = old;
        }
      }
      if (!improved) break;
    }
  }
  syncDofSliders();
}

$('cvPreview').addEventListener('pointerdown', (e) => {
  if (!$('chkPoseMode').checked || !state.rig) return;
  const pt = previewToFrame(e);
  if (!pt) return;
  const j = state.rig.joints2D;
  let best = null, bestD = 14 / state.hero.scale;
  for (const n of Object.keys(IK_DOFS)) {
    const d = Math.hypot(j[n].x - pt.fx, j[n].y - pt.fy);
    if (d < bestD) { bestD = d; best = n; }
  }
  if (!best) return;
  state.ikDrag = best;
  capture($('cvPreview'), e);
  setStatus(`Dragging <strong>${best}</strong>`);
});
$('cvPreview').addEventListener('pointermove', (e) => {
  if (!state.ikDrag) return;
  const pt = previewToFrame(e);
  if (pt) solveIK(state.ikDrag, pt.fx, pt.fy, pt.st);
});
$('cvPreview').addEventListener('pointerup', () => { state.ikDrag = null; });
$('chkPoseMode').addEventListener('change', (e) => {
  if (e.target.checked) {
    $('chkSkel').checked = true;
    $('chkWalk').checked = false;
    state.hero.stop();
    setStatus('<strong>Pose mode:</strong> drag the hands, feet, elbows, knees, head top or hips in the preview.');
  }
});

// Keyframes (stored in degrees, like the built-in clips)
state.clip = { duration: 1.2, loop: true, keys: [] };
const keyTime = () => +$('rngKeyTime').value;
function renderKeyBar() {
  const bar = $('keyBar');
  bar.innerHTML = '';
  for (const k of state.clip.keys) {
    const m = document.createElement('span');
    m.style.left = `${(k.t / state.clip.duration) * 100}%`;
    bar.appendChild(m);
  }
  $('lblKeyTime').textContent = `${keyTime().toFixed(2)} s · ${state.clip.keys.length} key(s)`;
}
function syncClipSettings() {
  state.clip.duration = Math.max(0.1, +$('numClipLen').value);
  state.clip.loop = $('chkClipLoop').checked;
  $('rngKeyTime').max = state.clip.duration;
  renderKeyBar();
}
$('numClipLen').addEventListener('input', syncClipSettings);
$('chkClipLoop').addEventListener('change', syncClipSettings);
$('rngKeyTime').addEventListener('input', () => {
  if (state.clip.keys.length) {
    delete state.clip._tracks;
    state.poseDeg = degFromPose(sampleClip(state.clip, keyTime(), false));
    syncDofSliders();
  }
  renderKeyBar();
});
$('btnSetKey').addEventListener('click', () => {
  const t = Math.round(keyTime() * 100) / 100;
  const pose = {};
  for (const k of ALL_DOFS) pose[k] = Math.round((state.poseDeg[k] || 0) * 100) / 100;
  state.clip.keys = state.clip.keys.filter((k) => Math.abs(k.t - t) > 0.02);
  state.clip.keys.push({ t, pose });
  state.clip.keys.sort((a, b) => a.t - b.t);
  delete state.clip._tracks;
  renderKeyBar();
  setStatus(`Key set at <strong>${t.toFixed(2)} s</strong>. Move the time slider, change the pose, set another key.`);
});
$('btnDelKey').addEventListener('click', () => {
  const t = keyTime();
  state.clip.keys = state.clip.keys.filter((k) => Math.abs(k.t - t) > 0.03);
  delete state.clip._tracks;
  renderKeyBar();
});
function currentClip() {
  syncClipSettings();
  if (!state.clip.keys.length) throw new Error('set at least one key first');
  return JSON.parse(JSON.stringify({ duration: state.clip.duration, loop: state.clip.loop, keys: state.clip.keys }));
}
$('btnPlayClip').addEventListener('click', () => guard('Playing', async () => {
  const clip = currentClip();
  $('chkPoseMode').checked = false;
  state.hero.animator.addClips({ [$('txtClip').value]: clip });
  state.hero.play($('txtClip').value, { speed: +$('rngClipSpeed').value });
  setStatus(`Playing <strong>${$('txtClip').value}</strong>.`);
}));
$('btnSaveClip').addEventListener('click', () => guard('Saving', async () => {
  const name = $('txtClip').value.trim() || 'my-move';
  const clip = currentClip();
  state.profile.animations[name] = clip;
  state.hero.animator.addClips({ [name]: clip });
  renderClipList();
  setStatus(`<strong>Saved "${name}"</strong> to this character. Export character.json to keep it.`);
}));

buildSliders();
buildDofSliders();
syncClipSettings();
updateUsage();
requestAnimationFrame(frameLoop);
$('btnKnight').click();
