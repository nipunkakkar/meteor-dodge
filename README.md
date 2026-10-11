# Meteor Dodge

A lightweight space arcade game: steer your ship, dodge meteors, collect stars,
and beat your personal best. Everything runs in the browser, including the
graphics and optional sound effects.

## Play locally

Open `index.html` in a modern browser. No installation, API keys, or internet
connection is required.

Alternatively, serve this folder with Python:

```bash
python -m http.server 5059
```

Then open `http://localhost:5059`.

## Controls

- **Left / Right** or **A / D**: steer.
- **Mouse**: move across the game area to steer.
- **Touch**: drag across the game area to steer.
- **Space / P**: pause or resume; Space also starts a flight.
- **Escape**: pause.
- **Sound button**: enable or mute the optional sound effects.

You have three lives. Each star adds 25 points, and surviving earns points.
The meteor shower gets faster as you reach new sectors. Switching away from
the page pauses the flight automatically.

Your personal best is stored in this browser. If browser storage is unavailable,
the game remains playable and keeps the best score for the current session.

## Tech stack

- Semantic HTML and responsive CSS.
- Vanilla JavaScript and Canvas 2D for procedural graphics and particles.
- Web Audio for optional sound effects.
- Browser storage for personal bests.

There are no external assets, runtime dependencies, build steps, or server APIs.

## Files

- `index.html`: page, controls, and game menus.
- `styles.css`: responsive arcade interface.
- `game.js`: game loop, movement, collisions, rendering, and audio.

## Checks

If Node.js is available:

```bash
node --check game.js
```

## Hosting

This is a static site. After pushing the repository to GitHub, it can be hosted
with GitHub Pages using the root directory of the publishing branch. Any static
web server can serve the same three files.
