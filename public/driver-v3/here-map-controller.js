/* Coach Safe Driver V3 — Clean HERE Controller v2
   Full replacement. No dependency on previous patched controller state.
*/
export class HereMapController {
  constructor(containerId) {
    this.containerId = containerId;

    this.platform = null;
    this.layers = null;
    this.map = null;
    this.behavior = null;
    this.ui = null;

    this.dayLayer = null;
    this.nightLayer = null;
    this.nightMode = false;

    this.routeGroup = null;
    this.routeLine = null;
    this.startMarker = null;
    this.endMarker = null;
    this.vehicleMarker = null;
    this.alternativePreview = null;
    this.alternativePreviewTimer = null;

    this.routePoints = [];
    this.routeBounds = null;

    this.liveMode = false;
    this.viewMode = 'overview';
    this.lastHeading = 0;
    this.lastPosition = null;

    this.resizeHandler = null;
    this.orientationHandler = null;
  }

  init(apiKey) {
    if (this.map) return this.map;

    const key = String(apiKey || '').trim();
    if (!key) {
      throw new Error('HERE API key is missing.');
    }

    const container = document.getElementById(this.containerId);
    if (!container) {
      throw new Error(`HERE map container #${this.containerId} was not found.`);
    }

    if (!window.H?.service?.Platform) {
      throw new Error('HERE Maps JavaScript SDK is not loaded.');
    }

    this.platform = new H.service.Platform({ apikey: key });

    this.layers = this.platform.createDefaultLayers({
      lg: 'en',
      ppi: 200
    });

    /*
     * Prefer the normal vector layer because it is consistently available in
     * HERE Maps JS 3.x. Raster is used only when present.
     */
    this.dayLayer =
      this.layers.vector?.normal?.map ||
      this.layers.vector?.normal?.base ||
      this.layers.raster?.normal?.map ||
      null;

    /*
     * Keep the production driver on the proven day layer for now.
     * Night mode is intentionally disabled until a verified HERE 3.2
     * night layer is available for this API key/account.
     */
    this.nightLayer = null;

    if (!this.dayLayer) {
      throw new Error('HERE day base-map layer is unavailable.');
    }

    this.map = new H.Map(
      container,
      this.dayLayer,
      {
        pixelRatio: window.devicePixelRatio || 1,
        center: { lat: 51.5074, lng: -0.1278 },
        zoom: 10
      }
    );

    if (H.mapevents?.MapEvents && H.mapevents?.Behavior) {
      const events = new H.mapevents.MapEvents(this.map);
      this.behavior = new H.mapevents.Behavior(events);
    }

    if (H.ui?.UI?.createDefault) {
      try {
        this.ui = H.ui.UI.createDefault(this.map, this.layers);
      } catch (error) {
        console.warn('HERE default UI could not be created.', error);
      }
    }

    this.routeGroup = new H.map.Group();
    this.map.addObject(this.routeGroup);

    this.resizeHandler = () => this.refresh();
    this.orientationHandler = () => {
      window.setTimeout(() => this.refresh(), 250);
    };

    window.addEventListener('resize', this.resizeHandler, { passive: true });
    window.addEventListener(
      'orientationchange',
      this.orientationHandler,
      { passive: true }
    );

    if (window.visualViewport) {
      this.visualViewportHandler = () => {
        window.setTimeout(
          () => this.refresh(),
          80
        );
      };

      window.visualViewport.addEventListener(
        'resize',
        this.visualViewportHandler,
        { passive: true }
      );
    }

    /*
     * A second resize after first paint prevents the common blank/partial map
     * caused by the container receiving its final size after H.Map starts.
     */
    window.setTimeout(() => this.refresh(), 80);
    window.setTimeout(() => this.refresh(), 350);

    return this.map;
  }

  setNightMode(enabled) {
    if (!this.map) return false;

    const requestNight = Boolean(enabled);

    /*
     * Never allow night mode to turn the driver map black. If HERE does not
     * expose a usable night layer, remain on the day layer.
     */
    const layer =
      requestNight && this.nightLayer
        ? this.nightLayer
        : this.dayLayer;

    if (!layer) return false;

    try {
      this.map.setBaseLayer(layer);
      this.nightMode = requestNight && Boolean(this.nightLayer);

      const app = document.getElementById('app');
      if (app) {
        app.dataset.mapTheme = this.nightMode ? 'night' : 'day';
      }

      this.refresh();
      return this.nightMode === requestNight;
    } catch (error) {
      console.warn('HERE layer switch failed. Restoring day map.', error);

      try {
        if (this.dayLayer) this.map.setBaseLayer(this.dayLayer);
      } catch {}

      this.nightMode = false;
      return false;
    }
  }

