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
2. Load your art: a **turnaround GIF**, **PNG frames** from front (0°) → right side (90°) → back (180°),
   **one image** (front or side view), or an existing sprite sheet + atlas.
   Plain, gradient or transparent backgrounds are removed automatically.
3. Press **Auto-rig**. Every joint is placed from the silhouette (*chibi* or *realistic human* body type).
4. Drag joints to fine-tune: the **front view** sets left/right and height, the **side view** sets depth.
   Colored overlays show which pixels each body part moves.
5. Optional: pick cloth colors (cape, skirt, tabard), adjust body-part sizes and walk style.
6. Check the **preview** at every angle, or **play test** it with WASD / arrows, Space, E.
7. **Export**: `character.json` + sprite sheet `.png` + atlas `.json`. Put them in `characters/<name>/`.

Works for bipeds (2 arms, 2 legs) drawn in a neutral standing pose (arms down or slightly out,
legs straight). Poses like squatting, sitting or arms raised high need manual joint work and won't
give a natural walk. For the best result use a full turnaround; with one image, every angle uses it.

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

`player.jump()`, `player.attack()`, `player.dash(dx, dy)`, `player.hitTestPixel(x, y)` and
`player.setProfile(profile)` (swap characters) are available too. `PixelKnight` still works as an alias.

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
| `segmentation` | arm / hand / leg thickness and where the legs start, in sprite pixels |
| `cloth` | `mode`: `none`, `colors` (picked colors + `tolerance`) or `dominantRed` |
| `gait` | stride, knee lift, heel–toe roll, arm swing, lean, hip twist, cape trail, camera tilt |
| `yawTable` / `armTable` | optional measured corrections for turntables that don't rotate evenly (see the knight) |
| `sprite` | sprite sheet + atlas file names, relative to the profile |

## Files

| File | What it does |
| --- | --- |
| `skeletal_rig.js` | Profile-driven skeleton, gait kinematics, forward kinematics + ground contact, frame segmentation, layered skinning |
| `pixel_knight.js` | `GameCharacter` game object and `CanvasPixelProcessor` (shaders, GIF decoding, point cloud) |
| `sprite_tools.js` | GIF / PNG loading, background removal, cropping, sprite sheet packing |
| `editor.html` / `editor.js` | Visual Character Rig Editor |
| `index.html` | Demo studio: playable arena, particles, voxel view, ImageData inspector |
| `characters/knight/` | Example character: `character.json`, 36-angle sprite sheet + atlas, source GIF |

## Keywords

JavaScript sprite animation, character rigging tool, auto rig, HTML5 canvas game, procedural animation, 2D skeletal animation,
inverse kinematics, walk cycle, pixel manipulation, ImageData, game development, indie game,
360 degree sprite, no-dependency game engine.

## License

[MIT](LICENSE)
