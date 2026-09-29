# Stair B – three floors

A 3D recreation of one stairwell (Levels 1–3), rebuilt from five photos. Only the stair core is modelled, with nothing outside it.

Open `index.html` in a browser. Three.js loads from a CDN, so it needs a connection. If you open the file directly and the module import is blocked, serve the folder instead, e.g. `npx http-server stairwell-3d`.

## What is in the model

Taken from the photos:

- Two-flight switchback stair with yellow steel stringers and risers, concrete treads, yellow guard with stainless handrail, and wall-mounted handrails.
- Painted-CMU east wall, painted drywall elsewhere, black rubber base, and wall-mounted strip lights.
- Level 2 birch door in a dark hollow-metal frame, with closer, lever set and the "STAIR B / LEVEL 2" sign; doors and signs on all three levels.
- The fire-standpipe corner: 6" riser, thin drain pipe, and a 4" branch carrying an OS&Y valve with blue hand-wheel and tags, flow switch, pressure gauge, inspector's-test line, and brass hose valve. It repeats on each level with flex conduit to a junction box, and floor sleeves with firestop.
- Sprayed-fireproofing deck ceiling with beams above Level 3, with the pipes ending at it.
- Detail passes: stencilled mill markings and a paper label on the black pipe, conduit fittings, a chain for the test sign, angle-iron landing edges, toe boards on the guards, and scuffed paint.

Not in the photos, so it is a guess: overall dimensions (4.2 m floor to floor, 12 × 175 mm risers per flight, 1.2 m flight width), the layout of the rest of the well, and the Level 1 and 3 signage.

## Lighting

Fluorescent strips on the walls are modelled as area lights, with five of them also casting shadows. The scene is static, so those shadow maps are rendered once and reused. Screen-space ambient occlusion darkens corners and the undersides of the flights, and a light bloom makes the lenses glow. Both effects can be switched off with the "Ambient occlusion and glow" checkbox, and "Lights on" turns the fixtures off. The effects start off on phones and other touch screens.

## Controls

- **Orbit**: drag / wheel / right-drag. Walls facing the camera are cut away automatically.
- **Walk**: W A S D or arrows (Shift = run), drag to look. The stairs are climbable, and pipes and the open well are solid.
- Buttons jump to views that match the reference photos (riser corner, door + sign, stair flights, looking up at the deck) and to each level.
