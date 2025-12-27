// main.js - Easter Bunny Tracker (stats + bunny marker + baskets + camera lock)
const ION_TOKEN =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIwMGJiMTA4My1lMTI0LTQ4NWUtOTIxZS1iZTZlOTRiMDFiMmMiLCJpZCI6MzcyMTA3LCJpYXQiOjE3NjY0NzkyODZ9.YQRxc-UcuvH4LttWYeNJhVdu_85WlysS3s_4bGIq95w";

const BASKET_START_DR = 77;

// Minimum zoom distance when UNLOCKED (meters)
const MIN_ZOOM_DISTANCE_M = 120_000;

// Camera distance when LOCKED (meters)
const LOCKED_CAMERA_HEIGHT_M = 3350_000;

const STARTUP_GRACE_SEC = 20;

async function createAerialWithLabelsImagery() {
    if (typeof Cesium.createWorldImageryAsync === "function") {
        return await Cesium.createWorldImageryAsync({
            style: Cesium.IonWorldImageryStyle.AERIAL_WITH_LABELS
        });
    }
    if (typeof Cesium.createWorldImagery === "function") {
        return Cesium.createWorldImagery({
            style: Cesium.IonWorldImageryStyle.AERIAL_WITH_LABELS
        });
    }
    throw new Error("createWorldImagery helper not found on this Cesium build.");
}

async function createTerrainMaybe() {
    try {
        if (typeof Cesium.createWorldTerrainAsync === "function") return await Cesium.createWorldTerrainAsync();
        if (typeof Cesium.createWorldTerrain === "function") return Cesium.createWorldTerrain();
    } catch (e) {
        console.warn("Terrain failed; continuing without terrain:", e);
    }
    return undefined;
}

function $(id) {
    return document.getElementById(id);
}

const fmtInt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
function formatInt(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return "—";
    return fmtInt.format(n);
}

