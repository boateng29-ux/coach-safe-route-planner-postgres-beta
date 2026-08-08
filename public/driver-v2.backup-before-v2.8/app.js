import{MapController}from'./map-controller.js?v=28';
import{GpsController}from'./gps-controller.js?v=28';
import{CameraController}from'./camera-controller.js?v=28';
import{VoiceController}from'./voice-controller.js?v=28';

const $=id=>document.getElementById(id);
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const rad=d=>d*Math.PI/180;
const state={
  id:'',
  route:null,
  points:[],
  instructions:[],
  measures:[],
  totalM:0,
  gps:null,
  snappedGps:null,
  lastHeading:null,
  mode:'overview',
  wakeLock:null,
  currentInstruction:0,
  gpsReliable:false
};
const mapCtl=new MapController('map');
const camera=new CameraController(mapCtl);
const voice=new VoiceController();
let gps;

function toast(message){const n=$('toast');n.textContent=message;n.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>n.classList.remove('show'),2300)}
function routeId(){const m=location.pathname.match(/\/driver-v2\/route\/([^/?#]+)/i);return m?decodeURIComponent(m[1]):''}
function haversine(a,b){const R=6371000,dLat=rad(b[0]-a[0]),dLon=rad(b[1]-a[1]),p1=rad(a[0]),p2=rad(b[0]);const h=Math.sin(dLat/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dLon/2)**2;return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(1-h))}
function bearing(a,b){const p1=rad(a[0]),p2=rad(b[0]),dl=rad(b[1]-a[1]);const y=Math.sin(dl)*Math.cos(p2),x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);return( Math.atan2(y,x)*180/Math.PI+360)%360}
function smoothAngle(prev,next,w=.28){if(!Number.isFinite(prev))return next;const d=((next-prev+540)%360)-180;return(prev+d*w+360)%360}
function buildMeasures(points){const out=[0];for(let i=1;i<points.length;i++)out[i]=out[i-1]+haversine(points[i-1],points[i]);return out}
function project(point,origin){const R=6371000;return{x:rad(point[1]-origin[1])*Math.cos(rad(origin[0]))*R,y:rad(point[0]-origin[0])*R}}
function nearestProgress(point){
  let best={
    progress:0,
    distance:Infinity,
    index:0,
    snapped:[point[0],point[1]]
  };

  for(let i=0;i<state.points.length-1;i++){
    const A=project(state.points[i],point);
    const B=project(state.points[i+1],point);
    const dx=B.x-A.x;
    const dy=B.y-A.y;
    const len=dx*dx+dy*dy;
    const t=len
      ?clamp(((-A.x)*dx+(-A.y)*dy)/len,0,1)
      :0;

    const x=A.x+t*dx;
    const y=A.y+t*dy;
    const distance=Math.hypot(x,y);

    if(distance<best.distance){
      const start=state.points[i];
      const end=state.points[i+1];

      best={
        distance,
        index:i,
        progress:(state.measures[i]||0)+
          t*haversine(start,end),
        snapped:[
          start[0]+(end[0]-start[0])*t,
          start[1]+(end[1]-start[1])*t
        ]
      };
    }
  }

  return best;
}
function metresText(m){if(!Number.isFinite(m))return'â€”';if(m<950)return Math.max(0,Math.round(m/10)*10)+'m';return(m/1609.344).toFixed(1)+' miles'}
function durationText(s){const mins=Math.max(0,Math.round(s/60)),h=Math.floor(mins/60),m=mins%60;return h?`${h}h ${m}m`:`${m}m`}
function etaText(s){return new Date(Date.now()+Math.max(0,s)*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}
function iconFor(i){const t=((i?.maneuver||'')+' '+(i?.instruction||'')).toLowerCase();if(t.includes('roundabout'))return'â†»';if(t.includes('left'))return'â†';if(t.includes('right'))return'â†’';if(t.includes('exit'))return'â†—';return'â†‘'}
function setMode(mode){state.mode=mode;$('app').dataset.mode=mode;if(mode==='live')mapCtl.enterLive()}
function updateGuidance(progress,offRoute){if(!state.instructions.length)return;let idx=state.instructions.findIndex(i=>Number(i.distanceM||0)>=progress+5);if(idx<0)idx=state.instructions.length-1;state.currentInstruction=idx;const ins=state.instructions[idx],nextM=Math.max(0,Number(ins.distanceM||0)-progress),remaining=Math.max(0,state.totalM-progress),totalS=Number(state.route.summary?.travelTimeInSeconds||0),remainingS=state.totalM?totalS*(remaining/state.totalM):0;$('turnIcon').textContent=iconFor(ins);$('instruction').textContent=ins.instruction||'Continue on route';$('turnDistance').textContent=
    state.gpsReliable&&nextM<=15
      ?'Now'
      :'Next in '+metresText(nextM);$('laneText').textContent=ins.laneGuidance?.text||'Follow road signs. Lane guidance not returned.';$('eta').textContent=etaText(remainingS);$('timeLeft').textContent=durationText(remainingS);$('distanceLeft').textContent=metresText(remaining);$('roadStatus').textContent=ins.street||ins.roadNumbers?.join(' Â· ')||'Route';$('currentRoad').textContent=ins.street||ins.roadNumbers?.join(' Â· ')||'Route';$('speedLimit').textContent=ins.speedLimit?.maxSpeedLimitMph?ins.speedLimit.maxSpeedLimitMph+' mph':'Limit â€”';$('speedLimitLarge').textContent=ins.speedLimit?.maxSpeedLimitMph||30;$('routeStatus').textContent=offRoute>120?'Off route':'On route';$('routeStatus').className='status '+(offRoute>120?'bad':'good');voice.maybeSpeak(ins,nextM,idx);if(nextM<180&&state.mode==='live')camera.focus(state.gps,{zoom:nextM<60?19:18.5})}
function drawRoute(route,overview=true){state.route=route;state.points=(route.points||[]).map(p=>[Number(p[0]),Number(p[1])]).filter(p=>p.every(Number.isFinite));state.instructions=(route.instructions||[]).slice().sort((a,b)=>Number(a.distanceM||0)-Number(b.distanceM||0));state.measures=buildMeasures(state.points);state.totalM=Number(route.summary?.lengthInMeters||state.measures.at(-1)||0);mapCtl.drawRoute(state.points,overview);setMode(overview?'overview':'live');updateGuidance(0,Infinity)}
function onGps(pos){
  const{
    latitude:lat,
    longitude:lng,
    accuracy,
    speed,
    heading
  }=pos.coords;

  let h=Number(heading);

  if(
    state.gps&&
    haversine(
      [state.gps.lat,state.gps.lng],
      [lat,lng]
    )>5
  ){
    h=bearing(
      [state.gps.lat,state.gps.lng],
      [lat,lng]
    );
  }

  h=smoothAngle(state.lastHeading,h,.3);
  if(Number.isFinite(h))state.lastHeading=h;

  const firstFix=!state.gps;
  const accuracyM=Number(accuracy||999);

  state.gps={
    lat,
    lng,
    accuracy:accuracyM,
    speed:Number(speed),
    heading:h
  };

  const nearest=nearestProgress([lat,lng]);

  /*
   * Only trust route snapping when the GPS fix is good enough and
   * the route is reasonably close to the raw position.
   */
  state.gpsReliable=
    accuracyM<=35&&
    nearest.distance<=Math.max(45,accuracyM*1.6);

  const displayPoint=state.gpsReliable
    ?nearest.snapped
    :[lat,lng];

  state.snappedGps={
    lat:displayPoint[0],
    lng:displayPoint[1],
    accuracy:accuracyM,
    speed:Number(speed),
    heading:h
  };

  mapCtl.setGps(displayPoint,accuracyM);

  $('gpsStatus').textContent=
    state.gpsReliable
      ?'GPS '+Math.round(accuracyM)+'m'
      :'GPS settling '+Math.round(accuracyM)+'m';

  $('gpsStatus').className=
    'status '+(state.gpsReliable?'good':'');

  $('gpsSignal').textContent=
    Math.round(accuracyM)+'m';

  $('speed').textContent=
    Number.isFinite(speed)&&speed>=0
      ?Math.round(speed*2.23694)+' mph'
      :'0 mph';

  $('speedLarge').textContent=
    Number.isFinite(speed)&&speed>=0
      ?Math.round(speed*2.23694)
      :0;

  if(Number.isFinite(h)){
    $('vehicleArrow').style.setProperty(
      '--heading',
      h+'deg'
    );
  }

  /*
   * While GPS is poor, keep the route progress conservative.
   * Do not jump instructions based on a wide accuracy circle.
   */
  if(state.gpsReliable){
    updateGuidance(
      nearest.progress,
      nearest.distance
    );
  }else{
    $('routeStatus').textContent='GPS settling';
    $('routeStatus').className='status';
  }

  setMode('live');

  const ins=state.instructions[state.currentInstruction];
  const nextTurnM=
    state.gpsReliable&&ins
      ?Math.max(
          0,
          Number(ins.distanceM||0)-nearest.progress
        )
      :Infinity;

  camera.focus(
    state.snappedGps,
    {
      force:firstFix,
      nextTurnM
    }
  );

  updateButtons();
}
function onGpsError(err){toast(err.message||'GPS permission failed');$('gpsStatus').textContent='GPS error';$('gpsStatus').className='status bad';updateButtons()}
function toggleGps(){if(gps.active){gps.stop();$('gpsStatus').textContent='GPS off';setMode('overview');mapCtl.overview()}else{camera.follow=true;gps.start();toast('Starting live GPSâ€¦')}updateButtons()}
async function reroute(){
  if(!state.gps){
    toast('Start GPS first');
    return;
  }

  if(!state.gpsReliable){
    toast('Wait for a more accurate GPS fix before recalculating');
    return;
  }const b=$('rerouteBtn');b.disabled=true;try{const r=await fetch(`/driver-v3/route/${encodeURIComponent(state.id)}/reroute`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lat:state.gps.lat,lng:state.gps.lng,accuracyM:state.gps.accuracy})});const p=await r.json();if(!r.ok)throw new Error(p.error||'Reroute failed');voice.reset();drawRoute(p.route,false);camera.focus(state.snappedGps||state.gps,{force:true,zoom:18});toast('Route recalculated')}catch(e){toast(e.message)}finally{b.disabled=false}}
