export class CameraController{
  constructor(mapController){
    this.mapController=mapController;
    this.follow=true;
    this.lastAt=0;
    this.lastZoom=18;
  }

  zoomForSpeed(speedMps,nextTurnM=Infinity){
    if(Number.isFinite(nextTurnM)&&nextTurnM<=70)return 19;
    if(Number.isFinite(nextTurnM)&&nextTurnM<=180)return 18.5;

    const mph=Number.isFinite(speedMps)&&speedMps>=0?speedMps*2.23694:0;
    if(mph<18)return 18;
    if(mph<35)return 17.5;
    if(mph<52)return 17;
    return 16.5;
  }

  focus(gps,{force=false,zoom,nextTurnM=Infinity}={}){
    if(!gps||!this.follow)return false;

    const now=Date.now();
    if(!force&&now-this.lastAt<700)return false;
    this.lastAt=now;

    const targetZoom=Number.isFinite(zoom)
      ? zoom
      : this.zoomForSpeed(gps.speed,nextTurnM);

    this.lastZoom=targetZoom;
    this.mapController.focus(
      [gps.lat,gps.lng],
      targetZoom,
      !force
    );
    return true;
  }

  resume(gps){
    this.follow=true;
    return this.focus(gps,{force:true,zoom:18});
  }

  pause(){
    this.follow=false;
  }
}
