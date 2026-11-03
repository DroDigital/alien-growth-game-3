# Strange Dominion

A real-time fleet strategy sandbox with tactical pause. Every civilization you meet can change what your empire becomes, both mechanically and visually.

It uses **no engine and no libraries**. Everything is hand-written in plain JavaScript modules: a WebGL2 renderer, procedural low-poly meshes, WebAudio synthesis, the simulation and the UI. There is no build step and there are no asset files.

## Running it

ES modules need to be served over HTTP. Opening `index.html` straight from disk won't work. From the repository root:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Any static server works. Add `?low` to the URL to force the reduced-effects mode that phones use automatically. You need a browser with WebGL2.

The campaign autosaves every minute, after every jump and after every outcome. **Continue** on the title screen resumes it.

## The loop

**Prepare → choose a destination → jump → gather intelligence → resolve encounters → establish a foothold → refit or continue.**

You start in your faction's home system with a flagship, two escorts and a scout. A derelict wreck teaches the controls and gives you the jump routes. From there you work outward through a cluster of nine connected systems, set inside a galaxy of thousands of stars you can't yet reach.

## Factions

Every faction can conquer, assimilate and befriend. What differs is how they do it and what it costs them.

| Faction | Specialty | Abilities (J / K) | Weakness |
|---|---|---|---|
| **The Bloom**: living ships that breathe, sway and shed shell | Regeneration, boarding spores, and every escort can board crippled ships. **Grows** its ships | *Regenerative surge*, *Spore bloom* | Healing and growth draw on **biological reserves**. When reserves run dry, the ships stop healing |
| **The Array**: modular machines with rotating rings and orbiting drones | Network damage bonus, electronic warfare, jamming. **Assembles** its ships | *Overclock network*, *Electronic intrusion* | Network bonuses need a **command link** to the flagship. Isolated ships fight worse |
| **The Ascendancy**: crewed carriers with lit hangars and gold markings | Heavy shields, fighters, a diplomatic trust bonus. **Launches** its ships from a drydock | *Brace shields*, *Scramble wing* | Crews earn **veterancy** (★ up to 3, +8% damage per rank). Losing a veteran costs more than the hull |

## The cluster

The cluster is a lane graph. You can jump along a lane from where you are, and the jump home is always free. Every other jump costs **energy**, so a shortage can delay you but never strands you.

There are nine systems:

- **Home**
- **Four civilizations**, two of which may share a species family but differ in society. Species and civilization are separate things.
- **Four uninhabited systems:**
  - A **ship graveyard**: salvage, plus a dormant frigate you can restore, though restoring it draws scavengers.
  - A **leviathan migration route**: study vast passive organisms for knowledge.
  - A **research anomaly**: extract its data while surges strip your shields.
  - An **ancient relay**: destroy its scavenger garrison and activate it. Every surveyed system then becomes one jump away, at half the energy.

Civilizations are generated in dependency order:

stellar environment → habitat → species structure → technology → society → history

Each one has a **signature capability**, a **landmark**, a **current problem** and a **vulnerability** with a mechanical effect: a shield-sharing Conductor, a fire-coordinating Archive Core, or a command organism whose death makes the fleet rout.

**Ion storms** are readable terrain. Inside one, shields don't recharge, weapon range drops by 30% and scanning slows.

## Encounters

**Intel.** Scan the capital, the landmark and the unidentified vessel. Threat estimates, negotiation outlooks and integration risks all narrow as you learn more.

**Befriend.** Hail them, solve their problem (escort a convoy or break a blockade), send gifts or threaten their capital. Then propose one of these:

- Safe passage
- Trade
- Research exchange
- Alliance
- Protectorate (voluntary accession)

Responses are deterministic. Each proposal shows an **outlook** first ("Will accept", "Likely", "Uncertain", "Will refuse"), which widens with every factor you haven't uncovered. A refusal usually comes with **terms** that follow what they value: tribute for a trading society, knowledge for an archival one, "deal with our raiders first" for one that fears its neighbour. Some refusals are firm. Repeating an unchanged offer gets the same answer.

Friendship marks a system **allied**, not owned, and allies expect you to answer when they're raided.

**Assimilate.** Move ships to a known access point, then defend the integration site against resistance waves and the risk their vulnerability creates. If the site falls, their society splits and **breakaway forces** attack everyone. Assimilation uses integration capacity.

**Conquer.**

1. Defeat their fleet.
2. Break the capital below 25% hull. Your ships then hold fire.
3. Hold the area to force surrender, which is faster if you've knocked out its **command** subsystem.

The alternative to step 3 is to order the attack and destroy the capital: more salvage, but no shipyard.

## Combat

Combat runs in real time with tactical pause (Space) and 1×, 2× or 3× speed.

- **Subsystems.** Capital ships and stations have engines, weapons, shields and command. Attack a target, then choose a subsystem in the selection panel to focus fire on.
  - Disabled engines leave a ship **adrift**.
  - Disabled weapons fall silent.
  - Disabled shields collapse.
  - Disabled command breaks keystone auras and Array command links.
- **Boarding.** Research boarding doctrine to build boarding craft (Bloom escorts can board too). Right-click a ship that's adrift or below 30% hull to board it. The fleet holds fire while the boarders work, and the **captured** ship joins your fleet.
- **Formations:** keep, protected core, broad line or encirclement.
- **Orders:** hold position, withdraw to the jump point, escort (right-click a friendly ship), and elevation for vertical manoeuvres.
- **Weapon roles.** Flak weapons shred fighters and heavy guns hit capitals. Below 35% hull, a ship limps and smokes. Repair ships mend allies, and the home station repairs everything near it.

