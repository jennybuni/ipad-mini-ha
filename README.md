# iPad Mini 1 Home Assistant Wall Panel

A Dockerized, lightweight Home Assistant light-control panel designed for an original iPad Mini running iOS 9 Safari.

The iPad loads plain HTML, CSS, and ES5-compatible JavaScript. It never receives your Home Assistant token. A small Node.js proxy keeps the token server-side and exposes only the lights and scenes listed in `config/panel-config.json`.

## What It Does

- Shows room-based light controls sized for the iPad Mini 1's 1024 x 768 display.
- Toggles configured Home Assistant light entities.
- Sets brightness for dimmable lights.
- Activates configured scenes.
- Keeps your Home Assistant URL and long-lived access token in `.env`, not in the browser.
- Uses Docker Compose for simple installation.

## Project Files

```text
ipad-mini-ha-panel/
  docker-compose.yml
  Dockerfile
  .env.example
  server.js
  package.json
  config/
    panel-config.json
  public/
    index.html
    styles.css
    app.js
```

## Setup

1. Copy the example environment file:

   ```sh
   cp .env.example .env
   ```

2. Edit `.env`:

   ```sh
   HOME_ASSISTANT_URL=http://homeassistant.local:8123
   HOME_ASSISTANT_TOKEN=your_long_lived_access_token
   PANEL_PORT=8080
   ```

3. In Home Assistant, create a long-lived access token:

   Profile -> Security -> Long-Lived Access Tokens

4. Edit `config/panel-config.json` so the light and scene entity IDs match your Home Assistant setup.

5. Start the panel:

   ```sh
   docker compose up -d --build
   ```

6. Open the panel:

   ```text
   http://YOUR_DOCKER_HOST_IP:8080
   ```

On the iPad Mini, open that address in Safari. For a wall-panel feel, use Safari's "Add to Home Screen" option, then launch it from the home screen.

## Configuration

Example light:

```json
{
  "name": "Ceiling",
  "entity": "light.living_room_ceiling",
  "dimmable": true
}
```

Example scene:

```json
{
  "name": "Night",
  "entity": "scene.night"
}
```

Only entities listed in `panel-config.json` can be controlled through the proxy.

## API Endpoints

The browser uses these local endpoints:

- `GET /api/config`
- `GET /api/status`
- `POST /api/light/:entity/toggle`
- `POST /api/light/:entity/brightness`
- `POST /api/scene/:entity/activate`

The proxy then talks to Home Assistant using:

- `GET /api/states`
- `GET /api/states/{entity_id}`
- `POST /api/services/light/toggle`
- `POST /api/services/light/turn_on`
- `POST /api/services/light/turn_off`
- `POST /api/services/scene/turn_on`

## iPad Mini 1 Notes

This project avoids modern frontend tooling because the first iPad Mini is limited to old iOS Safari. The frontend uses:

- No React, Vue, build tools, transpilers, or modules.
- `XMLHttpRequest` instead of `fetch`.
- `var` and classic functions instead of `let`, `const`, and arrow functions.
- Float-based layout with conservative CSS.

## Security Notes

- Do not expose this panel directly to the internet.
- Run it on your home network or behind your own trusted VPN.
- The Home Assistant token stays in `.env` on the Docker host.
- Keep `panel-config.json` limited to the lights and scenes the iPad should control.

## Troubleshooting

If the panel says Home Assistant is not configured, check `.env` and restart:

```sh
docker compose up -d --build
```

If controls appear but do not work:

- Confirm entity IDs in `config/panel-config.json`.
- Confirm Docker can reach `HOME_ASSISTANT_URL`.
- Try using Home Assistant's IP address instead of `homeassistant.local`.
- Check logs:

  ```sh
  docker compose logs -f
  ```

If the iPad cannot load the page:

- Make sure the iPad and Docker host are on the same network.
- Use the Docker host's LAN IP address.
- Try `http://IP_ADDRESS:8080` rather than a hostname.