  drawRoute(points, overview = true) {
    if (!this.map || !this.routeGroup) {
      throw new Error('HERE map is not initialised.');
    }

    this.routeGroup.removeAll();
    this.routeLine = null;
    this.startMarker = null;
    this.endMarker = null;

    this.routePoints = (Array.isArray(points) ? points : [])
      .map((point) => [Number(point?.[0]), Number(point?.[1])])
      .filter(
        (point) =>
          Number.isFinite(point[0]) &&
          Number.isFinite(point[1])
      );

    if (this.routePoints.length < 2) {
      this.routeBounds = null;
      return;
    }

    const lineString = new H.geo.LineString();

    for (const [lat, lng] of this.routePoints) {
      lineString.pushPoint({ lat, lng });
    }

    this.routeLine = new H.map.Polyline(
      lineString,
      {
        style: {
          lineWidth: 8,
          strokeColor: '#1677ff',
          lineCap: 'round',
          lineJoin: 'round'
        },
        volatility: true
      }
    );

    this.routeGroup.addObject(this.routeLine);

    const start = this.routePoints[0];
    const end = this.routePoints[this.routePoints.length - 1];

    this.startMarker = new H.map.Marker({
      lat: start[0],
      lng: start[1]
    });

    this.endMarker = new H.map.Marker({
      lat: end[0],
      lng: end[1]
    });

    this.startMarker.setData?.('Start');
    this.endMarker.setData?.('Destination');

    this.routeGroup.addObjects([
      this.startMarker,
      this.endMarker
    ]);

    this.routeBounds =
      this.routeGroup.getBoundingBox?.() ||
      this.routeLine.getBoundingBox?.() ||
      null;

    if (overview) {
      this.overview();
    }

    this.refresh();
  }

  setViewMode(mode) {
    const supported =
      new Set(['3d', '2d', 'north', 'overview']);

    this.viewMode =
      supported.has(mode) ? mode : '3d';

    if (!this.map) return;

    if (this.viewMode === 'overview') {
      this.overview();
      return;
    }

    if (this.lastPosition) {
      this.focus(
        this.lastPosition,
        {
          heading: this.lastHeading,
          immediate: true,
          viewMode: this.viewMode
        }
      );
    }
  }

  enterLive() {
    this.liveMode = true;
  }

  leaveLive() {
    this.liveMode = false;
  }

  overview() {
    if (!this.map) return;

    this.liveMode = false;
    this.viewMode = 'overview';

    if (this.routeBounds) {
      try {
        this.map.getViewModel().setLookAtData(
          {
            bounds: this.routeBounds,
            tilt: 0,
            heading: 0
          },
          false
        );
        return;
      } catch (error) {
        console.warn('HERE route bounds camera failed.', error);
      }
    }

    if (this.routePoints.length) {
      const middle =
        this.routePoints[
          Math.floor(this.routePoints.length / 2)
        ];

      this.map.setCenter({
        lat: middle[0],
        lng: middle[1]
      });

      this.map.setZoom(11);
    }
  }

  focus(position, options = {}) {
    if (!this.map || !position) return;

    const lat = Number(
      position.lat ??
      position.latitude
    );

    const lng = Number(
      position.lng ??
      position.lon ??
      position.longitude
    );

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      return;
    }

    const heading = this.normaliseHeading(
      options.heading ??
      position.heading ??
      this.lastHeading
    );

    const speedMps =
      Number(options.speedMps ?? position.speed ?? 0) || 0;

    const nextTurnM =
      Number(options.nextTurnM ?? Infinity);

    const viewMode =
      options.viewMode ||
      this.viewMode ||
      '3d';

    this.lastPosition = {
      lat,
      lng,
      accuracy: Number(position.accuracy || 0),
      speed: speedMps,
      heading
    };

    this.lastHeading = heading;

    this.updateVehicleMarker(lat, lng, heading);

    let zoom = 17.1;

