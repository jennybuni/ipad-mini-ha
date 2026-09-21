"use strict";

var fs = require("fs");
var http = require("http");
var https = require("https");
var path = require("path");
var URL = require("url").URL;
var express = require("express");

var app = express();
var PORT = 8080;
var HA_URL = trimTrailingSlash(process.env.HOME_ASSISTANT_URL || "");
var HA_TOKEN = process.env.HOME_ASSISTANT_TOKEN || "";
var CONFIG_PATH = process.env.PANEL_CONFIG_PATH || path.join(__dirname, "config", "panel-config.json");

app.disable("x-powered-by");
app.use(express.json({ limit: "50kb" }));
app.use(express.static(path.join(__dirname, "public"), {
  etag: false,
  maxAge: "5m"
}));

var panelConfig = loadConfig();
var allowedLightEntities = mapEntities(panelConfig.rooms, "lights");
var allowedSceneEntities = mapSceneEntities(panelConfig.scenes);

app.get("/api/config", function (req, res) {
  res.json(publicConfig(panelConfig));
});

app.get("/api/health", function (req, res) {
  res.json({
    ok: true,
    homeAssistantConfigured: Boolean(HA_URL && HA_TOKEN),
    title: panelConfig.title
  });
});

app.get("/api/status", function (req, res) {
  if (!requireHomeAssistant(res)) {
    return;
  }

  haRequest("GET", "/api/states", null, function (err, data) {
    if (err) {
      sendHaError(res, err);
      return;
    }

    var byEntity = {};
    var i;
    for (i = 0; i < data.length; i += 1) {
      if (allowedLightEntities[data[i].entity_id]) {
        byEntity[data[i].entity_id] = lightState(data[i]);
      }
    }

    res.json({
      ok: true,
      lights: byEntity,
      updatedAt: new Date().toISOString()
    });
  });
});

app.post("/api/light/:entity/toggle", function (req, res) {
  var entity = decodeURIComponent(req.params.entity);
  if (!requireHomeAssistant(res) || !requireAllowedLight(res, entity)) {
    return;
  }

  haRequest("POST", "/api/services/light/toggle", { entity_id: entity }, function (err) {
    respondAfterAction(res, err, entity);
  });
});

app.post("/api/light/:entity/brightness", function (req, res) {
  var entity = decodeURIComponent(req.params.entity);
  var brightness = parseInt(req.body && req.body.brightness, 10);

  if (!requireHomeAssistant(res) || !requireAllowedLight(res, entity)) {
    return;
  }

  if (isNaN(brightness) || brightness < 0 || brightness > 100) {
    res.status(400).json({ ok: false, error: "Brightness must be a number from 0 to 100." });
    return;
  }

  if (brightness === 0) {
    haRequest("POST", "/api/services/light/turn_off", { entity_id: entity }, function (err) {
      respondAfterAction(res, err, entity);
    });
    return;
  }

  haRequest("POST", "/api/services/light/turn_on", {
    entity_id: entity,
    brightness_pct: brightness
  }, function (err) {
    respondAfterAction(res, err, entity);
  });
});

app.post("/api/scene/:entity/activate", function (req, res) {
  var entity = decodeURIComponent(req.params.entity);
  if (!requireHomeAssistant(res) || !allowedSceneEntities[entity]) {
    res.status(403).json({ ok: false, error: "Scene is not allowed by this panel." });
    return;
  }

  haRequest("POST", "/api/services/scene/turn_on", { entity_id: entity }, function (err) {
    if (err) {
      sendHaError(res, err);
      return;
    }
    res.json({ ok: true });
  });
});

app.use(function (req, res) {
  res.status(404).json({ ok: false, error: "Not found." });
});

app.listen(PORT, function () {
  console.log("iPad Mini Home Assistant panel listening on port " + PORT);
});

function loadConfig() {
  var raw;
  var config;

  raw = fs.readFileSync(CONFIG_PATH, "utf8");
  config = JSON.parse(raw);

  if (!config.rooms || !config.rooms.length) {
    throw new Error("panel-config.json must contain at least one room.");
  }

  return config;
}

