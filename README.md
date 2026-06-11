# FORKNIFE

The legally distinct battle royale. A Fortnite knock-off that runs in your browser —
no dependencies, no build step, all procedural canvas art.

## Play

Open `index.html` in any browser (or `open ~/forknife/index.html`).

You + 15 bots. Ride the battle bus, drop, loot, build, outlast the storm.
Last one standing gets the **#1 VICTORY ROYALE**.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move (steer while gliding) |
| Mouse | Aim / fire (hold for auto weapons) |
| SPACE | Drop from the battle bus |
| 1–5 / wheel | Hotbar (slot 1 = pickaxe) |
| Q | Toggle build mode — click to place walls (10 mats) |
| E | Open chest / pick up / swap |
| R | Reload · G drop item · M mute |

## The Fortnite essentials

- **Battle bus** drop with steerable glide
- **Storm** — 6 shrinking phases with scaling damage, minimap rings
- **Loot rarity** — Common → Legendary (gray/green/blue/purple/gold), damage multipliers
- Pistol / SMG / Pump Shotgun / AR / Bolt Sniper + pickaxe
- **Harvest mats** from trees & rocks, **build walls** (150 HP, destructible)
- Bandages, medkits, minis (cap 50) and big shields
- Golden **chests** and two **supply llamas** per match
- 15 bots with names like `TTV_SweatLord` and `DefaultDanny` — they loot, hunt,
  burst-fire, panic-heal, dodge the storm, and hide worse than you do
- Kill feed, damage numbers, bush stealth, victory/placement screens

## Code layout (game.js)

Single file, sectioned: utils → data tables → audio (WebAudio synth) → input →
world gen → items/loot → combat → building → LOS/collision → bullets → storm →
bus/drop → bot AI → human update → game loop → rendering → HUD → screens.

`window.G()` exposes live game state for testing. Headless balance tests were run
with Playwright (match length ~2.5–4 min, lobby decays 16→~8 in the first minute).
