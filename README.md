# Canvas Sprite Skeletal Animation (JavaScript)

**Procedural walk-cycle animation for ANY 2D game character with pure JavaScript and HTML5 Canvas.**
Turn static character art (a 360° turnaround GIF, PNG frames, or a single image) into a fully
animated, walking, jumping, attacking game character: no Spine, no DragonBones, no hand-drawn
animation frames, no dependencies.

**[▶ Live demo](https://blackmoon87.github.io/canvas-sprite-skeletal-animation-js/)** ·
**[🛠 Character Rig Editor](https://blackmoon87.github.io/canvas-sprite-skeletal-animation-js/editor.html)**

![Knight sprite turnaround](characters/knight/knight_spritesheet.png)

## Make your own character (no code)

1. Open the **[Character Rig Editor](https://blackmoon87.github.io/canvas-sprite-skeletal-animation-js/editor.html)** (`editor.html`).
2. Load your art (in an **A-pose**, see the requirement below): a **turnaround GIF**, **PNG frames** from
   front (0°) → right side (90°) → back (180°),
   **one image** (front or side view), or an existing sprite sheet + atlas.
   Plain, gradient or transparent backgrounds are removed automatically.
3. Press **Auto-rig**. Every joint is placed from the silhouette (*chibi* or *realistic human* body type).
4. Drag joints to fine-tune: the **front view** sets left/right and height, the **side view** sets depth.
   Colored overlays show which pixels each body part moves.
5. Optional: pick cloth colors (cape, skirt, tabard), adjust body-part sizes and walk style.
6. Check the **preview** at every angle, or **play test** it with WASD / arrows, Space, E.
7. **Export**: `character.json` + sprite sheet `.png` + atlas `.json`. Put them in `characters/<name>/`.

### Clean any art: busy photos, video frames, watermarks

The **Clean & Parts** tab handles art that automatic background removal can't:

- **⭕ Keep inside border**: draw around the character; everything outside is erased.
- **🧹 Remove background left around the edges**: grows from the erased area while colors change smoothly and
  stops at the character's outline. Border + 🧹 cuts a character out of a busy studio photo.
- **✂ Erase inside border**, **🧽 eraser**, **🖌 restore** (brings back the original pixels), **🪄 magic wand**,
  **✨ remove specks**, and undo. Border / wand tools can apply to every frame at once.
- **Body parts**: pick *arm L / arm R / leg L / leg R / head / torso / front cloth / back cloth* and paint, or draw a
  border. For a limb, the border is its exact outline. Use this when arms touch the body or sleeves match the shirt.
  Painted parts are exported as `<name>_labels.png`.

### Animate it

The **Animate** tab plays the built-in moves on your character and lets you make new ones:

- **Pose mode**: drag hands, elbows, feet, knees, head or hips in the preview (inverse kinematics), or use
  per-joint sliders (shoulder raise / side raise / twist, elbow, hip, knee, ankle, spine, neck, root, planted feet).
- **Keyframes**: set poses at times, scrub and play, then **save** the clip into the character. It is
  exported in `character.json` and plays in the game with `hero.play('my-move')`.

### Input requirement: A-pose, parts clearly separated

Draw / render / export your character as a **biped (2 arms, 2 legs) standing in an A-pose**:

- arms held **away from the body** (about 20–45°), with a visible gap between each arm and the torso
- legs **apart**, with a gap between them; feet flat on the floor
- hands and feet **fully visible** (not hidden behind the body, in pockets, or holding large props)
- a plain, gradient or transparent background (busy backgrounds can be cleaned in the editor)

Every motion (walk, wave, dance, jump) is made by moving these parts, so the rig must be able to tell them
apart. When parts are spaced out, auto-rig separates them by itself; the editor checks this and warns when an
arm or the legs touch the body. Art where limbs touch the body still works if you outline the limbs with
*Body parts* in the editor, but it takes manual work. Poses like squatting, sitting or arms raised high are not
supported as input. For the best result use a full turnaround; with one image, every angle uses it.

## Features

- **Skeletal rig on raw pixels:** a hierarchical bone and joint skeleton (pelvis, spine, neck, head,
  shoulders, elbows, wrists, hips, knees, ankles, toes, heels, tabard and cape) skins the sprite's
  `ImageData` buffer directly.
- **Works from every angle (360°):** 36 pre-rendered angles (72 effective with mirroring).
  The rest pose is fitted to each frame's real turntable angle, so bones line up with the pixels.
- **Realistic gait:** knee hinge flexion in swing, heel-strike → flat foot → heel-off → toe-off,
  contralateral arm swing, pelvis rotation, and a body bob solved from the planted foot (ground IK).
- **No foot sliding:** walk phase speed is matched to stride length.
- **Layered skinning:** each sprite frame is segmented into body parts (head, torso, arms, legs,
  front tabard, back cape). Every part moves only its own pixels and layers are painted back to
  front, so limbs never drag the body along. Hidden torso behind the arm is reconstructed in profile.
- **Fast:** walk poses are quantized and cached, so it runs at full frame rate in a normal game loop.
- **Any character:** a JSON character profile describes the skeleton, body-part sizes, cloth
  colors and walk style; make one with the visual editor (auto-rig + drag joints).
- **Game-ready object:** `GameCharacter` with 8-direction / mouse movement, jump physics, dash with
  after-images, spin attack, footstep dust, pixel-perfect collision (`hitTestPixel`).
- **Pixel shaders on `ImageData`:** pixelate, neon edge, thermal, hologram, hit flash.
- **Extras:** pixel particle shatter, 3D voxel point cloud, live GIF frame decoding (`ImageDecoder`)
  with de-dither and background keying.

## Quick start

ES modules need a local web server (opening `index.html` from the file system will not work):

```bash
git clone https://github.com/blackmoon87/canvas-sprite-skeletal-animation-js.git
cd canvas-sprite-skeletal-animation-js
python3 -m http.server 8000
# open http://localhost:8000
```

Controls: **WASD / arrows** move · **click** move · **Space** jump · **Shift** dash · **E** spin attack.
In the *Raw ImageData Inspector* tab, enable *Walk-in-Place Demo* and set the rotation to 90° to
study the side-view walk cycle.

## Use it in your game

```js
import { GameCharacter } from './pixel_knight.js';

const player = await GameCharacter.load('./characters/knight/character.json', { x: 400, y: 300 });

function gameLoop(dt) {
  player.update(dt, { right: keys.ArrowRight, left: keys.ArrowLeft, up: keys.ArrowUp, down: keys.ArrowDown });
  player.draw(ctx, { showSkeleton: false });
}
```

`player.jump()` (crouch → take-off → tuck → landing), `player.attack()`, `player.dash(dx, dy)`,
`player.hitTestPixel(x, y)` and `player.setProfile(profile)` (swap characters) are available too.
Pass `{ run: true }` in the input to run. `PixelKnight` still works as an alias.

### Animations

```js
player.play('wave-right');          // plays over walking (only the right arm is taken over)
player.play('sit');                 // holds the last pose until stopped
player.stop('sit');
player.play('hip-sway', { speed: 1.5 });
player.animations;                  // every clip name, including the character's own
```

Built-in clips: `wave-right`, `wave-left`, `cheer`, `clap`, `point-right`, `dab`, `hands-on-hips`, `think`,
`hand-to-face`, `bow`, `sit`, `crouch`, `jump`, `kick`, `leg-lift`, `hip-sway`, `step-touch`, `arms-out-groove`,
`victory`, `flinch`, `look-around`, `slash`. L / R mean the limb on the viewer's left / right in the front view.

A clip is plain JSON (angles in degrees, root offsets as a fraction of leg length, `plantL` / `plantR` keep a
foot planted while the body moves):

```js
{
  "duration": 1.2, "loop": true, "mask": ["armR"],
  "keys": [
    { "t": 0,   "pose": { "shoulderAbdR": 125, "shoulderTwistR": 90, "elbowFlexR": 40 } },
    { "t": 0.3, "pose": { "elbowFlexR": 85 } }
  ]
}
```

Lower level: `rig.renderPose(frame, pose, facingDeg)` skins any pose (see `SkeletalRig.POSE_KEYS`);
`animations.js` exports `CLIPS`, `sampleClip()` and the layered `Animator`.

Use the rig directly on any sprite frame:

```js
import { SkeletalRig } from './skeletal_rig.js';

const rig = new SkeletalRig(profile);   // profile = parsed character.json
const imageData = rig.renderRiggedFrame(frame, walkPhase, walkIntensity, facingDeg);
```

Prepare frames from your own art in code (`sprite_tools.js`):

```js
import { decodeGifFrames, prepareFrames, buildSpriteSheet } from './sprite_tools.js';

const raws = await decodeGifFrames(gifBlob, { frameCount: 36, coverage: 360 });
const frames = prepareFrames(raws, { keying: 'auto', targetHeight: 335 });
const { canvas, atlas } = buildSpriteSheet(frames);
```

## Character profile (`character.json`)

| Field | Meaning |
| --- | --- |
| `joints` | 24 joints. `x`, `y`: pixels in the front (0°) frame. `z`: forward offset from the pelvis, seen in the side (90°) frame |
| `segmentation` | arm / hand / leg thickness, where the legs start, `armEdges` (separate arms by color edges) |
| `cloth` | `mode`: `none`, `colors` (picked colors + `tolerance`) or `dominantRed` |
| `gait` | stride, knee lift, heel–toe roll, arm swing, lean, hip twist, cape trail, camera tilt |
| `yawTable` / `armTable` | optional measured corrections for turntables that don't rotate evenly (see the knight) |
| `animations` | the character's own clips (made in the editor's Animate tab) |
| `sprite` | sprite sheet, atlas and optional labels sheet file names, relative to the profile |

## Files

| File | What it does |
| --- | --- |
| `skeletal_rig.js` | Profile-driven skeleton, gait kinematics, forward kinematics + ground contact, frame segmentation, layered skinning |
| `pixel_knight.js` | `GameCharacter` game object and `CanvasPixelProcessor` (shaders, GIF decoding, point cloud) |
| `animations.js` | Keyframe clips, built-in move library, layered `Animator` |
| `sprite_tools.js` | GIF / PNG loading, background removal, cropping, sprite sheet + labels sheet packing |
| `editor.html` / `editor.js` | Visual Character Rig Editor |
| `index.html` | Demo studio: playable arena, particles, voxel view, ImageData inspector |
| `characters/knight/` | Example character: `character.json`, 36-angle sprite sheet + atlas, source GIF |

## Keywords

JavaScript sprite animation, character rigging tool, auto rig, keyframe animation, inverse kinematics editor,
background removal, HTML5 canvas game, procedural animation, 2D skeletal animation,
inverse kinematics, walk cycle, pixel manipulation, ImageData, game development, indie game,
360 degree sprite, no-dependency game engine.

## License

[MIT](LICENSE)
