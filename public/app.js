(function () {
  "use strict";

  var config = null;
  var refreshTimer = null;
  var statusByEntity = {};
  var pending = {};

  function start() {
    updateClock();
    setInterval(updateClock, 1000);
    loadConfig();
  }

  function loadConfig() {
    request("GET", "/api/config", null, function (err, data) {
      if (err) {
        showNotice("Could not load panel configuration.", "error");
        return;
      }

      config = data;
      document.title = config.title || "House Panel";
      text("panel-title", config.title || "House Panel");
      text("panel-subtitle", config.subtitle || "");
      renderPanel();
      refreshStatus();

      if (refreshTimer) {
        clearInterval(refreshTimer);
      }
      refreshTimer = setInterval(refreshStatus, Math.max(5, config.refreshSeconds || 12) * 1000);
    });
  }

  function renderPanel() {
    var roomsEl = byId("rooms");
    var scenesEl = byId("scenes");
    var roomsHtml = "";
    var scenesHtml = "";
    var rooms = config.rooms || [];
    var scenes = config.scenes || [];
    var i;
    var j;
    var room;
    var light;
    var scene;

    for (i = 0; i < rooms.length; i += 1) {
      room = rooms[i];
      roomsHtml += '<div class="room"><div class="room-inner">';
      roomsHtml += '<div class="room-title">' + escapeHtml(room.name) + "</div>";

      for (j = 0; j < (room.lights || []).length; j += 1) {
        light = room.lights[j];
        roomsHtml += '<div class="light" id="' + idFor(light.entity) + '">';
        roomsHtml += '<div class="light-main">';
        roomsHtml += '<button class="toggle" data-action="toggle" data-entity="' + escapeAttr(light.entity) + '">OFF</button>';
        roomsHtml += '<div class="light-name">' + escapeHtml(light.name) + "</div>";
        roomsHtml += '<div class="light-state">Waiting</div>';
        roomsHtml += '<div class="percent">--</div>';
        roomsHtml += "</div>";

        if (light.dimmable) {
          roomsHtml += '<div class="slider-row">';
          roomsHtml += '<input class="slider" type="range" min="0" max="100" value="50" data-action="brightness" data-entity="' + escapeAttr(light.entity) + '">';
          roomsHtml += "</div>";
        }

        roomsHtml += "</div>";
      }

      roomsHtml += "</div></div>";
    }

    for (i = 0; i < scenes.length; i += 1) {
      scene = scenes[i];
      scenesHtml += '<div class="scene">';
      scenesHtml += '<button data-action="scene" data-entity="' + escapeAttr(scene.entity) + '">' + escapeHtml(scene.name) + "</button>";
      scenesHtml += "</div>";
    }

    roomsEl.innerHTML = roomsHtml;
    scenesEl.className = "scenes scene-count-" + scenes.length;
    scenesEl.innerHTML = scenesHtml;
    roomsEl.onclick = handleClick;
    roomsEl.onchange = handleChange;
    scenesEl.onclick = handleClick;
  }

  function refreshStatus() {
    request("GET", "/api/status", null, function (err, data) {
      if (err) {
        showNotice(err.message || "Could not reach Home Assistant.", "error");
        return;
      }

      statusByEntity = data.lights || {};
      applyStatus();
      showNotice("Connected. Updated " + shortTime(new Date()) + ".", "ok");
    });
  }

  function applyStatus() {
    var entity;
    var el;
    var state;
    var slider;
    var toggle;
    var pct;

    for (entity in statusByEntity) {
      if (statusByEntity.hasOwnProperty(entity)) {
        state = statusByEntity[entity];
        el = byId(idFor(entity));

        if (!el) {
          continue;
        }

        el.className = state.on ? "light on" : "light";
        if (!state.available) {
          el.className += " disabled";
        }

        toggle = firstByClass(el, "toggle");
        if (toggle) {
          toggle.innerHTML = state.on ? "ON" : "OFF";
        }

        firstByClass(el, "light-state").innerHTML = state.available ? (state.on ? "On" : "Off") : "Unavailable";

        pct = typeof state.brightness === "number" ? state.brightness : (state.on ? 100 : 0);
        firstByClass(el, "percent").innerHTML = pct + "%";

        slider = firstByClass(el, "slider");
        if (slider && !pending[entity]) {
          slider.value = pct;
        }
      }
    }
  }

  function handleClick(event) {
    var target = event.target || event.srcElement;
    var action = target.getAttribute("data-action");
    var entity = target.getAttribute("data-entity");

    if (!action || !entity) {
      return;
    }

    if (action === "toggle") {
      setBusy(entity, true);
      request("POST", "/api/light/" + encodeURIComponent(entity) + "/toggle", {}, function (err, data) {
        setBusy(entity, false);
        afterAction(err, data);
      });
    }

    if (action === "scene") {
      request("POST", "/api/scene/" + encodeURIComponent(entity) + "/activate", {}, function (err) {
        if (err) {
          showNotice(err.message || "Scene failed.", "error");
          return;
        }
        showNotice("Scene activated.", "ok");
        setTimeout(refreshStatus, 900);
      });
    }
  }

  function handleChange(event) {
    var target = event.target || event.srcElement;
    var action = target.getAttribute("data-action");
    var entity = target.getAttribute("data-entity");
    var value;

    if (action !== "brightness" || !entity) {
      return;
    }

    value = parseInt(target.value, 10);
    setBusy(entity, true);
    request("POST", "/api/light/" + encodeURIComponent(entity) + "/brightness", {
      brightness: value
    }, function (err, data) {
      setBusy(entity, false);
      afterAction(err, data);
    });
  }

  function afterAction(err, data) {
    if (err) {
      showNotice(err.message || "Home Assistant action failed.", "error");
      refreshStatus();
      return;
    }

    if (data && data.light) {
      statusByEntity[data.light.entity] = data.light;
      applyStatus();
    }

    showNotice("Updated.", "ok");
  }

  function setBusy(entity, isBusy) {
    pending[entity] = isBusy;
    var el = byId(idFor(entity));
    if (el) {
      el.className = el.className.replace(" disabled", "") + (isBusy ? " disabled" : "");
    }
  }

  function request(method, url, body, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.setRequestHeader("Accept", "application/json");

    if (body) {
      xhr.setRequestHeader("Content-Type", "application/json");
    }

    xhr.onreadystatechange = function () {
      var data;
      if (xhr.readyState !== 4) {
        return;
      }

      data = parseJson(xhr.responseText);

      if (xhr.status < 200 || xhr.status >= 300) {
        callback({
          message: data && data.error ? data.error : "Request failed."
        });
        return;
      }

      callback(null, data);
    };

    xhr.onerror = function () {
      callback({ message: "Network error." });
    };

    xhr.send(body ? JSON.stringify(body) : null);
  }

  function updateClock() {
    var now = new Date();
    text("clock", pad(now.getHours()) + ":" + pad(now.getMinutes()));
    text("date-label", dayName(now) + " " + now.getDate() + " " + monthName(now));
  }

  function showNotice(message, state) {
    var el = byId("notice");
    el.className = "notice " + (state || "");
    el.innerHTML = escapeHtml(message);
  }

  function shortTime(date) {
    return pad(date.getHours()) + ":" + pad(date.getMinutes());
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function text(id, value) {
    var el = byId(id);
    if (el) {
      el.innerHTML = escapeHtml(value);
    }
  }

  function firstByClass(root, className) {
    var els = root.getElementsByClassName(className);
    return els.length ? els[0] : null;
  }

  function parseJson(value) {
    try {
      return value ? JSON.parse(value) : null;
    } catch (err) {
      return null;
    }
  }

  function idFor(entity) {
    return "entity-" + entity.replace(/[^a-zA-Z0-9_-]/g, "-");
  }

  function pad(value) {
    return value < 10 ? "0" + value : String(value);
  }

  function dayName(date) {
    return ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][date.getDay()];
  }

  function monthName(date) {
    return ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][date.getMonth()];
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  start();
}());