async function toggleWake(){if(state.wakeLock){await state.wakeLock.release().catch(()=>{});state.wakeLock=null}else if('wakeLock'in navigator){state.wakeLock=await navigator.wakeLock.request('screen').catch(()=>null)}toast(state.wakeLock?'Screen will stay on':'Wake lock off');updateButtons()}
function toggleFullscreen(){document.body.classList.toggle('fullscreen');setTimeout(()=>{mapCtl.refresh();if(state.mode==='live')camera.focus(state.snappedGps||state.gps,{force:true});else mapCtl.overview()},180);updateButtons()}
function updateButtons(){
  $('gpsBtn').classList.toggle('active',!!gps?.active);
  $('voiceBtn').classList.toggle('active',voice.enabled);
  $('wakeBtn').classList.toggle('active',!!state.wakeLock);
  $('fullscreenBtn').classList.toggle(
    'active',
    document.body.classList.contains('fullscreen')
  );

  const gpsLabel=$('gpsBtn').querySelector('span');
  const voiceLabel=$('voiceBtn').querySelector('span');
  const fullLabel=$('fullscreenBtn').querySelector('span');

  if(gpsLabel)gpsLabel.textContent=gps?.active?'GPS on':'Start';
  if(voiceLabel)voiceLabel.textContent=voice.enabled?'Voice on':'Voice';
  if(fullLabel)fullLabel.textContent=
    document.body.classList.contains('fullscreen')?'Exit':'Fullscreen';
}
async function load(){state.id=routeId();if(!state.id)throw new Error('Route ID is missing');mapCtl.init();gps=new GpsController(onGps,onGpsError);const r=await fetch(`/driver-v2/data/${encodeURIComponent(state.id)}`,{cache:'no-store',credentials:'same-origin'});const p=await r.json();if(!r.ok)throw new Error(p.error||'Could not load route');drawRoute(p.route||{},true);$('loading').classList.add('hidden');$('routeStatus').textContent='Route ready';updateButtons()}

