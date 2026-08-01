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

    const baseLayer =
      layers.vector?.normal?.map ||
      layers.vector?.normal?.base;

    if (!baseLayer) {
      throw new Error('HERE vector base layer is unavailable.');
    }

    this.map = new H.Map(
      document.getElementById(this.containerId),
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
        strokeColor: 'rgba(255,255,255,0.94)',
        lineWidth: 15,
        lineCap: 'round',
        lineJoin: 'round'
      },
      volatility: true
    });

    this.routeLine = new H.map.Polyline(lineString, {
      style: {
        strokeColor: '#0f6ff4',
        lineWidth: 9,
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
    if (Number.isFinite(nextTurnM) && nextTurnM <= 45) return 19.4;
    if (Number.isFinite(nextTurnM) && nextTurnM <= 110) return 19.0;
    if (Number.isFinite(nextTurnM) && nextTurnM <= 240) return 18.5;

    const mph = Number.isFinite(speedMps) && speedMps >= 0
      ? speedMps * 2.23694
      : 0;

    if (mph < 12) return 18.8;
    if (mph < 25) return 18.3;
    if (mph < 40) return 17.7;
    if (mph < 55) return 17.1;
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

    let tilt = 58;
    let lookAheadM = 72;

    if (nextTurnM <= 45) {
      tilt = 48;
      lookAheadM = 26;
    } else if (nextTurnM <= 110) {
      tilt = 52;
      lookAheadM = 42;
    } else if (nextTurnM <= 240) {
      tilt = 55;
      lookAheadM = 60;
    } else if (mph >= 55) {
      tilt = 62;
      lookAheadM = 145;
    } else if (mph >= 40) {
      tilt = 60;
      lookAheadM = 118;
    } else if (mph >= 25) {
      tilt = 58;
      lookAheadM = 95;
    } else if (mph < 12) {
      tilt = 55;
      lookAheadM = 58;
    }

    if (is2d) {
      tilt = 0;
      lookAheadM = nextTurnM <= 70 ? 24 : mph >= 40 ? 82 : 50;
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