    if (speedMps >= 24) zoom = 15.6;
    else if (speedMps >= 16) zoom = 16.0;
    else if (speedMps >= 9) zoom = 16.5;
    else if (speedMps >= 4) zoom = 16.9;

    /*
     * Progressive junction zoom. The camera tightens as the manoeuvre gets
     * closer, then naturally returns to the speed-based zoom afterwards.
     */
    if (Number.isFinite(nextTurnM)) {
      if (nextTurnM <= 60) {
        zoom = Math.max(zoom, 18.5);
      } else if (nextTurnM <= 150) {
        zoom = Math.max(zoom, 18.0);
      } else if (nextTurnM <= 350) {
        zoom = Math.max(zoom, 17.4);
      }
    }

    const northUp = viewMode === 'north';
    const is2d = viewMode === '2d' || northUp;
    const tilt = is2d ? 0 : 55;
    const cameraHeading = northUp ? 0 : heading;

    /*
     * Put the coach slightly below screen centre in navigation mode by moving
     * the camera target ahead of the vehicle. This gives the driver more road
     * visible in the direction of travel.
     */
    /*
     * Dynamic look-ahead keeps the coach in the lower third of the display.
     * Faster travel needs more road ahead; close junctions reduce look-ahead
     * so the manoeuvre stays visible instead of disappearing above the screen.
     */
    let lookAheadM =
      speedMps >= 20
        ? 135
        : speedMps >= 12
          ? 115
          : speedMps >= 5
            ? 95
            : 70;

    if (Number.isFinite(nextTurnM)) {
      if (nextTurnM <= 70) {
        lookAheadM = 42;
      } else if (nextTurnM <= 160) {
        lookAheadM = Math.min(
          lookAheadM,
          65
        );
      }
    }

    const target =
      this.liveMode && !northUp
        ? this.projectAhead(
            lat,
            lng,
            cameraHeading,
            lookAheadM
          )
        : { lat, lng };

    const lookAt = {
      position: target,
      zoom,
      tilt,
      heading: cameraHeading
    };