## Inheritance

There are four capabilities:

- Resonant Shields
- Gravity Lance
- Living Hull Weave
- Assembler Swarm

Each faction expresses them differently. For example, Resonant Shields become crystalline organs on the Bloom, unfolding lattices on the Array and rotating emitters on the Ascendancy.

How you got a capability sets its tier:

| How you got it | Tier | Strength |
|---|---|---|
| Conquest | Schematic | ×0.6 |
| Treaty | Licence | ×0.85, lost if the treaty breaks |
| Assimilation | Integrated | ×1.15 |

Ships have limited adaptation slots, filled in the Adaptation Bay at home. Captured, restored, integrated and allied vessels stay identifiable in your fleet.

The home system changes visibly with what you inherit:

- Trait arrays appear around the station.
- Captured or hybrid alien structures are rebuilt at home.
- Envoys from allied civilizations visit.

## Economy and the strategic layer

There are three resources:

- **Materials** for construction and repairs
- **Energy** for jumps and abilities
- **Knowledge** for research

On top of that sit integration capacity and, for the Bloom, reserves.

**Research** costs knowledge:

| Project | Effect |
|---|---|
| Boarding doctrine | Unlocks boarding craft |
| Integration lattice | +1 integration capacity |
| Adaptive frames | +1 adaptation slot on every ship |
| Jump support array | Cheaper jumps |
| Long-range scanners | Reveals every system's signature |
| Fire-control analysis | Stronger subsystem focus fire |

**Controlled systems** get a role from the galaxy map:

- Industry
- Research
- Trade
- Defence (repels raids)

**The galaxy acts while you're elsewhere:**

- Unresolved problems worsen over time.
- Marauders **raid** your territory and allies on a deadline. An ignored raid on territory halts its output; an ignored raid on an ally erodes trust and can end the alliance.
- After two aggressive outcomes, the remaining civilizations form a **coalition** against you.

**Map states** use icons and patterns as well as colour:

| Icon | State |
|---|---|
| ■ | Controlled |
| ⚠ | Contested |
| ⟳ | Integrating |
| ✦ | Allied |
| ◇ | Protectorate |
| ✕ | At war |
| ? | Unexplored |

**Victory** is regional dominion: control three civilizations (by conquest, assimilation or protectorate), or two plus an active relay. Being friendly isn't control. Play continues afterwards.

Losing the expedition doesn't end the campaign. You recover at home, and a lost flagship can be rebuilt.

## Presentation

- **Camera.** One live simulation spans close inspection, fleet view and system overview, with smooth zoom, tracking, orbit, tactical icons at range and instant return-to-fleet (F). The galaxy map is a separate strategic view, and whether it pauses the battle is a setting.
- **Audio.** Everything is synthesised: weapons by type, explosions, shield failures, interface cues. A generative score shifts between exploration, uncertain contact and battle, and carries a faction pulse: a heartbeat for the Bloom, synchronised ticks for the Array, an engine thrum for the Ascendancy.
- **Settings:** quality, optional retro ordered dithering, galaxy auto-pause and volume.

## Controls

| Input | Action |
|---|---|
| Left click / drag | Select / box-select (Shift adds). Double-click selects a whole class |
| Right click | Move (in formation) · attack · board a crippled ship · scan · escort a friendly ship |
| Right drag · middle drag · wheel | Orbit · pan · zoom |
| WASD / arrows · Q | Pan · rotate |
| Space · 1 / 2 / 3 | Tactical pause · time speed |
| J · K | Faction abilities |
| P · U · X | Hold position · withdraw · stop |
| Z / V | Raise / lower selected ships |
| F · T · Tab · H | Return to fleet · track · cycle camera scale · focus station |
| E · B · R · Y · C · G | Expedition · Shipyard · Adaptation Bay · Research · Dossier · Galaxy map |
| M · Esc · Ctrl+A | Mute · close / deselect · select all |
| Touch | Tap select/order · drag orbit · pinch zoom/pan · long-press radial menu |
| `` ` `` | Debug readout (fps, draw calls, triangles) |

## Code map

| File | Purpose |
|---|---|
| `js/gl.js` | WebGL2 renderer: faceted lit meshes, procedural sky, additive effects batch, optional dither |
| `js/meshgen.js` | Triangle builder and primitives; planets and asteroid fields |
| `js/designs.js` | Ships, stations, landmarks and boarding craft as animated parts; faction trait expressions |
| `js/sim.js` | Local simulation: steering, orders, AI, weapons, subsystems, boarding, auras, storms, hazards, effects |
| `js/generator.js` | Layered civilization generation, uninhabited systems, cluster lane graph |
| `js/encounter.js` | Intel, negotiation (outlooks, counteroffers), missions, integration, conquest, outcomes |
| `js/events.js` | Strategic layer: income, raids, obligations, coalitions, research, abilities, victory |
| `js/systems.js` | World builders for home, civilization and uninhabited systems; home upgrades; persistence |
| `js/audio.js` | Procedural sound effects and generative music |
| `js/save.js` | Save and load (generated content rebuilt from the seed; only mutable state stored) |
| `js/render.js`, `js/camera.js`, `js/input.js`, `js/ui.js`, `js/main.js` | Rendering overlay, camera, input, DOM UI, orchestration |

## Not yet built

- Multi-system civilizations
- Diplomacy between alien civilizations
- Controller support
- Expansion beyond the nine-system cluster
- Production of integrated alien hulls at home

Frame rate has been checked only in a headless software renderer, which says nothing about real hardware. The 60 FPS desktop target still needs profiling on real GPUs.
