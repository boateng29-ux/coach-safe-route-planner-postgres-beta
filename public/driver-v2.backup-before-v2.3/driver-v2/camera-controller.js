export class CameraController{
  constructor(mapController){this.mapController=mapController;this.follow=true;this.lastAt=0}
  focus(gps,{force=false,zoom=17.5}={}){
    if(!gps||!this.follow)return;
    const now=Date.now();if(!force&&now-this.lastAt<800)return;
    this.lastAt=now;this.mapController.focus([gps.lat,gps.lng],zoom,!force);
  }
}
