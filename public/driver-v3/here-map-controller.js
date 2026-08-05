export class HereMapController {
  constructor(containerId) {
    this.containerId = containerId;
    this.platform = null;
    this.map = null;
    this.behavior = null;
    this.routeGroup = null;
    this.routeLine = null;
    this.startMarker = null;
    this.endMarker = null;
    this.liveMode = false;
    this.lastHeading = 0;
    this.lastPosition = null;
    this.resizeHandler = null;
    this.viewMode = '3d';
    this.layers = null;
  }

  init(apiKey) {
    if (!window.H) {
      throw new Error('HERE Maps JavaScript library did not load.');
    }
    if (!apiKey) {
      throw new Error('HERE Maps JavaScript API key is missing.');
    }

    this.platform = new H.service.Platform({ apikey: apiKey });

    const ppi = window.devicePixelRatio >= 2 ? 200 : 100;
    const layers = this.platform.createDefaultLayers({
      lg: 'eng',
      ppi,
      pois: true
    });
    this.layers = layers;

    /*
     * Prefer HERE satellite/hybrid imagery for a richer professional map.
     * Layer names vary slightly between HERE configurations, so use a
     * defensive candidate list and fall back to the normal vector map.
     */
    const aerialLayer =
      layers.raster?.satellite?.map ||
      layers.raster?.satellite?.base ||
      layers.raster?.hybrid?.map ||
      layers.raster?.hybrid?.base ||
      null;

    const vectorLayer =
      layers.vector?.normal?.map ||
      layers.vector?.normal?.base ||
      null;

    const baseLayer = aerialLayer || vectorLayer;

    if (!baseLayer) {
      throw new Error('HERE base map layer is unavailable.');
    }

    const container = document.getElementById(this.containerId);
    const app = document.getElementById('app');

    if (app) {
      app.dataset.mapStyle = aerialLayer ? 'aerial' : 'vector';
    }

    this.map = new H.Map(
      container,
      baseLayer,
      {
        center: { lat: 51.47, lng: -0.36 },
        zoom: 13,
        pixelRatio: window.devicePixelRatio || 1
      }
    );

    const events = new H.mapevents.MapEvents(this.map);
    this.behavior = new H.mapevents.Behavior(events);

    this.resizeHandler = () => {
      this.map.getViewPort().resize();
    };
    window.addEventListener('resize', this.resizeHandler);

    return this.map;
  }

  setMapStyle(style = 'aerial') {
    if (!this.map || !this.layers) return false;

    const aerial =
      this.layers.raster?.satellite?.map ||
      this.layers.raster?.satellite?.base ||
      this.layers.raster?.hybrid?.map ||
      this.layers.raster?.hybrid?.base ||
      null;

    const vector =
      this.layers.vector?.normal?.map ||
      this.layers.vector?.normal?.base ||
      null;

    const layer = style === 'vector'
      ? vector
      : aerial || vector;

    if (!layer) return false;

    this.map.setBaseLayer(layer);

    const app = document.getElementById('app');
    if (app) {
      app.dataset.mapStyle =
        style === 'vector' || !aerial
          ? 'vector'
          : 'aerial';
    }

    this.refresh();
    return true;
  }

  makeLineString(points) {
    const lineString = new H.geo.LineString();
    for (const [lat, lng] of points) {
      lineString.pushPoint({ lat, lng });
    }
    return lineString;
  }

  markerIcon(color) {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36">
        <path d="M14 1C7 1 2 6 2 13c0 9 12 22 12 22s12-13 12-22C26 6 21 1 14 1z"
          fill="${color}" stroke="white" stroke-width="2"/>
        <circle cx="14" cy="13" r="4" fill="white"/>
      </svg>`;
    return new H.map.Icon(svg, { anchor: { x: 14, y: 35 } });
  }

  drawRoute(points, overview = true) {
    if (this.routeGroup) {
      this.map.removeObject(this.routeGroup);
    }

    const lineString = this.makeLineString(points);

    const shadow = new H.map.Polyline(lineString, {
      style: {
        strokeColor: 'rgba(255,255,255,0.96)',
        lineWidth: 16,
        lineCap: 'round',
        lineJoin: 'round'
      },
      volatility: true
    });

    this.routeLine = new H.map.Polyline(lineString, {
      style: {
        strokeColor: '#096df3',
        lineWidth: 10,
        lineCap: 'round',
        lineJoin: 'round'
      },
      volatility: true
    });

    this.routeGroup = new H.map.Group();
    this.routeGroup.addObjects([shadow, this.routeLine]);

    if (points.length) {
      this.startMarker = new H.map.Marker(
        { lat: points[0][0], lng: points[0][1] },
        { icon: this.markerIcon('#34d27f') }
      );
      this.endMarker = new H.map.Marker(
        { lat: points.at(-1)[0], lng: points.at(-1)[1] },
        { icon: this.markerIcon('#ff625f') }
      );
      this.routeGroup.addObjects([this.startMarker, this.endMarker]);
    }

    this.map.addObject(this.routeGroup);

    if (overview) {
      this.leaveLive();
      this.overview();
    }
  }

  enterLive() {
    this.liveMode = true;
    this.startMarker?.setVisibility(false);
    this.endMarker?.setVisibility(false);
  }

  leaveLive() {
    this.liveMode = false;
    this.startMarker?.setVisibility(true);
    this.endMarker?.setVisibility(true);
  }

  overview() {
    if (!this.routeGroup) return;
    this.leaveLive();

    this.map.getViewModel().setLookAtData(
      {
        bounds: this.routeGroup.getBoundingBox(),
        heading: 0,
        tilt: 0
      },
      true
    );
  }

  destinationPoint(position, heading, distanceM) {
    const R = 6371000;
    const bearing = heading * Math.PI / 180;
    const lat1 = position.lat * Math.PI / 180;
    const lon1 = position.lng * Math.PI / 180;
    const angular = distanceM / R;

    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angular) +
      Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing)
    );

    const lon2 = lon1 + Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
    );

    return {
      lat: lat2 * 180 / Math.PI,
      lng: lon2 * 180 / Math.PI
    };
  }

  zoomForSpeed(speedMps, nextTurnM = Infinity) {
    if (Number.isFinite(nextTurnM) && nextTurnM <= 35) return 19.7;
    if (Number.isFinite(nextTurnM) && nextTurnM <= 75) return 19.35;
    if (Number.isFinite(nextTurnM) && nextTurnM <= 120) return 19.05;
    if (Number.isFinite(nextTurnM) && nextTurnM <= 240) return 18.55;

    const mph = Number.isFinite(speedMps) && speedMps >= 0
      ? speedMps * 2.23694
      : 0;

    if (mph < 12) return 19.0;
    if (mph < 25) return 18.45;
    if (mph < 40) return 17.8;
    if (mph < 55) return 17.15;
    return 16.6;
  }

  focus(position, {
    heading = 0,
    speedMps = 0,
    nextTurnM = Infinity,
    immediate = false,
    viewMode = this.viewMode
  } = {}) {
    if (!position || !this.map) return;

    this.enterLive();
    this.viewMode = viewMode;

    const isNorth = viewMode === 'north';
    const is2d = viewMode === '2d';
    const desiredHeading = isNorth ? 0 : heading;
    const zoom = this.zoomForSpeed(speedMps, nextTurnM);

    const mph = Number.isFinite(speedMps) && speedMps >= 0
      ? speedMps * 2.23694
      : 0;

    let tilt = 57;
    let lookAheadM = 82;

    if (nextTurnM <= 35) {
      tilt = 42;
      lookAheadM = 18;
    } else if (nextTurnM <= 75) {
      tilt = 46;
      lookAheadM = 28;
    } else if (nextTurnM <= 120) {
      tilt = 49;
      lookAheadM = 40;
    } else if (nextTurnM <= 240) {
      tilt = 54;
      lookAheadM = 62;
    } else if (mph >= 55) {
      tilt = 61;
      lookAheadM = 150;
    } else if (mph >= 40) {
      tilt = 60;
      lookAheadM = 120;
    } else if (mph >= 25) {
      tilt = 58;
      lookAheadM = 98;
    } else if (mph < 12) {
      tilt = 54;
      lookAheadM = 66;
    }

    if (is2d) {
      tilt = 0;
      lookAheadM = nextTurnM <= 120 ? 26 : mph >= 40 ? 86 : 54;
    } else if (isNorth) {
      tilt = 0;
      lookAheadM = 0;
    }

    const target = lookAheadM > 0
      ? this.destinationPoint(position, desiredHeading, lookAheadM)
      : position;

    this.lastHeading = desiredHeading;
    this.lastPosition = position;

    this.map.getViewModel().setLookAtData(
      {
        position: target,
        zoom: isNorth ? Math.min(zoom, 17.7) : zoom,
        tilt,
        heading: desiredHeading
      },
      !immediate
    );
  }

  setViewMode(mode) {
    const supported = new Set(['3d', '2d', 'north', 'overview']);
    this.viewMode = supported.has(mode) ? mode : '3d';

    if (this.viewMode === 'overview') {
      this.overview();
    }
  }

  zoomBy(delta) {
    this.map.setZoom(this.map.getZoom() + delta, true);
  }

  refresh() {
    this.map?.getViewPort().resize();
  }

  dispose() {
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
    }
    this.behavior?.dispose();
    this.map?.dispose();
  }
}
