# Strange Dominion

A real-time fleet strategy sandbox with tactical pause. Every civilization you meet can change what your empire becomes, both mechanically and visually.

This is the **first playable version**. It covers one complete expedition: leave a home system, discover a generated civilization, resolve the encounter by a real choice, and return with a visibly changed fleet.

It uses **no engine and no libraries**. Everything is hand-written in plain JavaScript modules: a WebGL2 renderer, procedural low-poly meshes, the simulation and the UI. There is no build step.

## Running it

ES modules need to be served over HTTP. Opening `index.html` straight from disk won't work. From the repository root:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Any static server works. Add `?low` to the URL to force the reduced-effects mode that phones use automatically.

You need a browser with WebGL2 (any current desktop or mobile browser).

## What's in this version

**Three starting factions.** Each has its own geometry, animation, weapons and passive abilities.

| Faction | Looks & moves | Plays |
|---|---|---|
| The Bloom | Lofted organic hulls, layered shell plates that breathe, luminous veins, swaying tendrils | Hull regeneration, boarding spores (stacking damage, double against crippled engines), sheds shell when shields fail. **Grows** new ships: a pod swells at the nursery |
| The Array | Modular spines, counter-rotating rings, sliding armour, orbiting drones | Network damage bonus for ships flying close together. The flagship jams enemy fire rate and suppresses synthetic archive networks. **Assembles** ships: components fly in and lock together |
| The Ascendancy | Ivory/navy hulls with gold markings, lit hangar decks, bridge towers | Heavy shields, a carrier that launches and recovers fighters, a diplomatic trust bonus. **Launches** ships out of a monumental drydock |

**Home system.** You start with a flagship, two escorts and a scout. Investigating the derelict wreck calibrates the jump drive and acts as the tutorial (select, move, scan). The shipyard builds escorts, scouts and repair ships. Inheritances change the home system: trait arrays appear around your station in your faction's style, captured or hybrid alien structures are rebuilt there, and envoys from allied civilizations visit.

**Layered civilization generator** (`js/generator.js`). Each layer constrains the next:

stellar environment → habitat → species structure → technology → society → history

Species and civilization are separate names. Every civilization has a **signature capability**, a **landmark**, a **current problem** and a **vulnerability**. Each has a mechanical effect:

- A Conductor that shares shields across the fleet.
- An Archive Core that coordinates fire (+35% damage).
- A command organism whose death makes the fleet rout.

System palettes, ships, stations and landmarks all come from the same generated design language.

**Encounters** (`js/encounter.js`). None of these is a dice roll.

- **Intel.** Scan the capital (priorities, true strength), the landmark (history, signature, access point) and the unidentified vessel (vulnerability). Threat estimates stay a range until you have scanned.
- **Befriend.** Hail, solve their problem (escort a convoy or break a blockade), gift materials or threaten their capital. Then propose safe passage, trade, research exchange, alliance or protectorate. Evaluation is deterministic: it uses the civilization's persistent priorities and what you have actually done. Repeating an unchanged offer gets the same answer, and factors you haven't uncovered show up only as "considerations you have not uncovered". Friendship marks a system **allied**. A **protectorate** (voluntary accession) comes later.
- **Assimilate.** Move ships to a known access point and start integration. Then defend the site against resistance waves and the specific risk set by their vulnerability. It uses integration capacity.
- **Conquer.** Defeat their fleet and break the capital below 25% hull, at which point your ships hold fire. Hold the area to force surrender and keep the shipyard. Or explicitly order the attack to destroy it: more salvage, no shipyard.

**Inheritance** (`js/data.js` → `TRAITS`, `js/designs.js` → `addTraitVisual`). There are four capabilities:

- Resonant Shields
- Gravity Lance
- Living Hull Weave
- Assembler Swarm

Each faction expresses each one differently. For example, Resonant Shields become crystalline organs on the Bloom, unfolding lattices on the Array and rotating emitters on the Ascendancy.

How you got a capability sets its tier:

| How you got it | Tier | Strength |
|---|---|---|
| Conquest | Schematic | ×0.6 |
| Treaty | Licence | ×0.85, lost if the treaty breaks |
| Assimilation | Integrated | ×1.15 |

Ships have limited adaptation slots, filled in the Adaptation Bay at home.

**Combat** (`js/sim.js`). Roles and weapon tags matter:

- Flak weapons shred fighters; heavy guns hit capitals and stations.
- Below 35% hull, engines are crippled and the ship limps and smokes.
- Repair ships mend allies, and the home station repairs everything nearby.
- Orders: formation moves with automatic separation on a stable reference plane, plus optional elevation (Z/V).
- A pulsar hazard sweeps shields in remnant systems.

**Camera.** One live simulation spans close inspection, fleet view and system overview. Zoom transitions are smooth, with tracking, free orbit, tactical icons at range and an instant return-to-fleet (F). The galaxy map is a separate strategic view. While you're away, unresolved systems build up raider pressure, and treaties and territory earn income.

**Endpoint.** When every reachable civilization is part of your sphere (owned or allied), you get a regional-dominion banner, and play can continue.

## Controls

| Input | Action |
|---|---|
| Left click / drag | Select / box-select (Shift adds). Double-click selects a whole class |
| Right click | Move (keeps formation) · attack an enemy · scan a target |
| Right drag · middle drag · wheel | Orbit · pan · zoom |
| WASD / arrows · Q | Pan · rotate |
| Space · 1 / 2 / 3 | Tactical pause (orders still accepted) · time speed |
| F · T · Tab · H | Return to fleet · track selection · cycle camera scale · focus station |
| Z / V | Raise / lower selected ships |
| X · Ctrl+A · Esc | Stop · select all · close / deselect |
| E · B · R · C · G | Expedition planner · Shipyard · Adaptation Bay · Dossier · Galaxy map |
| Touch | Tap select/order · drag orbit · pinch zoom/pan · long-press radial menu · bottom-right quick bar |
| `` ` `` | Debug readout (fps, draw calls, triangles) |

## Code map

| File | Purpose |
|---|---|
| `js/gl.js` | WebGL2 renderer: faceted lit meshes (flat normals from screen derivatives), procedural nebula/star sky, one additive batch for glows, beams, rings and particles |
| `js/meshgen.js` | Triangle builder with painted colour variation; box, cylinder, icosphere, torus, loft, shard, tube; planets and asteroid fields |
| `js/designs.js` | Ship, station, landmark and integration-site designs as animated parts (spin, pulse, sway, orbit, slide); faction trait expressions |
| `js/sim.js` | Local simulation: steering, separation, orders, AI, weapons, shields, damage-over-time, fighters, auras, hazards, effects |
| `js/generator.js` | Galaxy and layered civilization generation |
| `js/encounter.js` | Intel, negotiation, missions, integration, conquest, outcomes |
| `js/systems.js` | Home and civilization world builders, home upgrades, persistence snapshots |
| `js/render.js` | World rendering, LOD, and the 2D tactical overlay |
| `js/camera.js`, `js/input.js`, `js/ui.js`, `js/main.js` | Camera, input, DOM UI, game orchestration |

## Not yet built

These parts of the full design are intentionally left out of this slice:

- Saving and loading
- Audio
- Forward bases and mobile support ships
- Diplomacy between alien civilizations
- Galaxy-wide expansion beyond the three reachable systems
- Integrated alien hull production at home

Frame rate has been checked only in a headless software renderer, which says nothing about real hardware. The 60 FPS desktop target still needs profiling on real GPUs.
