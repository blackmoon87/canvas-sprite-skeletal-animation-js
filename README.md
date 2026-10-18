# Canvas Sprite Skeletal Animation (JavaScript)

**Turn still pictures of a character into a moving game character, in plain JavaScript and HTML5 Canvas.**
Give it images of your character from a few angles; it builds a skeleton, and your character can walk,
run, jump, wave, dance and turn in every direction. No Spine, no DragonBones, no hand-drawn animation
frames, no dependencies.

**[▶ Live demo](https://blackmoon87.github.io/canvas-sprite-skeletal-animation-js/)** ·
**[🛠 Character Rig Editor](https://blackmoon87.github.io/canvas-sprite-skeletal-animation-js/editor.html)** ·
**[🎮 Minimal game example](https://blackmoon87.github.io/canvas-sprite-skeletal-animation-js/examples/basic-game.html)**

![The example knight from 36 angles](characters/knight/knight_spritesheet.png)

## How it works

1. **You prepare images** of your character standing in an A-pose, seen from several angles.
2. **The editor rigs it**: removes the background, places a skeleton, and finds which pixels belong to the
   head, body, arms and legs. You check and fix it, then export 3–4 files.
3. **Your game loads those files** with one line and moves the character with the keyboard, gamepad or AI.

The included **knight** (`characters/knight/`) is the reference example of every step.

---

## 1. What you need: images and angles

### The pose (required)

A **biped** (2 arms, 2 legs) standing in an **A-pose**:

| ✅ Do | ❌ Avoid |
| --- | --- |
| Arms held **away from the body** (about 20–45°), a gap you can see between arm and body | Arms against the body, hands in pockets, arms crossed |
| Legs **apart**, a gap between them, feet flat on the floor | Legs together, crossed, one foot lifted |
| Hands and feet **fully visible** | Hands behind the back, big props covering the body |
| Standing straight, looking forward | Sitting, squatting, arms raised high, action poses |

Every move (walk, wave, dance, jump) is made by moving these parts, so they must be easy to tell apart.
The editor checks this and warns you when an arm or the legs touch the body.

### How many images, which angles

The character turns on the spot like on a turntable. **Angle 0° = facing you**, **90° = facing the right
side of the screen**, **180° = facing away**. You only need **0° to 180°**: the other half of the turn is
made automatically by mirroring.

| Option | Images | Angles | Result |
| --- | --- | --- | --- |
| ⭐ **Best** | **36** | every 5°: 0°, 5°, 10° … 180° | smooth turning in every direction (the knight uses this) |
| 👍 **Good** | **9** | every 22.5°: 0°, 22.5°, 45°, 67.5°, 90°, 112.5°, 135°, 157.5°, 180° | good for 8–16 direction games |
| **Minimum (8 directions)** | **5** | 0°, 45°, 90°, 135°, 180° | front, diagonals, side, back |
| **Side-scroller / platformer** | **1** | 90° (facing right) | walks left and right (left is mirrored) |
| **Front only** | **1** | 0° | for menus or front-facing games |

More images = smoother turning. Any number between these also works; the angles must be **evenly spaced**
from 0° to 180°, in order.

### Image rules

- **Same image size** for every angle, the same zoom, and the camera at the same height.
- The character stands on the **same spot** in every image (turntable style), feet on the same line.
- **PNG with a transparent background** is best. A plain or gradient background is removed automatically;
  busy photos can be cleaned in the editor.
- At least **~300 px tall**. Bigger is fine; the editor scales it.
- Name the files so they sort in angle order: `00.png`, `01.png`, … (or `angle_000.png`, `angle_005.png`, …).
- Instead of PNG files you can load **one turntable GIF** (Chrome / Edge) or a sprite sheet + atlas.

**Ways to get these images:** render a 3D model on a turntable (Blender, any 3D tool), ask an AI image
generator for a "character turnaround sheet, A-pose, transparent background", or draw them.

**Symmetry:** because 180°–360° is mirrored, a character holding a sword in one hand will hold it in the
other hand when facing left. Keep characters roughly left/right symmetric for best results.

---

## 2. Make your character in the editor (no code)

Open **[editor.html](https://blackmoon87.github.io/canvas-sprite-skeletal-animation-js/editor.html)**
(or locally, see [Run it locally](#run-it-locally)). Click **Use the example knight** first to see a
finished character.

**Character tab**
1. **Load** your images: *PNG frames, front → back* (select all files), *One image*, or *Turntable GIF*.
2. **Auto-rig**: pick *chibi / big head* or *realistic human* and press **⚡ Auto-rig**. Read the status bar:
   ✓ means the parts are well separated; ⚠ names the parts that touch the body.
3. **Joints**: drag the dots. **View A** (front) sets left/right and height, **View B** (side) sets depth.
   Each view has a slider to pick any frame. The yellow line is the floor.
4. Optional: cloth colors (cape, skirt), body-part sizes, walk style.

**Clean & Parts tab**: fix the pixels
- Colors show which part each pixel moves with: head (blue), torso (grey), arm L (purple),
  arm R (pink), leg L (green), leg R (yellow), both legs overlapping in side views (cyan), cloth (red).
- Wrong part? Choose the **Part**, click **⭕ Border → part**, and click around it (close with Enter,
  a double-click, or a click on the first corner). For an arm or leg, the border is its exact outline.
- **Side views:** if the far foot is still visible behind the near one, mark it **leg R** in each side
  frame (move View B's slider through the frames).
- Leftover background: **⭕ Keep inside border**, **🧹 Remove background left around the edges**,
  eraser, restore, magic wand, remove specks, **↶ Undo**.

**Animate tab**: test and create moves
- Click any move to play it on your character. Tick **walk** to see it while walking.
- **Pose mode**: drag hands, feet, head or hips in the preview, set keys on the timeline, and
  **💾 Save to character** to create your own move.

**Export** (Character tab, step 7): type a name and click **⬇ Download character (all files)**:

```
characters/my-hero/
├── character.json          ← skeleton, settings, your own moves
├── my-hero_spritesheet.png ← all angles in one image
├── my-hero_atlas.json      ← where each angle is in the sheet
└── my-hero_labels.png      ← your body-part fixes (only if you made any)
```

Put the files in one folder. Your fixes exist only in the editor until you export.

---

## 3. Make it move in your game (script)

Copy `pixel_knight.js`, `skeletal_rig.js`, `animations.js`, `sprite_tools.js` and your character folder
into your project. The complete working example is
[`examples/basic-game.html`](examples/basic-game.html):

```html
<canvas id="game" width="960" height="600"></canvas>
<script type="module">
  import { GameCharacter } from './pixel_knight.js';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // 1. Load the character
  const hero = await GameCharacter.load('./characters/knight/character.json', {
    x: 480, y: 360, scale: 0.6, speed: 220
  });

  // 2. Keyboard
  const keys = {};
  addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'Space') hero.jump();
    if (e.code === 'Digit1') hero.play('wave-right');
  });
  addEventListener('keyup', (e) => { keys[e.code] = false; });

  // 3. Game loop: update, then draw
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    hero.update(dt, {
      left: keys.ArrowLeft, right: keys.ArrowRight,
      up: keys.ArrowUp, down: keys.ArrowDown,
      run: keys.ShiftLeft
    }, { width: canvas.width, height: canvas.height });
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hero.draw(ctx);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
</script>
```

The character turns to face where it walks, steps without sliding its feet, breathes when standing still,
and runs when `run` is held.

### GameCharacter API

| Call | What it does |
| --- | --- |
| `await GameCharacter.load(url, options)` | Loads `character.json` and its sprite files. Options: `x`, `y`, `scale`, `speed`, `runMultiplier` |
| `hero.update(dt, input, bounds)` | Moves and animates. `input`: `left`, `right`, `up`, `down`, `run`, optional `targetPos {x, y}` (walk to a point) and `mousePos` (face the mouse when `hero.aimWithMouse = true`). `bounds`: `{ width, height }` of the play area |
| `hero.draw(ctx, options)` | Draws shadow, character and effects. Options: `showSkeleton`, `showHitbox`, `shaderMode` |
| `hero.jump()` | Crouch → take-off → tuck → landing |
| `hero.play(name, { speed, loop, fade })` | Plays a move over walking, e.g. `'wave-right'` |
| `hero.stop(name)` / `hero.stop()` | Stops one move / all moves |
| `hero.animations` | Names of all moves, including the character's own |
| `hero.attack()`, `hero.dash(dx, dy)` | Sword slash with spin, quick dash |
| `hero.hitTestPixel(x, y)` | Pixel-perfect collision with the drawn character |
| `hero.facingDeg` | Facing direction: 0 = down / front, 90 = right, 180 = up / back, 270 = left |
| `hero.x`, `hero.y`, `hero.scale`, `hero.speed` | Position, size and speed; set them any time |
| `hero.setProfile(profile)` | Swap the character's skeleton (with `setFrames(frames)` for new images) |

### Moves (animations)

| Move | | Move | |
| --- | --- | --- | --- |
| `wave-right`, `wave-left` | wave one hand | `sit`, `crouch` | sit down / crouch (hold until `stop`) |
| `cheer` | both hands up, bouncing | `jump` | full jump in place |
| `clap` | clapping | `kick` | kick with the right leg |
| `point-right` | point to the side | `leg-lift` | dance leg lift |
| `dab` | dab | `hip-sway` | dance: sway hips side to side |
| `hands-on-hips` | hands on hips | `step-touch` | dance: step side to side |
| `think` | hand to chin | `arms-out-groove` | dance: arms out, groove |
| `hand-to-face` | shy hand to face | `victory` | fist pump |
| `bow` | bow | `flinch` | get hit |
| `look-around` | turn head left and right | `slash` | sword slash |

L / R in names and joints mean the limb on the **viewer's** left / right in the front view.
Your own moves from the editor's Animate tab are saved in `character.json` and play the same way:
`hero.play('my-move')`.

A move is plain JSON: angles in degrees, root offsets as a fraction of leg length, `plantL` / `plantR`
keep a foot on the ground while the body moves:

```json
{
  "duration": 1.2, "loop": true, "mask": ["armR"],
  "keys": [
    { "t": 0,   "pose": { "shoulderAbdR": 125, "shoulderTwistR": 90, "elbowFlexR": 40 } },
    { "t": 0.3, "pose": { "elbowFlexR": 85 } }
  ]
}
```

---

## Run it locally

The pages use JavaScript modules, so open them through a local web server (double-clicking the HTML file
won't work):

```bash
git clone https://github.com/blackmoon87/canvas-sprite-skeletal-animation-js.git
cd canvas-sprite-skeletal-animation-js
python3 -m http.server 8000
```

Then open:
- http://localhost:8000/ — demo (WASD / arrows, Space jump, Shift dash, E spin attack, R run, 1–9 moves)
- http://localhost:8000/editor.html — Character Rig Editor
- http://localhost:8000/examples/basic-game.html — minimal game example

## Project files

| File | What it does |
| --- | --- |
| `pixel_knight.js` | `GameCharacter`: loading, movement, jump, moves, drawing, collision |
| `skeletal_rig.js` | Skeleton, walking, foot contact, body-part detection, pixel skinning |
| `animations.js` | Moves library and the `Animator` that plays them over walking |
| `sprite_tools.js` | Loading GIF / PNG, background removal, sprite sheet packing |
| `editor.html`, `editor.js` | Character Rig Editor |
| `index.html` | Demo: play area, pixel particles, voxel view, pixel inspector |
| `examples/basic-game.html` | Minimal game using a character |
| `characters/knight/` | The example character (36 angles, `character.json`, sprite sheet, atlas, source GIF) |

<details>
<summary><strong>character.json reference</strong></summary>

| Field | Meaning |
| --- | --- |
| `joints` | 24 joints. `x`, `y`: pixels in the front (0°) image. `z`: forward / back offset from the pelvis, seen in the side (90°) image |
| `segmentation` | arm / hand / leg thickness, where the legs start, `armEdges` (separate arms by color edges) |
| `cloth` | `mode`: `none`, `colors` (picked colors + `tolerance`) or `dominantRed` |
| `gait` | stride, knee lift, heel–toe roll, arm swing, lean, hip twist, cape trail, camera tilt |
| `yawTable` / `armTable` | optional measured corrections for turntables that don't turn evenly (see the knight) |
| `animations` | the character's own moves |
| `sprite` | sprite sheet, atlas and optional labels file names, relative to `character.json` |

Lower level: `new SkeletalRig(profile).renderPose(frame, pose, facingDeg)` draws any pose
(`SkeletalRig.POSE_KEYS` lists the joint controls); `animations.js` exports `CLIPS`, `sampleClip()` and `Animator`.
</details>

## Limits

- Bipeds only (2 arms, 2 legs): no animals, wings or tails yet.
- 180°–360° is mirrored from 0°–180°, so one-sided details swap hands when facing left.
- Turntable GIF loading needs Chrome or Edge (PNG frames work everywhere).
- In side views, a far foot visible behind the near one must be marked by hand (see the editor steps).

## License

[MIT](LICENSE)

<sub>Keywords: JavaScript sprite animation, 2D character rigging, auto rig, skeletal animation, procedural
walk cycle, keyframe animation, inverse kinematics, HTML5 canvas game, 360 degree sprite, game development,
indie game, no-dependency game engine.</sub>