function publicConfig(config) {
  return {
    title: config.title || "House Panel",
    subtitle: config.subtitle || "",
    refreshSeconds: config.refreshSeconds || 12,
    rooms: config.rooms || [],
    scenes: config.scenes || []
  };
}

function mapEntities(rooms, childKey) {
  var allowed = {};
  var i;
  var j;
  var children;

  for (i = 0; i < rooms.length; i += 1) {
    children = rooms[i][childKey] || [];
    for (j = 0; j < children.length; j += 1) {
      if (children[j].entity) {
        allowed[children[j].entity] = true;
      }
    }
  }

  return allowed;
}

function mapSceneEntities(scenes) {
  var allowed = {};
  var i;

  scenes = scenes || [];
  for (i = 0; i < scenes.length; i += 1) {
    if (scenes[i].entity) {
      allowed[scenes[i].entity] = true;
    }
  }

  return allowed;
}

function requireHomeAssistant(res) {
  if (!HA_URL || !HA_TOKEN || HA_TOKEN === "replace_me_with_a_long_lived_access_token") {
    res.status(500).json({
      ok: false,
      error: "Home Assistant URL/token are not configured. Copy .env.example to .env and edit it."
    });
    return false;
  }
  return true;
}

function requireAllowedLight(res, entity) {
  if (!allowedLightEntities[entity]) {
    res.status(403).json({ ok: false, error: "Light is not allowed by this panel." });
    return false;
  }
  return true;
}

function respondAfterAction(res, err, entity) {
  if (err) {
    sendHaError(res, err);
    return;
  }

  haRequest("GET", "/api/states/" + encodeURIComponent(entity), null, function (stateErr, state) {
    if (stateErr) {
      res.json({ ok: true });
      return;
    }

    res.json({
      ok: true,
      light: lightState(state)
    });
  });
}

function lightState(haState) {
  var attrs = haState.attributes || {};
  var brightness = attrs.brightness;
  var pct = null;

  if (typeof brightness === "number") {
    pct = Math.round((brightness / 255) * 100);
  }

  return {
    entity: haState.entity_id,
    state: haState.state,
    on: haState.state === "on",
    brightness: pct,
    friendlyName: attrs.friendly_name || haState.entity_id,
    available: haState.state !== "unavailable" && haState.state !== "unknown"
  };
}

function haRequest(method, apiPath, body, callback) {
  var target = new URL(HA_URL + apiPath);
  var payload = body ? JSON.stringify(body) : null;
  var isHttps = target.protocol === "https:";
  var client = isHttps ? https : http;
  var req;

  req = client.request({
    method: method,
    hostname: target.hostname,
    port: target.port || (isHttps ? 443 : 80),
    path: target.pathname + target.search,
    headers: {
      "Authorization": "Bearer " + HA_TOKEN,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Content-Length": payload ? Buffer.byteLength(payload) : 0
    },
    timeout: 8000
  }, function (response) {
    var chunks = "";

    response.setEncoding("utf8");
    response.on("data", function (chunk) {
      chunks += chunk;
    });
    response.on("end", function () {
      var parsed = null;

      if (chunks) {
        try {
          parsed = JSON.parse(chunks);
        } catch (parseErr) {
          callback({
            statusCode: response.statusCode,
            message: "Home Assistant returned a response this panel could not read."
          });
          return;
        }
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        callback({
          statusCode: response.statusCode,
          message: parsed && parsed.message ? parsed.message : "Home Assistant request failed."
        });
        return;
      }

      callback(null, parsed);
    });
  });

  req.on("timeout", function () {
    req.destroy(new Error("Home Assistant request timed out."));
  });

  req.on("error", function (err) {
    callback({ message: err.message || "Could not contact Home Assistant." });
  });

  if (payload) {
    req.write(payload);
  }

  req.end();
}

function sendHaError(res, err) {
  res.status(err.statusCode || 502).json({
    ok: false,
    error: err.message || "Home Assistant request failed."
  });
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}
