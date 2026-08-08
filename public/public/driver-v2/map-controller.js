export class MapController{
  constructor(id){
    this.id=id;this.map=null;this.tiles=null;this.routeLine=null;this.startMarker=null;this.endMarker=null;
    this.gpsMarker=null;this.accuracyCircle=null;this.tileErrors=0;this.fallbackUsed=false;
  }
  init(){
    this.map=L.map(this.id,{zoomControl:true,attributionControl:true,preferCanvas:true});
    this.useHereTiles();
    return this.map;
  }
  useHereTiles(){
    this.tiles=L.tileLayer('/driver-v2/tiles/{z}/{x}/{y}.png?v=23',{tileSize:256,zoomOffset:0,minZoom:2,maxZoom:20,detectRetina:false,keepBuffer:3,attribution:'© HERE'});
    this.tiles.on('tileerror',()=>{this.tileErrors++;if(this.tileErrors>=3&&!this.fallbackUsed)this.useFallbackTiles()});
    this.tiles.addTo(this.map);
  }
  useFallbackTiles(){
    this.fallbackUsed=true;
    if(this.tiles)this.map.removeLayer(this.tiles);
    this.tiles=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:20,attribution:'© OpenStreetMap contributors',crossOrigin:true});
    this.tiles.addTo(this.map);
  }
  drawRoute(points,overview=true){
    if(this.routeLine)this.map.removeLayer(this.routeLine);
    if(this.startMarker)this.map.removeLayer(this.startMarker);
    if(this.endMarker)this.map.removeLayer(this.endMarker);
    this.routeLine=L.polyline(points,{weight:7,opacity:.95,color:'#2478ff'}).addTo(this.map);
    if(points.length){
      this.startMarker=L.circleMarker(points[0],{radius:6,color:'#fff',weight:2,fillColor:'#36d27e',fillOpacity:1}).addTo(this.map);
      this.endMarker=L.circleMarker(points.at(-1),{radius:7,color:'#fff',weight:2,fillColor:'#ff665f',fillOpacity:1}).addTo(this.map);
    }
    if(overview&&this.routeLine)this.map.fitBounds(this.routeLine.getBounds(),{padding:[70,40],maxZoom:15});
  }
  enterLive(){
    if(this.startMarker&&this.map.hasLayer(this.startMarker))this.map.removeLayer(this.startMarker);
    if(this.endMarker&&this.map.hasLayer(this.endMarker))this.map.removeLayer(this.endMarker);
  }
  setGps(point,accuracy){
    if(!this.gpsMarker){
      this.gpsMarker=L.circleMarker(point,{radius:7,color:'#fff',weight:3,fillColor:'#2979ff',fillOpacity:1}).addTo(this.map);
      this.accuracyCircle=L.circle(point,{radius:Math.min(18,accuracy||8),weight:1,color:'#2979ff',opacity:.24,fillOpacity:.04,interactive:false}).addTo(this.map);
    }else{
      this.gpsMarker.setLatLng(point);
      this.accuracyCircle.setLatLng(point).setRadius(Math.min(18,accuracy||8));
    }
  }
  lowerThirdCentre(point,zoom){
    const size=this.map.getSize();
    const projected=this.map.project(point,zoom);
    return this.map.unproject(L.point(projected.x,projected.y-(size.y*.2)),zoom);
  }
  focus(point,zoom=17.5,animate=true){
    this.map.invalidateSize(false);
    this.map.setView(this.lowerThirdCentre(point,zoom),zoom,{animate});
  }
  overview(){
    if(this.routeLine)this.map.fitBounds(this.routeLine.getBounds(),{padding:[70,40],maxZoom:15});
  }
  refresh(){this.map.invalidateSize(true)}
}