    try {
      this.map.getViewModel().setLookAtData(
        lookAt,
        Boolean(options.immediate)
          ? false
          : true
      );
    } catch (error) {
      /*
       * Older HERE builds may reject one of the camera properties. Fall back
       * to basic center/zoom rather than breaking navigation.
       */
      console.warn('HERE navigation camera fallback.', error);

      this.map.setCenter(target);
      this.map.setZoom(zoom);

      try {
        this.map.getViewModel().setLookAtData(
          {
            heading: cameraHeading,
            tilt
          },
          false
        );
      } catch {}
    }
  }

  updateVehicleMarker(lat, lng, heading) {
    if (!this.map) return;

    const icon = this.vehicleIcon(heading);

    if (!this.vehicleMarker) {
      this.vehicleMarker = new H.map.Marker(
        { lat, lng },
        {
          icon,
          volatility: true,
          zIndex: 1000
        }
      );

      this.map.addObject(this.vehicleMarker);
      return;
    }

    this.vehicleMarker.setGeometry({ lat, lng });

    if (icon && this.vehicleMarker.setIcon) {
      this.vehicleMarker.setIcon(icon);
    }
  }

  vehicleIcon(heading = 0) {
    if (!window.H?.map?.Icon) return undefined;

    const angle =
      this.normaliseHeading(heading);

    const svg = `
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="44"
        height="56"
        viewBox="0 0 44 56"
      >
        <g transform="rotate(${angle} 22 28)">
          <path
            d="M22 2 L39 42 L22 35 L5 42 Z"
            fill="#f5c94f"
            stroke="#111820"
            stroke-width="3"
            stroke-linejoin="round"
          />
          <circle
            cx="22"
            cy="30"
            r="5"
            fill="#111820"
          />
        </g>
      </svg>
    `;

    try {
      return new H.map.Icon(svg, {
        size: { w: 44, h: 56 },
        anchor: { x: 22, y: 28 }
      });
    } catch {
      return undefined;
    }
  }


  previewAlternative(points, { durationMs = 6000 } = {}) {
    if (!this.map || !window.H?.geo?.LineString) return;

    const safePoints =
      (Array.isArray(points) ? points : [])
        .map((point) => [
          Number(point?.[0]),
          Number(point?.[1])
        ])
        .filter((point) =>
          Number.isFinite(point[0]) &&
          Number.isFinite(point[1])
        );

    if (safePoints.length < 2) return;

    if (this.alternativePreview) {
      try {
        this.map.removeObject(
          this.alternativePreview
        );
      } catch {}
      this.alternativePreview = null;
    }

    clearTimeout(this.alternativePreviewTimer);

    const lineString =
      new H.geo.LineString();

    safePoints.forEach(([lat, lng]) => {
      lineString.pushPoint({ lat, lng });
    });

    this.alternativePreview =
      new H.map.Polyline(
        lineString,
        {
          style: {
            lineWidth: 7,
            strokeColor: '#f3bd45',
            lineDash: [10, 8],
            lineCap: 'round',
            lineJoin: 'round'
          },
          volatility: true
        }
      );

    this.map.addObject(
      this.alternativePreview
    );

    try {
      const bounds =
        this.alternativePreview.getBoundingBox?.();

      if (bounds) {
        this.map
          .getViewModel()
          .setLookAtData(
            {
              bounds,
              tilt: 0
            },
            true
          );
      }
    } catch {}

    this.alternativePreviewTimer =
      window.setTimeout(() => {
        try {
          if (this.alternativePreview) {
            this.map.removeObject(
              this.alternativePreview
            );
          }
        } catch {}

        this.alternativePreview = null;

        if (
          this.liveMode &&
          this.lastPosition
        ) {
          this.focus(
            this.lastPosition,
            {
              heading:
                this.lastHeading,
              immediate: true,
              viewMode:
                this.viewMode
            }
          );
        }
      }, Math.max(1500, Number(durationMs || 6000)));
  }

  zoomBy(delta) {
    if (!this.map) return;

    const current =
      Number(this.map.getZoom?.() || 0);

    const next =
      Math.max(2, Math.min(20, current + Number(delta || 0)));

    try {
      this.map.setZoom(next, true);
    } catch {
      this.map.setZoom(next);
    }
  }

  refresh() {
    if (!this.map) return;

    try {
      this.map.getViewPort().resize();
    } catch {}

    /*
     * Force the current base layer back if the canvas has lost it after a
     * fullscreen/orientation change.
     */
    try {
      const expected =
        this.nightMode && this.nightLayer
          ? this.nightLayer
          : this.dayLayer;

      if (expected && this.map.getBaseLayer?.() !== expected) {
        this.map.setBaseLayer(expected);
      }
    } catch {}
  }

  normaliseHeading(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return ((number % 360) + 360) % 360;
  }

  projectAhead(lat, lng, headingDegrees, distanceM) {
    const earthRadius = 6378137;
    const angularDistance = distanceM / earthRadius;
    const bearing =
      this.normaliseHeading(headingDegrees) *
      Math.PI / 180;

    const lat1 = lat * Math.PI / 180;
    const lon1 = lng * Math.PI / 180;

    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) *
        Math.sin(angularDistance) *
        Math.cos(bearing)
    );

    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(bearing) *
          Math.sin(angularDistance) *
          Math.cos(lat1),
        Math.cos(angularDistance) -
          Math.sin(lat1) *
          Math.sin(lat2)
      );

    return {
      lat: lat2 * 180 / Math.PI,
      lng: lon2 * 180 / Math.PI
    };
  }

  dispose() {
    if (this.resizeHandler) {
      window.removeEventListener(
        'resize',
        this.resizeHandler
      );
    }

    if (this.orientationHandler) {
      window.removeEventListener(
        'orientationchange',
        this.orientationHandler
      );
    }

    if (
      this.visualViewportHandler &&
      window.visualViewport
    ) {
      window.visualViewport.removeEventListener(
        'resize',
        this.visualViewportHandler
      );
    }

    try {
      this.behavior?.dispose?.();
    } catch {}

    try {
      this.ui?.dispose?.();
    } catch {}

    clearTimeout(this.alternativePreviewTimer);

    try {
      this.map?.dispose?.();
    } catch {}

    this.map = null;
    this.platform = null;
    this.layers = null;
    this.routeGroup = null;
    this.vehicleMarker = null;
  }
}

/* COACH_SAFE_STAGE17B_ALTERNATIVE_PREVIEW */

/* COACH_SAFE_STAGE191D_CAMERA */