$('gpsBtn').addEventListener('click',toggleGps);
$('centreBtn').addEventListener('click',()=>{camera.follow=true;camera.focus(state.gps,{force:true,zoom:18})});
$('rerouteBtn').addEventListener('click',reroute);
$('fullscreenBtn').addEventListener('click',toggleFullscreen);
$('wakeBtn').addEventListener('click',toggleWake);
$('voiceBtn').addEventListener('click',()=>{voice.toggle();updateButtons();toast(voice.enabled?'Voice guidance on':'Voice guidance off')});
$('reportBtn').addEventListener('click',()=>window.open(`/driver-v3/route/${encodeURIComponent(state.id)}#driverReportForm`,'_blank'));
window.addEventListener('resize',()=>setTimeout(()=>{mapCtl.refresh();if(state.mode==='live')camera.focus(state.snappedGps||state.gps,{force:true})},180));
$('zoomInBtn').addEventListener('click',()=>mapCtl.map?.zoomIn());
$('zoomOutBtn').addEventListener('click',()=>mapCtl.map?.zoomOut());
$('compassBtn').addEventListener('click',()=>{if(state.gps){camera.follow=true;camera.focus(state.snappedGps||state.gps,{force:true,zoom:18});}else{mapCtl.overview();}});

load().catch(e=>{$('loading').textContent=e.message;toast(e.message)});

