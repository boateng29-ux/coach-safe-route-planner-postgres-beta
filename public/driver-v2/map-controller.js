export class MapController {
  constructor(id) {
    this.id = id;
    this.map = null;
    this.tiles = null;
    this.routeLine = null;
    this.startMarker = null;
    this.endMarker = null;
    this.gpsMarker = null;
    this.accuracyCircle = null;
    this.tileErrors = 0;
    this.fallbackUsed = false;
    this.liveMode = false;
    this.currentBearing = 0;
    this.targetBearing = 0;
    this.rotationFrame = null;
  }

  init() {
    this.map = L.map(this.id, {
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true,
      zoomAnimation: true,
      fadeAnimation: true,
      markerZoomAnimation: true
    });

    this.useHereTiles();
    return this.map;
  }

  useHereTiles() {
    this.tiles = L.tileLayer(
      '/driver-v2/tiles/{z}/{x}/{y}.png?v=25',
      {
        tileSize: 256,
        zoomOffset: 0,
        minZoom: 2,
        maxZoom: 20,
        detectRetina: false,
        updateWhenIdle: false,
        updateWhenZooming: false,
        keepBuffer: 4,
        attribution: '© HERE'
      }
    );

    this.tiles.on('tileerror', () => {
      this.tileErrors += 1;
      if (this.tileErrors >= 3 && !this.fallbackUsed) {
        this.useFallbackTiles();
      }
    });

    this.tiles.addTo(this.map);
  }

  useFallbackTiles() {
    this.fallbackUsed = true;

    if (this.tiles && this.map.hasLayer(this.tiles)) {
      this.map.removeLayer(this.tiles);
    }

    this.tiles = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 20,
        attribution: '© OpenStreetMap contributors',
        crossOrigin: true,
        keepBuffer: 4
      }
    );

    this.tiles.addTo(this.map);
  }

  drawRoute(points, overview = true) {
    if (this.routeLine && this.map.hasLayer(this.routeLine)) {
      this.map.removeLayer(this.routeLine);
    }
    if (this.startMarker && this.map.hasLayer(this.startMarker)) {
      this.map.removeLayer(this.startMarker);
    }
    if (this.endMarker && this.map.hasLayer(this.endMarker)) {
      this.map.removeLayer(this.endMarker);
    }

    this.routeLine = L.polyline(points, {
      weight: 7,
      opacity: 0.95,
      color: '#2478ff',
      lineJoin: 'round',
      lineCap: 'round'
    }).addTo(this.map);

    if (points.length) {
      this.startMarker = L.circleMarker(points[0], {
        radius: 6,
        color: '#fff',
        weight: 2,
        fillColor: '#36d27e',
        fillOpacity: 1
      }).addTo(this.map);

      this.endMarker = L.circleMarker(points.at(-1), {
        radius: 7,
        color: '#fff',
        weight: 2,
        fillColor: '#ff665f',
        fillOpacity: 1
      }).addTo(this.map);
    }

    if (overview) {
      this.liveMode = false;
      this.overview();
    }
  }

  enterLive() {
    this.liveMode = true;

    if (this.startMarker && this.map.hasLayer(this.startMarker)) {
      this.map.removeLayer(this.startMarker);
    }
    if (this.endMarker && this.map.hasLayer(this.endMarker)) {
      this.map.removeLayer(this.endMarker);
    }

    /*
     * In live mode the fixed lower-third vehicle arrow is the primary
     * location indicator. Hide the Leaflet GPS dot to prevent duplication.
     */
    if (this.gpsMarker) {
      this.gpsMarker.setStyle({
        opacity: 0,
        fillOpacity: 0
      });
    }

    if (this.accuracyCircle) {
      this.accuracyCircle.setStyle({
        opacity: 0,
        fillOpacity: 0
      });
    }
  }

  leaveLive() {
    this.liveMode = false;

    if (this.startMarker && !this.map.hasLayer(this.startMarker)) {
      this.startMarker.addTo(this.map);
    }
    if (this.endMarker && !this.map.hasLayer(this.endMarker)) {
      this.endMarker.addTo(this.map);
    }

    if (this.gpsMarker) {
      this.gpsMarker.setStyle({
        opacity: 1,
        fillOpacity: 1
      });
    }

    if (this.accuracyCircle) {
      this.accuracyCircle.setStyle({
        opacity: 0.22,
        fillOpacity: 0.035
      });
    }
  }

  setGps(point, accuracy) {
    const visibleAccuracy = Math.max(
      5,
      Math.min(Number(accuracy || 0), 18)
    );

    if (!this.gpsMarker) {
      this.gpsMarker = L.circleMarker(point, {
        radius: 7,
        color: '#fff',
        weight: 3,
        fillColor: '#2979ff',
        fillOpacity: this.liveMode ? 0 : 1,
        opacity: this.liveMode ? 0 : 1,
        interactive: false
      }).addTo(this.map);

      this.accuracyCircle = L.circle(point, {
        radius: visibleAccuracy,
        weight: 1,
        color: '#2979ff',
        opacity: this.liveMode ? 0 : 0.22,
        fillOpacity: this.liveMode ? 0 : 0.035,
        interactive: false
      }).addTo(this.map);
    } else {
      this.gpsMarker.setLatLng(point);
      this.accuracyCircle
        .setLatLng(point)
        .setRadius(visibleAccuracy);
    }
  }

  /**
   * Leaflet positions the camera around a geographical centre.
   * Shifting that centre slightly ahead on screen keeps the driver
   * at roughly 70–72% down the display.
   */
  lowerThirdCentre(point, zoom) {
    const size = this.map.getSize();
    const projected = this.map.project(point, zoom);

    const lookAheadPixels = Math.max(
      95,
      Math.min(size.y * 0.25, 220)
    );

    return this.map.unproject(
      L.point(projected.x, projected.y - lookAheadPixels),
      zoom
    );
  }

  focus(point, zoom = 18, animate = true) {
    if (!this.map || !Array.isArray(point)) return false;

    this.enterLive();
    this.map.invalidateSize(false);

    const centre = this.lowerThirdCentre(point, zoom);

    this.map.setView(centre, zoom, {
      animate,
      duration: animate ? 0.45 : 0
    });

    return true;
  }

  overview() {
    if (this.liveMode) return false;
    if (!this.routeLine) return false;

    this.map.invalidateSize(false);
    this.map.fitBounds(this.routeLine.getBounds(), {
      padding: [70, 40],
      maxZoom: 15,
      animate: true
    });

    return true;
  }

  normaliseBearing(value) {
    return ((Number(value || 0) % 360) + 360) % 360;
  }

  shortestBearingDelta(from, to) {
    return ((to - from + 540) % 360) - 180;
  }

  setBearing(bearing, { immediate = false } = {}) {
    if (!this.map) return;

    this.targetBearing = this.normaliseBearing(bearing);

    if (immediate) {
      this.currentBearing = this.targetBearing;
      this.applyBearing();
      return;
    }

    if (this.rotationFrame) return;

    const animate = () => {
      const delta = this.shortestBearingDelta(
        this.currentBearing,
        this.targetBearing
      );

      if (Math.abs(delta) < 0.3) {
        this.currentBearing = this.targetBearing;
        this.applyBearing();
        this.rotationFrame = null;
        return;
      }

      this.currentBearing = this.normaliseBearing(
        this.currentBearing + delta * 0.16
      );

      this.applyBearing();
      this.rotationFrame = requestAnimationFrame(animate);
    };

    this.rotationFrame = requestAnimationFrame(animate);
  }

  applyBearing() {
    const mapNode = this.map.getContainer();

    /*
     * Rotate the map opposite to the travel bearing so the route ahead
     * points toward the top of the display. Scale prevents black corners.
     */
    mapNode.style.setProperty(
      '--coach-map-bearing',
      `${-this.currentBearing}deg`
    );
  }

  resetBearing() {
    this.setBearing(0, { immediate: true });
  }

  refresh() {
    if (!this.map) return;
    this.map.invalidateSize(true);
    this.applyBearing();
  }
}
