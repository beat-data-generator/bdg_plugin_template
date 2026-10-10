/// <reference path="plugin-api.d.ts" />
/**
 * Example plugin for Beat Data Generator.
 *
 * Demonstrates most of the current API surface in one file:
 *   - a typed track (custom point type with editable fields)
 *   - a resizable panel whose size/position is remembered (and a default size)
 *   - a project-bar toggle button (api.ui.registerBarButton)
 *   - a timeline overlay (api.ui.registerTimelineOverlay) that follows the
 *     playhead and reacts to scroll/zoom via the "view" event
 *   - a shortcut, an importer and an exporter
 *   - persisted preferences via api.storage (NOT localStorage)
 *   - renderer <-> main.js round-trips via api.callMain
 *
 * Full API reference: https://github.com/BUGJI/beat_data_generator/blob/main/docs/plugin-api.md
 *
 * Note: a panel already contributes ONE entry to the Plugins menu, so this
 * example does not call registerAction to toggle it — keep one menu entry.
 */
window.__bdgPluginRegister(function activate(api) {
  api.log("renderer activated (id=" + api.id + ")");

  // ---- tiny DOM helper --------------------------------------------------
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // Self-contained styles for the panel body (the host only provides base
  // font/color for plugin panels).
  var style = el("style");
  style.textContent =
    ".demo-pane{padding:10px 12px;display:flex;flex-direction:column;gap:8px}" +
    ".demo-head{font-weight:700}" +
    ".demo-row{color:var(--bdg-text-dim,#9aa);font-size:12px;line-height:1.5}" +
    ".demo-btn{background:var(--bdg-bg-sunken,#1a1d22);border:1px solid var(--bdg-border,#333);" +
    "color:var(--bdg-text,#eee);border-radius:6px;cursor:pointer;font:inherit;font-size:12px;padding:5px 8px}" +
    ".demo-btn:hover{border-color:var(--bdg-accent,#4ea1ff)}" +
    ".demo-log{font:12px/1.5 monospace;white-space:pre-wrap;max-height:110px;overflow:auto;margin:0;" +
    "background:rgb(0 0 0 / .2);border-radius:6px;padding:6px}";
  document.head.appendChild(style);

  // Plugin-lifetime subscriptions (the api also auto-unsubscribes on unload).
  var stopEvents = [];
  function disposeStopEvents() {
    for (var i = 0; i < stopEvents.length; i++) stopEvents[i]();
    stopEvents.length = 0;
  }

  // ---- typed track ------------------------------------------------------
  var flipKey = api.id + ":flip";
  var tr = api.trackTypes.register({
    id: "flip",
    trackName: { zh: "翻转轨", en: "Flip track" },
    pointName: { zh: "翻转点", en: "Flip" },
    color: "#e11d48",
    fields: [
      {
        key: "direction",
        label: { zh: "方向", en: "Direction" },
        type: "enum",
        default: "up",
        options: [
          { value: "up", label: { zh: "上", en: "Up" } },
          { value: "down", label: { zh: "下", en: "Down" } },
        ],
      },
      {
        key: "power",
        label: { zh: "力度", en: "Power" },
        type: "number",
        default: 1,
        min: 0,
        max: 10,
        step: 0.5,
      },
      {
        key: "hold",
        label: { zh: "长按", en: "Hold" },
        type: "bool",
        default: false,
      },
    ],
  });
  api.log("track type register:", tr);

  // ---- persisted preference (api.storage) -------------------------------
  // Survives restarts; never use localStorage in a plugin.
  var showOverlay = api.storage.get("showOverlay", true) === true;
  var addedCount = api.storage.get("addedCount", 0);

  // ---- timeline overlay -------------------------------------------------
  var overlayBar = null;
  function drawOverlay() {
    if (!overlayBar) return;
    overlayBar.style.display = showOverlay ? "" : "none";
    if (!showOverlay) return;
    // Follow the playhead; api.timeline maps time -> screen x.
    overlayBar.style.left =
      api.timeline.timeToScreenX(api.player.positionMs()) + "px";
  }
  stopEvents.push(api.events.on("view", drawOverlay)); // fires on scroll/zoom
  stopEvents.push(api.events.on("playhead", drawOverlay));

  api.ui.registerTimelineOverlay({
    id: "playhead-line",
    z: 5,
    mount: (host) => {
      overlayBar = el("div");
      // pointer-events:none so the timeline canvas underneath still works.
      overlayBar.style.cssText =
        "position:absolute;top:0;bottom:0;width:2px;background:#4ea1ff;pointer-events:none";
      host.appendChild(overlayBar);
      drawOverlay();
      return () => {
        overlayBar = null;
        host.textContent = "";
      };
    },
  });

  // ---- project-bar toggle ----------------------------------------------
  var barHandle = api.ui.registerBarButton({
    id: "toggle-overlay",
    title: { zh: "示例覆盖层", en: "Sample overlay" },
    icon:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round"><path d="M6 2v14a2 2 0 0 0 2 2h14"/>' +
      '<path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>',
    toggle: true,
    active: showOverlay,
    order: 100,
    run: (active) => {
      showOverlay = active;
      api.storage.set("showOverlay", active);
      drawOverlay();
    },
  });

  // ---- exporter: typed flip points to CSV ------------------------------
  function runExport() {
    var s = api.project.snapshot();
    var lines = ["beat,timeMs,direction,power,hold"];
    for (var i = 0; i < s.markers.length; i++) {
      var m = s.markers[i];
      var track = null;
      for (var j = 0; j < s.tracks.length; j++) {
        if (s.tracks[j].id === m.trackId) track = s.tracks[j];
      }
      if (!track || track.type !== flipKey || !m.attrs) continue;
      lines.push(
        m.beat +
          "," +
          m.timeMs.toFixed(3) +
          "," +
          m.attrs.direction +
          "," +
          (m.attrs.power !== undefined ? m.attrs.power : "") +
          "," +
          (m.attrs.hold ? 1 : 0),
      );
    }
    if (lines.length === 1) {
      api.log("exporter: no flip points to export");
      return;
    }
    api.system
      .saveFile({
        title: "Export flip CSV",
        defaultPath: "flip.csv",
        filters: [{ name: "CSV", extensions: ["csv"] }],
      })
      .then((res) => {
        if (res.canceled || !res.filePath) return;
        return api.system.writeText(res.filePath, lines.join("\n"));
      })
      .then((ok) => {
        api.log("exporter:", ok ? "saved" : "write failed");
      });
  }
  api.ui.registerExporter({
    label: { zh: "示例:翻转点 CSV", en: "Sample: flip points CSV" },
    run: runExport,
  });

  // ---- panel (resizable, geometry persisted by the host) ---------------
  var panel = api.ui.registerPanel({
    id: "demo",
    title: { zh: "示例面板", en: "Demo Panel" },
    defaultWidth: 360,
    defaultHeight: 320,
    minWidth: 300,
    minHeight: 240,
    mount: function mount(host) {
      host.textContent = "";
      var pane = el("div", "demo-pane");
      host.appendChild(pane);

      var head = el("div", "demo-head", api.id + " v" + api.version);
      pane.appendChild(head);

      var stats = el("div", "demo-row");
      pane.appendChild(stats);

      var stored = el("div", "demo-row");
      pane.appendChild(stored);

      var log = el("pre", "demo-log");
      pane.appendChild(log);

      function renderStats() {
        var s = api.project.snapshot();
        stats.textContent =
          "tracks=" +
          s.tracks.length +
          " markers=" +
          s.markers.length +
          " bpm=" +
          s.baseBpm.toFixed(1) +
          " t=" +
          api.player.positionMs().toFixed(0) +
          "ms";
        stored.textContent =
          "storage.addedCount = " +
          addedCount +
          "  overlay=" +
          (showOverlay ? "on" : "off");
      }
      function logText(msg) {
        log.textContent = msg + "\n" + log.textContent;
      }

      // Panel-scoped subscriptions; clear only these on unmount.
      var panelStops = [];
      panelStops.push(api.events.on("project", renderStats));
      panelStops.push(api.events.on("playhead", renderStats));

      var btnAdd = el("button", "demo-btn", "add marker @ playhead");
      btnAdd.addEventListener("click", () => {
        var s = api.project.snapshot();
        var trackId = s.tracks.length ? s.tracks[0].id : "";
        if (!trackId) return;
        var beat = api.project.beatOfTime(api.player.positionMs());
        var id = api.project.edit.addMarker({ trackId: trackId, beat: beat });
        addedCount++;
        api.storage.set("addedCount", addedCount);
        logText("added marker " + id);
        renderStats();
      });
      pane.appendChild(btnAdd);

      var btnPing = el("button", "demo-btn", "ping main.js");
      btnPing.addEventListener("click", () => {
        api
          .callMain("ping", 1, 2)
          .then((res) => {
            logText("main says: " + res);
          })
          .catch((err) => {
            logText("main error: " + err);
          });
      });
      pane.appendChild(btnPing);

      var btnExport = el("button", "demo-btn", "export markers to txt");
      btnExport.addEventListener("click", runExport);
      pane.appendChild(btnExport);

      renderStats();
      logText("panel mounted");
      return function unmount() {
        for (var i = 0; i < panelStops.length; i++) panelStops[i]();
        panelStops.length = 0;
        host.textContent = "";
      };
    },
  });

  // No registerAction: the panel above already adds one menu entry.

  api.ui.registerShortcut({
    id: "toggle-demo",
    label: { zh: "切换示例面板", en: "Toggle demo panel" },
    combo: "Alt+1",
    run: () => {
      panel.toggle();
    },
  });

  // ---- importer: CSV into a fresh typed track --------------------------
  api.ui.registerImporter({
    label: { zh: "示例:导入翻转 CSV", en: "Sample: import flip CSV" },
    run: () => {
      api.system
        .pickFile({
          title: "Open flip CSV",
          filters: [
            { name: "CSV", extensions: ["csv", "txt"] },
            { name: "All files", extensions: ["*"] },
          ],
        })
        .then((path) => {
          if (!path) return;
          return api.system.readText(path);
        })
        .then((res) => {
          if (!res || res.canceled || res.content === undefined) return;
          var rows = res.content.split(/\r?\n/);
          var trackId = null;
          api.project.edit.batch(() => {
            trackId = api.project.edit.addTypedTrack(flipKey);
            for (var i = 0; i < rows.length; i++) {
              var line = rows[i].trim();
              if (!line || line.charAt(0) === "#") continue;
              if (line.indexOf("beat") === 0) continue;
              var beat = parseFloat(line.split(",")[0]);
              if (!isFinite(beat) || beat < 0) continue;
              if (trackId) {
                api.project.edit.addMarker({ trackId: trackId, beat: beat });
              }
            }
          });
          api.log("importer: done, track =", trackId);
        });
    },
  });

  api.log("contributions registered");

  return function dispose() {
    disposeStopEvents();
    if (barHandle) barHandle.dispose();
    if (style.parentNode) style.parentNode.removeChild(style);
    api.log("renderer disposed");
  };
});