function formatDurationWords(totalSeconds) {
    if (!Number.isFinite(totalSeconds)) return "—";

    let s = Math.max(0, Math.ceil(totalSeconds));

    if (s === 0) return "0 seconds";
    if (s < 2) return "1 second";

    const hours = Math.floor(s / 3600);
    s %= 3600;
    const minutes = Math.floor(s / 60);
    const seconds = s % 60;

    const parts = [];
    if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
    if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds} ${seconds === 1 ? "second" : "seconds"}`);

    return parts.join(", ");
}

function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

async function fetchViewerLocationFromIpInfo() {
    try {
        const res = await fetch("https://ipinfo.io/json?token=e79f246961b6e1", {
            cache: "no-store"
        });
        if (!res.ok) throw new Error(`ipinfo.io failed (${res.status})`);

        const data = await res.json();
        if (!data.loc || typeof data.loc !== "string") {
            throw new Error("ipinfo.io response missing 'loc'");
        }

        const [latStr, lonStr] = data.loc.split(",");
        const lat = parseFloat(latStr);
        const lon = parseFloat(lonStr);

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            throw new Error("ipinfo.io returned non-numeric coordinates");
        }

        return { lat, lon };
    } catch (e) {
        console.warn("Failed to get viewer location from ipinfo.io:", e);
        return null;
    }
}

function findClosestStopByLocation(stops, lat, lon) {
    let best = null;
    let bestDistKm = Infinity;

    for (const s of stops) {
        if (!Number.isFinite(s.Latitude) || !Number.isFinite(s.Longitude)) continue;
        const d = haversineKm(lat, lon, s.Latitude, s.Longitude);
        if (d < bestDistKm) {
            bestDistKm = d;
            best = s;
        }
    }

    return best;
}

async function fetchViewerLocationFromIpInfo() {
    try {
        const res = await fetch("https://ipinfo.io/json?token=e79f246961b6e1", {
            cache: "no-store"
        });
        if (!res.ok) throw new Error(`ipinfo.io failed (${res.status})`);

        const data = await res.json();
        if (!data.loc || typeof data.loc !== "string") {
            throw new Error("ipinfo.io response missing 'loc'");
        }

        const [latStr, lonStr] = data.loc.split(",");
        const lat = parseFloat(latStr);
        const lon = parseFloat(lonStr);

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            throw new Error("ipinfo.io returned non-numeric coordinates");
        }

        return { lat, lon };
    } catch (e) {
        console.warn("Failed to get viewer location from ipinfo.io:", e);
        return null;
    }
}

function findClosestStopByLocation(stops, lat, lon) {
    let best = null;
    let bestDistKm = Infinity;

    for (const s of stops) {
        if (!Number.isFinite(s.Latitude) || !Number.isFinite(s.Longitude)) continue;
        const d = haversineKm(lat, lon, s.Latitude, s.Longitude);
        if (d < bestDistKm) {
            bestDistKm = d;
            best = s;
        }
    }

    return best;
}

// For the "Easter Bunny will arrive at your location in ___" text
function formatViewerEtaText(deltaSeconds) {
    if (!Number.isFinite(deltaSeconds)) return "Unknown";

    // Negative or already very close: treat as "anytime"
    if (deltaSeconds <= 0 || deltaSeconds < 30 * 60) {
        return "anytime";
    }

    const hours = deltaSeconds / 3600;

    // Round to nearest half-hour
    const halfHours = Math.round(hours * 2);
    const roundedHours = halfHours / 2;

    const whole = Math.floor(roundedHours);
    const frac = roundedHours - whole;

    const isHalf = Math.abs(frac - 0.5) < 1e-6;

    if (!isHalf) {
        const n = roundedHours.toFixed(0);
        return `${n} ${n === "1" ? "hour" : "hours"}`;
    }

    if (whole === 0) {
        return "½ hour";
    }

    return `${whole}½ hours`;
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function wrapDeltaLon(deg) {
    // normalize to [-180, 180)
    return ((deg + 540) % 360) - 180;
}

function normalizeLon(lon) {
    // normalize to [-180, 180)
    return ((lon + 540) % 360) - 180;
}

function interpolateLatLon(a, b, t) {
    const dLon = wrapDeltaLon(b.Longitude - a.Longitude);
    const lon = normalizeLon(a.Longitude + dLon * t);

    return {
        lat: lerp(a.Latitude, b.Latitude, t),
        lon
    };
}

function cityLabel(stop) {
    const city = stop.City || "Unknown";
    const region = stop.Region ? `, ${stop.Region}` : "";
    return `${city}${region}`;
}

function toNum(x) {
    const n = Number(x);
    return Number.isFinite(n) ? n : x;
}

async function loadRoute() {
    const res = await fetch("./route.json", { cache: "no-store" }); // CHANGE THIS LATER
    if (!res.ok) throw new Error(`Failed to load route.json (${res.status})`);
    const data = await res.json();

    let stops = Array.isArray(data) ? data : data.route || data.stops || [];
    if (!Array.isArray(stops)) throw new Error("route.json format not recognized.");

    stops = stops.map((s) => ({
        ...s,
        DR: toNum(s.DR),
        Latitude: Number(s.Latitude),
        Longitude: Number(s.Longitude),
        EggsDelivered: toNum(s["Eggs Delivered"]),
        CarrotsEaten: toNum(s["Carrots eaten"]),
        UnixArrivalArrival: Number(s["Unix Arrival Arrival"]),
        UnixArrival: Number(s["Unix Arrival"]),
        UnixArrivalDeparture: Number(s["Unix Arrival Departure"]),
        WikipediaUrl: typeof s["Wikipedia attr"] === "string" ? s["Wikipedia attr"] : null
    }));

    stops.sort((a, b) => a.UnixArrivalArrival - b.UnixArrivalArrival);
    return stops;
}

const MUSIC_VOLUME = 0.1;

(async function init() {
    try {
        if (typeof Cesium === "undefined") {
            console.error("Cesium is undefined.");
            return;
        }

        const PRE_JOURNEY_START_UTC_MS = Date.UTC(2026, 3, 5, 6, 0, 0);
        if (Date.now() < PRE_JOURNEY_START_UTC_MS) {
            window.location.replace("index.html");
            return;
        }

        Cesium.Ion.defaultAccessToken = ION_TOKEN;

        const imageryProvider = await createAerialWithLabelsImagery();
        const terrainProvider = await createTerrainMaybe();

        const viewer = new Cesium.Viewer("cesiumContainer", {
            imageryProvider,
            terrainProvider,
            baseLayerPicker: false,
            timeline: false,
            animation: false,
            geocoder: false,
            homeButton: false,
            sceneModePicker: false,
            navigationHelpButton: false
        });

        viewer.scene.globe.depthTestAgainstTerrain = true;

        // Force base layer
        try {
            const layers = viewer.scene.imageryLayers;
            while (layers.length > 0) layers.remove(layers.get(0));
            layers.addImageryProvider(imageryProvider);
        } catch { }

        // Minimum zoom when unlocked
        viewer.scene.screenSpaceCameraController.minimumZoomDistance = MIN_ZOOM_DISTANCE_M;

        // Load route
        $("statStatus").textContent = "Loading route…";
        const stops = await loadRoute();

        // Final DR (journey end)
        const FINAL_DR = 1048;
        const finalStop =
            stops.find(s => Number(s.DR) === FINAL_DR) ||
            stops[stops.length - 1];
        const FINAL_ARRIVAL = Number(finalStop.UnixArrivalArrival);

        // Rows for Status and Arriving in
        const statStatusRow = (() => {
            const v = $("statStatus");
            const row = v ? v.closest(".hud-row") : null;
            return row || null;
        })();

        const statEtaRow = (() => {
            const v = $("statEta");
            const row = v ? v.closest(".hud-row") : null;
            return row || null;
        })();

        // Viewer-location based ETA state
        let viewerLocation = null;
        let viewerClosestStop = null;
        let viewerEtaError = false;

        // Show initial "Loading..." if element exists
        const statDurationEl = $("statDuration");
        if (statDurationEl) {
            statDurationEl.textContent = "Loading...";
        }

        // Kick off IP-based location lookup (non-blocking)
        fetchViewerLocationFromIpInfo().then((loc) => {
            if (!loc) {
                viewerEtaError = true;
                if (statDurationEl) statDurationEl.textContent = "Unknown";
                return;
            }

            viewerLocation = loc;
            viewerClosestStop = findClosestStopByLocation(stops, loc.lat, loc.lon);
        }).catch((err) => {
            console.warn("Viewer location lookup failed:", err);
            viewerEtaError = true;
            if (statDurationEl) statDurationEl.textContent = "Unknown";
        });

        // Find when DR 77 begins:
        // Prefer exact DR 77; fallback to first DR >= 77 if exact doesn't exist
        const dr77Stop =
            stops.find(s => Number(s.DR) === BASKET_START_DR) ||
            stops.find(s => Number(s.DR) >= BASKET_START_DR);

        const DR77_ARRIVAL = dr77Stop ? Number(dr77Stop.UnixArrivalArrival) : null;

        // Grab the label span that sits next to #statEta (the first span in that hud-row)
        const statEtaLabelEl = (() => {
            const v = document.getElementById("statEta");
            const row = v ? v.closest(".hud-row") : null;
            return row ? row.querySelector("span:first-child") : null;
        })();

        function setEtaLabel(isBefore77) {
            if (!statEtaLabelEl) return;
            statEtaLabelEl.textContent = isBefore77 ? "Countdown to takeoff:" : "Arriving in:";
        }

        // Bunny (dead-center when locked)
        const bunnyEntity = viewer.entities.add({
            name: "Easter Bunny",
            position: Cesium.Cartesian3.fromDegrees(stops[0].Longitude, stops[0].Latitude, 0),
            billboard: {
                image: "Bunny.png",
                width: 37,
                height: 37,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            }
        });

        function followBunnyIfLocked() {
            if (!isLocked) return;

            const jd = Cesium.JulianDate.now();
            const p = bunnyEntity.position.getValue ? bunnyEntity.position.getValue(jd) : bunnyEntity.position;
            if (!p) return;

            const carto = Cesium.Cartographic.fromCartesian(p);
            const lon = Cesium.Math.toDegrees(carto.longitude);
            const lat = Cesium.Math.toDegrees(carto.latitude);

            viewer.camera.setView({
                destination: Cesium.Cartesian3.fromDegrees(lon, lat, LOCKED_CAMERA_HEIGHT_M),
                orientation: {
                    heading: 0,
                    pitch: -Cesium.Math.PI_OVER_TWO,
                    roll: 0
                }
            });
        }

        // ✅ Delivery egg pop FX (shows only while delivering)
        let isDelivering = false;

        const eggPopEntity = viewer.entities.add({
            show: false,
            position: new Cesium.CallbackProperty(() => {
                // Keep it attached to bunny position
                const jd = Cesium.JulianDate.now();
                const p = bunnyEntity.position.getValue
                    ? bunnyEntity.position.getValue(jd)
                    : bunnyEntity.position;
                return p || Cesium.Cartesian3.fromDegrees(stops[0].Longitude, stops[0].Latitude, 0);
            }, false),
            billboard: {
                image: "Egg.png", // make sure Egg.png exists
                width: 22,
                height: 26,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,

                // Fade + rise loop every 1s
                color: new Cesium.CallbackProperty(() => {
                    if (!isDelivering) return new Cesium.Color(1, 1, 1, 0);

                    const phase = (performance.now() / 1000) % 1; // 0..1 each second
                    const fadeIn = 0.15;
                    const fadeOut = 0.20;

                    let a = 1;
                    if (phase < fadeIn) a = phase / fadeIn;
                    else if (phase > 1 - fadeOut) a = (1 - phase) / fadeOut;

                    return new Cesium.Color(1, 1, 1, Math.max(0, Math.min(1, a)));
                }, false),

                pixelOffset: new Cesium.CallbackProperty(() => {
                    if (!isDelivering) return new Cesium.Cartesian2(0, 0);

                    const phase = (performance.now() / 1000) % 1; // 0..1
                    const risePx = phase * 28;      // how high it floats
                    const baseAboveBunny = -44;     // start above bunny head (negative = up)
                    return new Cesium.Cartesian2(0, baseAboveBunny - risePx);
                }, false)
            }
        });

        // Baskets
        const basketEntities = new Map();
        function addBasketForStop(stop) {
            const dr = Number(stop.DR);
            if (Number.isFinite(dr) && dr < BASKET_START_DR) return;

            const key = stop.DR ?? `${stop.UnixArrival}`;
            if (basketEntities.has(key)) return;

            const cityName = cityLabel(stop);

            // Default: just show the city name
            let descHtml = cityName;

            // If we have a Wikipedia URL, make the city name a clickable link
            if (stop.WikipediaUrl) {
                const safeUrl = stop.WikipediaUrl;
                descHtml =
                    `More info: <a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${cityName}</a>`;
            }

            const ent = viewer.entities.add({
                // Title in the info box
                name: cityName,

                // Body content in the info box (clickable city text)
                description: descHtml,

                position: Cesium.Cartesian3.fromDegrees(stop.Longitude, stop.Latitude, 0),
                billboard: {
                    image: "Basket.png",
                    width: 24,
                    height: 24,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                }
            });

            basketEntities.set(key, ent);
        }

        function cityOnly(stop) {
            return (stop && stop.City) ? stop.City : "Unknown";
        }

        function updateHUD({
            status,
            lastText,
            etaSeconds,
            etaText,                 // optional override
            stopRemainingSeconds,
            speedKmh,
            speedMph,
            eggs,
            carrots
        }) {
            $("statStatus").textContent = status ?? "—";
            $("statLast").textContent = lastText ?? "—";

            $("statEta").textContent = (typeof etaText === "string")
                ? etaText
                : formatDurationWords(etaSeconds);

            $("statStopRemaining").textContent = formatDurationWords(stopRemainingSeconds);

            if (Number.isFinite(speedKmh) && Number.isFinite(speedMph)) {
                const kmRounded = Math.round(speedKmh);
                const mphRounded = Math.round(speedMph);

                const kmStr = Math.abs(kmRounded) >= 1000
                    ? formatInt(kmRounded)          // e.g. 1,234 km/h
                    : kmRounded.toString();         // e.g. 987 km/h

                const mphStr = Math.abs(mphRounded) >= 1000
                    ? formatInt(mphRounded)
                    : mphRounded.toString();

                $("statSpeed").textContent = `${kmStr} km/h • ${mphStr} mph`;
            } else {
                $("statSpeed").textContent = "—";
            }

            $("statEggs").textContent = formatInt(eggs);
            $("statCarrots").textContent = formatInt(carrots);
        }

        function findSegment(now) {
            const first = stops[0];
            const last = stops[stops.length - 1];

            // Grace: if we are only a little late, still treat as being at the first stop
            if (now >= first.UnixArrivalArrival && now < first.UnixArrivalDeparture + STARTUP_GRACE_SEC) {
                return { mode: "stop", i: 0 };
            }

            if (now < first.UnixArrivalArrival) return { mode: "pre" };
            // NOTE: we NO LONGER return "done" here; we keep treating it as travel/stop
            // if (now >= last.UnixArrivalDeparture) return { mode: "done" };

            for (let i = 0; i < stops.length; i++) {
                const s = stops[i];
                if (now >= s.UnixArrivalArrival && now < s.UnixArrivalDeparture) return { mode: "stop", i };
                if (now < s.UnixArrivalArrival) return { mode: "travel", from: i - 1, to: i };
            }
            // After the loop, we're past the last departure: treat as "travel" between last two,
            // clamped to t=1, which effectively parks him at the final city.
            return { mode: "travel", from: stops.length - 2, to: stops.length - 1 };
        }

        function clamp01(x) {
            return Math.max(0, Math.min(1, x));
        }

        // Camera lock state
        let isLocked = false;

        function setLocked(nextLocked) {
            isLocked = !!nextLocked;

            const btn = $("lockBtn");
            if (btn) {
                btn.setAttribute("aria-pressed", String(isLocked));
                btn.textContent = isLocked ? "🔓 Unlock Camera" : "🔒 Lock to Bunny";
                btn.title = isLocked ? "Unlock camera" : "Lock camera to Bunny";
            }

            const ssc = viewer.scene.screenSpaceCameraController;

            if (isLocked) {
                viewer.trackedEntity = bunnyEntity;

                ssc.enableRotate = false;
                ssc.enableTranslate = false;
                ssc.enableZoom = false;
                ssc.enableTilt = false;
                ssc.enableLook = false;
                ssc.enableInputs = false;

                const range = LOCKED_CAMERA_HEIGHT_M;
                viewer.zoomTo(
                    bunnyEntity,
                    new Cesium.HeadingPitchRange(
                        0,
                        -Cesium.Math.PI_OVER_TWO,
                        range
                    )
                );
            } else {
                viewer.trackedEntity = undefined;

                ssc.enableRotate = true;
                ssc.enableTranslate = true;
                ssc.enableZoom = true;
                ssc.enableTilt = true;
                ssc.enableLook = true;
                ssc.enableInputs = true;

                ssc.minimumZoomDistance = MIN_ZOOM_DISTANCE_M;
            }
        }

        // -------------------------
        // HELP modal UI
        // -------------------------
        const helpBtn = $("helpBtn");
        const helpOverlay = $("helpOverlay");
        const helpCloseBtn = $("helpCloseBtn");

        function openHelp() {
            if (!helpOverlay) return;
            helpOverlay.classList.add("is-open");
            helpOverlay.setAttribute("aria-hidden", "false");

            const activeTab = helpOverlay.querySelector(".help-tab.is-active");
            if (activeTab) activeTab.focus();
        }

        function closeHelp() {
            if (!helpOverlay) return;
            helpOverlay.classList.remove("is-open");
            helpOverlay.setAttribute("aria-hidden", "true");
            if (helpBtn) helpBtn.focus();
        }

        function setHelpTab(tabKey) {
            if (!helpOverlay) return;

            const tabs = helpOverlay.querySelectorAll(".help-tab");
            const panes = helpOverlay.querySelectorAll(".help-pane");

            tabs.forEach((t) => t.classList.toggle("is-active", t.dataset.tab === tabKey));
            panes.forEach((p) => p.classList.toggle("is-active", p.dataset.pane === tabKey));
        }

        if (helpBtn) helpBtn.addEventListener("click", openHelp);
        if (helpCloseBtn) helpCloseBtn.addEventListener("click", closeHelp);

        const helpTabs = helpOverlay ? helpOverlay.querySelector(".help-tabs") : null;
        if (helpTabs) {
            helpTabs.addEventListener("click", (e) => {
                const btn = e.target.closest(".help-tab");
                if (!btn) return;
                e.preventDefault();
                setHelpTab(btn.dataset.tab);
            });
        }

        window.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            if (!helpOverlay) return;
            if (!helpOverlay.classList.contains("is-open")) return;
            closeHelp();
        });

        // -------------------------
        // Background music (music.mp3)
        // -------------------------
        let musicEnabled = true;
        let bgAudio = null;
        let musicResumePending = false;

        function initBgMusic() {
            if (bgAudio) return;

            bgAudio = new Audio("music.mp3");
            // We'll handle the looping manually so we can insert a 1s delay
            bgAudio.loop = false;
            bgAudio.volume = MUSIC_VOLUME; // assuming you added this constant

            bgAudio.addEventListener("ended", () => {
                if (!musicEnabled) return;
                setTimeout(() => {
                    if (!musicEnabled || !bgAudio) return;
                    try {
                        bgAudio.currentTime = 0;
                        const p = bgAudio.play();
                        if (p && typeof p.then === "function") {
                            p.then(() => {
                                musicResumePending = false;
                            }).catch(() => {
                                // If this fails, keep pending true
                                musicResumePending = true;
                            });
                        }
                    } catch (e) {
                        console.warn("Background music replay failed:", e);
                        musicResumePending = true;
                    }
                }, 1000); // 1 second delay between loops
            });

            // Try to autoplay; if blocked, mark as pending
            try {
                const p = bgAudio.play();
                if (p && typeof p.then === "function") {
                    p.then(() => {
                        musicResumePending = false;
                    }).catch((err) => {
                        console.warn("Autoplay for background music was blocked by the browser:", err);
                        musicResumePending = true;
                    });
                }
            } catch (e) {
                console.warn("Background music initial play failed:", e);
                musicResumePending = true;
            }
        }

        function setMusicEnabled(next) {
            musicEnabled = !!next;

            const btn = $("musicToggleBtn");
            if (btn) {
                btn.setAttribute("aria-pressed", String(musicEnabled));
                btn.textContent = musicEnabled ? "Music: On" : "Music: Off";
            }

            if (!bgAudio) {
                if (musicEnabled) {
                    initBgMusic();
                }
                return;
            }

            if (musicEnabled) {
                try {
                    const p = bgAudio.play();
                    if (p && typeof p.then === "function") {
                        p.then(() => {
                            musicResumePending = false;
                        }).catch(() => {
                            musicResumePending = true;
                        });
                    }
                } catch (e) {
                    console.warn("Background music play failed:", e);
                    musicResumePending = true;
                }
            } else {
                bgAudio.pause();
                musicResumePending = false;
            }
        }

        // Button hookup
        const lockBtn = $("lockBtn");
        if (lockBtn) {
            lockBtn.addEventListener("click", () => setLocked(!isLocked));
        }

        function handleUserInteractionForMusic() {
            if (!musicEnabled || !bgAudio || !musicResumePending) return;

            // We now have a user gesture, so try to start the music
            musicResumePending = false;
            try {
                const p = bgAudio.play();
                if (p && typeof p.then === "function") {
                    p.catch(() => {
                        // If it somehow still fails, don't loop on it
                    });
                }
            } catch (e) {
                console.warn("Background music resume on interaction failed:", e);
            }
        }

        // Any of these count as "user interaction" for autoplay rules
        ["pointerdown", "click", "keydown", "touchstart"].forEach((ev) => {
            window.addEventListener(ev, handleUserInteractionForMusic, { passive: true });
        });

        // Settings: music toggle button
        const musicToggleBtn = $("musicToggleBtn");
        if (musicToggleBtn) {
            musicToggleBtn.addEventListener("click", () => {
                setMusicEnabled(!musicEnabled);
                if (musicEnabled && !bgAudio) {
                    initBgMusic();
                }
            });
        }

        // Start with music ON by default
        setMusicEnabled(true);
        initBgMusic();

        // Prevent any camera pitch/tilt changes while locked
        let suppressCameraClamp = false;

        viewer.camera.changed.addEventListener(() => {
            if (!isLocked) return;
            if (suppressCameraClamp) return;

            suppressCameraClamp = true;
            try {
                const range = LOCKED_CAMERA_HEIGHT_M;
                viewer.zoomTo(
                    bunnyEntity,
                    new Cesium.HeadingPitchRange(
                        0,
                        -Cesium.Math.PI_OVER_TWO,
                        range
                    )
                );
            } finally {
                setTimeout(() => { suppressCameraClamp = false; }, 0);
            }
        });

        // Start LOCKED by default
        setLocked(true);

        // Before DR 77 = hide regions in "Next" and force "Last" to N/A
        function isBeforeDR77ForSegment(seg, stops) {
            if (seg.mode === "pre") return true;

            if (seg.mode === "travel") {
                const to = stops[seg.to];
                const dr = Number(to?.DR);
                return Number.isFinite(dr) && dr < BASKET_START_DR;
            }

            if (seg.mode === "stop") {
                const s = stops[seg.i];
                const dr = Number(s?.DR);
                return Number.isFinite(dr) && dr < BASKET_START_DR;
            }

            return false;
        }

        // ETA override:
        // Before DR77 happens, statEta counts down to DR77.
        // After DR77, statEta counts down to "next" like normal.
        function etaForHUD(now, normalEtaSeconds) {
            if (Number.isFinite(DR77_ARRIVAL) && now < DR77_ARRIVAL) {
                return DR77_ARRIVAL - now;
            }
            return normalEtaSeconds;
        }

        function updateViewerLocationEta(now) {
            const el = $("statDuration");
            if (!el) return;

            // If we failed earlier
            if (viewerEtaError) {
                if (!el.textContent || el.textContent === "Loading...") {
                    el.textContent = "Unknown";
                }
                return;
            }

            // Still resolving IP / closest stop
            if (!viewerClosestStop) {
                // Don't spam; leave as "Loading..." until it's ready
                return;
            }

            const arrival = Number(viewerClosestStop.UnixArrivalArrival);
            if (!Number.isFinite(arrival)) {
                el.textContent = "Unknown";
                return;
            }

            const deltaSeconds = arrival - now;
            const text = formatViewerEtaText(deltaSeconds);

            // IMPORTANT:
            // The HTML has:
            //   "Easter Bunny will arrive at your location in" <span id="statDuration">...</span>
            // So we only set the trailing part, e.g. "1 hour", "2½ hours", or "anytime".
            el.textContent = text;
        }

        function tick() {
            const now = Date.now() / 1000; // keep fractional seconds

            // ✅ Always add baskets for completed stops, even after DR 1048
            for (const s of stops) {
                if (now >= s.UnixArrivalDeparture) addBasketForStop(s);
                else break;
            }

            // 🏁 After DR 1048 has arrived: hide Status + Arriving, freeze eggs/carrots
            const journeyComplete =
                Number.isFinite(FINAL_ARRIVAL) && now >= FINAL_ARRIVAL;

            if (journeyComplete) {
                // Park bunny at the final stop
                bunnyEntity.position = Cesium.Cartesian3.fromDegrees(
                    finalStop.Longitude,
                    finalStop.Latitude,
                    0
                );

                // No more delivering FX
                isDelivering = false;
                eggPopEntity.show = false;

                // Hide Status and Arriving in rows
                if (statStatusRow) statStatusRow.style.display = "none";
                if (statEtaRow) statEtaRow.style.display = "none";

                // Freeze eggs/carrots at final values
                updateHUD({
                    status: "",                        // row is hidden anyway
                    lastText: cityLabel(finalStop),    // "Last stop" = final city
                    etaSeconds: NaN,
                    etaText: "",                       // row hidden
                    stopRemainingSeconds: NaN,
                    speedKmh: NaN,
                    speedMph: NaN,
                    eggs: finalStop.EggsDelivered,
                    carrots: finalStop.CarrotsEaten
                });

                followBunnyIfLocked();

                // While unlocked, re-assert minimum zoom (safe guard)
                if (!isLocked) {
                    viewer.scene.screenSpaceCameraController.minimumZoomDistance = MIN_ZOOM_DISTANCE_M;
                }

                updateViewerLocationEta(now);
                return;
            }

            // 🔽 Normal behavior before final arrival

            const seg = findSegment(now);

            isDelivering = (seg.mode === "stop");
            eggPopEntity.show = isDelivering;

            const beforeDR77 = Number.isFinite(DR77_ARRIVAL) && now < DR77_ARRIVAL;
            setEtaLabel(beforeDR77);

            const before77 = isBeforeDR77ForSegment(seg, stops);

            if (seg.mode === "pre") {
                const first = stops[0];
                bunnyEntity.position = Cesium.Cartesian3.fromDegrees(first.Longitude, first.Latitude, 0);

                updateHUD({
                    status: "Preparing for takeoff…",
                    lastText: "N/A",
                    nextText: before77 ? cityOnly(first) : cityLabel(first),
                    etaSeconds: etaForHUD(now, first.UnixArrivalArrival - now),
                    stopRemainingSeconds: NaN,
                    speedKmh: NaN,
                    speedMph: NaN,
                    eggs: 0,
                    carrots: 0
                });

                followBunnyIfLocked();
                return;
            }

            // NOTE: no more seg.mode === "done" block

            if (seg.mode === "stop") {
                const s = stops[seg.i];
                const next = stops[Math.min(seg.i + 1, stops.length - 1)];
                bunnyEntity.position = Cesium.Cartesian3.fromDegrees(s.Longitude, s.Latitude, 0);

                const stopRemaining = s.UnixArrivalDeparture - now;

                let speedKmh = NaN;
                let speedMph = NaN;
                if (seg.i > 0) {
                    const prev = stops[seg.i - 1];
                    const distKm = haversineKm(prev.Latitude, prev.Longitude, s.Latitude, s.Longitude);
                    const travelSec = Math.max(1, s.UnixArrivalArrival - prev.UnixArrivalDeparture);
                    speedKmh = (distKm / travelSec) * 3600;
                    speedMph = speedKmh * 0.621371;
                }

                updateHUD({
                    status: `Delivering in ${s.City}`,
                    lastText: before77 ? "N/A" : (seg.i > 0 ? cityLabel(stops[seg.i - 1]) : "—"),
                    nextText: next ? (before77 ? cityOnly(next) : cityLabel(next)) : "—",
                    etaText: `Currently delivering eggs in ${s.City}`,
                    etaSeconds: NaN,
                    stopRemainingSeconds: stopRemaining,
                    speedKmh,
                    speedMph,
                    eggs: s.EggsDelivered,
                    carrots: s.CarrotsEaten
                });

                followBunnyIfLocked();
                return;
            }

            if (seg.mode === "travel") {
                const from = stops[seg.from];
                const to = stops[seg.to];
                if (!from || !to) return;

                const departT = from.UnixArrivalDeparture;
                const arriveT = to.UnixArrivalArrival;
                const denom = Math.max(1, arriveT - departT);
                const t = clamp01((now - departT) / denom);

                const pos = interpolateLatLon(from, to, t);
                bunnyEntity.position = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, 0);

                const distKm = haversineKm(from.Latitude, from.Longitude, to.Latitude, to.Longitude);
                const speedKmh = (distKm / denom) * 3600;
                const speedMph = speedKmh * 0.621371;

                const eggs = lerp(Number(from.EggsDelivered) || 0, Number(to.EggsDelivered) || 0, t);
                const carrots = lerp(Number(from.CarrotsEaten) || 0, Number(to.CarrotsEaten) || 0, t);

                updateHUD({
                    status: `Heading to: ${to.City}, ${to.Region}`,
                    lastText: before77 ? "N/A" : cityLabel(from),
                    nextText: before77 ? cityOnly(to) : cityLabel(to),
                    etaSeconds: etaForHUD(now, arriveT - now),
                    stopRemainingSeconds: NaN,
                    speedKmh,
                    speedMph,
                    eggs,
                    carrots
                });

                followBunnyIfLocked();
            }

            // While unlocked, re-assert minimum zoom (safe guard)
            if (!isLocked) {
                viewer.scene.screenSpaceCameraController.minimumZoomDistance = MIN_ZOOM_DISTANCE_M;
            }

            updateViewerLocationEta(now);
        }

        tick();
        setInterval(tick, 250);

        viewer.scene.requestRenderMode = false;
        console.log(`Loaded route with ${stops.length} stops.`);
    } catch (e) {
        console.error("Tracker init failed:", e);
        const el = document.getElementById("statStatus");
        if (el) el.textContent = "Error (see console)";
    }
})();
