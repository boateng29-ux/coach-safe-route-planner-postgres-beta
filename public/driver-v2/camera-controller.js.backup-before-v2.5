export class CameraController {
  constructor(mapController) {
    this.mapController = mapController;
    this.follow = true;
    this.lastUpdateAt = 0;
    this.lastPoint = null;
    this.lastZoom = 18;
  }

  zoomForSpeed(speedMps, nextTurnM = Infinity) {
    if (Number.isFinite(nextTurnM) && nextTurnM <= 70) {
      return 19;
    }

    if (Number.isFinite(nextTurnM) && nextTurnM <= 180) {
      return 18.5;
    }

    const mph =
      Number.isFinite(speedMps) && speedMps >= 0
        ? speedMps * 2.23694
        : 0;

    if (mph < 18) return 18;
    if (mph < 35) return 17.5;
    if (mph < 52) return 17;
    return 16.5;
  }

  distanceMetres(a, b) {
    if (!a || !b) return Infinity;

    const R = 6371000;
    const toRad = (value) => value * Math.PI / 180;

    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);

    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) *
        Math.cos(lat2) *
        Math.sin(dLng / 2) ** 2;

    return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  focus(gps, {
    force = false,
    zoom,
    nextTurnM = Infinity
  } = {}) {
    if (!gps || !this.follow) return false;

    const point = {
      lat: Number(gps.lat),
      lng: Number(gps.lng)
    };

    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
      return false;
    }

    const now = Date.now();
    const movedM = this.distanceMetres(this.lastPoint, point);

    if (!force) {
      if (now - this.lastUpdateAt < 750) return false;

      // Do not chase tiny stationary GPS fluctuations.
      if (
        this.lastPoint &&
        movedM < 4 &&
        Number(gps.accuracy || 999) > 15
      ) {
        return false;
      }
    }

    const targetZoom = Number.isFinite(zoom)
      ? zoom
      : this.zoomForSpeed(gps.speed, nextTurnM);

    this.lastUpdateAt = now;
    this.lastPoint = point;
    this.lastZoom = targetZoom;

    return this.mapController.focus(
      [point.lat, point.lng],
      targetZoom,
      !force
    );
  }

  resume(gps) {
    this.follow = true;
    return this.focus(gps, {
      force: true,
      zoom: 18
    });
  }

  pause() {
    this.follow = false;
  }
}
