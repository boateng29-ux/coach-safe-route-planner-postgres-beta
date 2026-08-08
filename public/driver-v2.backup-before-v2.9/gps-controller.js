export class GpsController{
  constructor(onPosition,onError){this.watchId=null;this.onPosition=onPosition;this.onError=onError}
  get active(){return this.watchId!==null}
  start(){
    if(this.active)return;
    if(!navigator.geolocation)throw new Error('GPS is not supported.');
    this.watchId=navigator.geolocation.watchPosition(this.onPosition,this.onError,{enableHighAccuracy:true,maximumAge:1000,timeout:15000});
  }
  stop(){if(this.active)navigator.geolocation.clearWatch(this.watchId);this.watchId=null}
}
