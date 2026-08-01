const state={
  id:'',
  record:null,
  route:null,
  map:null,
  tileLayer:null,
  routeLine:null,
  gpsMarker:null,
  accuracyCircle:null,
  watchId:null,
  gps:null,
  mode:'overview',
  follow:true,
  voice:false,
  wakeLock:null,
  instructions:[],
  points:[],
  measures:[],
  totalM:0,
  currentInstruction:0,
  spoken:new Set(),
  lastCameraAt:0,
  lastHeading:null
};

const el=(id)=>document.getElementById(id);
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const rad=(d)=>d*Math.PI/180;

function toast(message){
  const node=el('toast');
  node.textContent=message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer=setTimeout(()=>node.classList.remove('show'),2400);
}

function routeId(){
  const match=location.pathname.match(/\/(?:driver-v2\/route|drive-v2)\/([^/?#]+)/i);
  return match?decodeURIComponent(match[1]):'';
}

function haversine(a,b){
  const R=6371000;
  const dLat=rad(b[0]-a[0]),dLon=rad(b[1]-a[1]);
  const p1=rad(a[0]),p2=rad(b[0]);
  const h=Math.sin(dLat/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dLon/2)**2;
  return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}

function bearing(a,b){
  const p1=rad(a[0]),p2=rad(b[0]),dl=rad(b[1]-a[1]);
  const y=Math.sin(dl)*Math.cos(p2);
  const x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);
  return (Math.atan2(y,x)*180/Math.PI+360)%360;
}

function smoothAngle(previous,next,weight=.25){
  if(!Number.isFinite(previous))return next;
  let delta=((next-previous+540)%360)-180;
  return (previous+delta*weight+360)%360;
}

function buildMeasures(points){
  const out=[0];
  for(let i=1;i<points.length;i++)out[i]=out[i-1]+haversine(points[i-1],points[i]);
  return out;
}

function project(point,origin){
  const R=6371000;
  return {
    x:rad(point[1]-origin[1])*Math.cos(rad(origin[0]))*R,
    y:rad(point[0]-origin[0])*R
  };
}

function nearestProgress(point){
  if(state.points.length<2)return {progress:0,distance:Infinity,index:0};
  let best={progress:0,distance:Infinity,index:0};
  for(let i=0;i<state.points.length-1;i++){
    const A=project(state.points[i],point);
    const B=project(state.points[i+1],point);
    const dx=B.x-A.x,dy=B.y-A.y;
    const len=dx*dx+dy*dy;
    const t=len?clamp(((-A.x)*dx+(-A.y)*dy)/len,0,1):0;
    const x=A.x+t*dx,y=A.y+t*dy;
    const distance=Math.hypot(x,y);
    if(distance<best.distance){
      best={distance,index:i,progress:(state.measures[i]||0)+t*haversine(state.points[i],state.points[i+1])};
    }
  }
  return best;
}

function metresText(m){
  if(!Number.isFinite(m))return '—';
  if(m<950)return `${Math.max(0,Math.round(m/10)*10)}m`;
  return `${(m/1609.344).toFixed(1)} miles`;
}

function durationText(seconds){
  const mins=Math.max(0,Math.round(seconds/60));
  const h=Math.floor(mins/60),m=mins%60;
  return h?`${h}h ${m}m`:`${m}m`;
}

function etaText(seconds){
  return new Date(Date.now()+Math.max(0,seconds)*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
}

function manoeuvreIcon(instruction){
  const text=`${instruction?.maneuver||''} ${instruction?.instruction||''}`.toLowerCase();
  if(text.includes('roundabout'))return '↻';
  if(text.includes('u-turn'))return '↶';
  if(text.includes('left'))return '←';
  if(text.includes('right'))return '→';
  if(text.includes('exit'))return '↗';
  if(text.includes('arriv'))return '●';
  return '↑';
}

function setMode(mode){
  state.mode=mode;
  el('app').dataset.mode=mode;
  if(mode==='live'){
    state.startMarker&&state.map.removeLayer(state.startMarker);
    state.endMarker&&state.map.removeLayer(state.endMarker);
  }
}

function cameraCentre(point,zoom){
  const size=state.map.getSize();
  const projected=state.map.project(point,zoom);
  const centre=L.point(projected.x,projected.y-(size.y*.20));
  return state.map.unproject(centre,zoom);
}

function focusGps({force=false,zoom}={}){
  if(!state.gps||!state.follow)return;
  const now=Date.now();
  if(!force&&now-state.lastCameraAt<800)return;
  state.lastCameraAt=now;
  setMode('live');
  const z=zoom||state.map.getZoom()||17.5;
  state.map.setView(cameraCentre([state.gps.lat,state.gps.lng],z),z,{animate:!force});
}

function drawRoute(route,overview=true){
  state.route=route;
  state.points=(route.points||[]).map(p=>[Number(p[0]),Number(p[1])]).filter(p=>p.every(Number.isFinite));
  state.instructions=(route.instructions||[]).slice().sort((a,b)=>Number(a.distanceM||0)-Number(b.distanceM||0));
  state.measures=buildMeasures(state.points);
  state.totalM=Number(route.summary?.lengthInMeters||state.measures.at(-1)||0);

  if(state.routeLine)state.map.removeLayer(state.routeLine);
  if(state.startMarker)state.map.removeLayer(state.startMarker);
  if(state.endMarker)state.map.removeLayer(state.endMarker);

  state.routeLine=L.polyline(state.points,{weight:7,opacity:.94,color:'#2478ff'}).addTo(state.map);
  if(state.points.length){
    state.startMarker=L.circleMarker(state.points[0],{radius:6,color:'#fff',weight:2,fillColor:'#36d27e',fillOpacity:1}).addTo(state.map);
    state.endMarker=L.circleMarker(state.points.at(-1),{radius:7,color:'#fff',weight:2,fillColor:'#ff665f',fillOpacity:1}).addTo(state.map);
  }

  if(overview&&state.routeLine){
    setMode('overview');
    state.map.fitBounds(state.routeLine.getBounds(),{padding:[70,40],maxZoom:15});
  }else if(state.gps){
    setMode('live');
    focusGps({force:true,zoom:18});
  }

  updateGuidance(0,Infinity);
}

function updateGuidance(progress,offRoute){
  if(!state.instructions.length)return;
  let idx=state.instructions.findIndex(i=>Number(i.distanceM||0)>=progress+5);
  if(idx<0)idx=state.instructions.length-1;
  state.currentInstruction=idx;
  const ins=state.instructions[idx];
  const nextM=Math.max(0,Number(ins.distanceM||0)-progress);
  const remaining=Math.max(0,state.totalM-progress);
  const totalS=Number(state.route.summary?.travelTimeInSeconds||0);
  const remainingS=state.totalM?totalS*(remaining/state.totalM):0;

  el('turnIcon').textContent=manoeuvreIcon(ins);
  el('instruction').textContent=ins.instruction||'Continue on route';
  el('turnDistance').textContent=nextM<=35?'Now':`Next in ${metresText(nextM)}`;
  el('laneText').textContent=ins.laneGuidance?.text||'Follow road signs. Lane guidance not returned.';
  el('eta').textContent=etaText(remainingS);
  el('timeLeft').textContent=durationText(remainingS);
  el('distanceLeft').textContent=metresText(remaining);
  el('roadStatus').textContent=ins.street||ins.roadNumbers?.join(' · ')||'Route';
  const mph=ins.speedLimit?.maxSpeedLimitMph;
  el('speedLimit').textContent=mph?`${mph} mph`:'Limit —';

  const status=el('routeStatus');
  status.className='status '+(offRoute>120?'bad':'good');
  status.textContent=offRoute>120?'Off route':'On route';

  if(state.voice)announce(ins,nextM,idx);
  if(nextM<180&&state.mode==='live')focusGps({zoom:nextM<60?19:18.5});
}

function announce(ins,distance,index){
  let bucket='';
  if(distance<35)bucket='now';
  else if(distance<110)bucket='100';
  else if(distance<330)bucket='300';
  else if(distance<850)bucket='800';
  if(!bucket)return;
  const key=`${index}:${bucket}`;
  if(state.spoken.has(key))return;
  state.spoken.add(key);
  const lead=bucket==='now'?'':`In ${bucket} metres, `;
  speak(`${lead}${ins.instruction||'continue on route'}`);
}

function speak(text){
  if(!('speechSynthesis'in window))return;
  speechSynthesis.cancel();
  const utter=new SpeechSynthesisUtterance(text);
  utter.lang='en-GB';utter.rate=.94;utter.pitch=1;
  speechSynthesis.speak(utter);
}

function onGps(position){
  const {latitude:lat,longitude:lng,accuracy,speed,heading}=position.coords;
  let calculatedHeading=Number(heading);
  if(state.gps&&haversine([state.gps.lat,state.gps.lng],[lat,lng])>5){
    calculatedHeading=bearing([state.gps.lat,state.gps.lng],[lat,lng]);
  }
  calculatedHeading=smoothAngle(state.lastHeading,calculatedHeading,.3);
  if(Number.isFinite(calculatedHeading))state.lastHeading=calculatedHeading;

  state.gps={lat,lng,accuracy:Number(accuracy||0),speed:Number(speed),heading:calculatedHeading};

  if(!state.gpsMarker){
    state.gpsMarker=L.circleMarker([lat,lng],{radius:7,color:'#fff',weight:3,fillColor:'#2979ff',fillOpacity:1}).addTo(state.map);
    state.accuracyCircle=L.circle([lat,lng],{radius:Math.min(18,accuracy||8),weight:1,color:'#2979ff',opacity:.24,fillOpacity:.04,interactive:false}).addTo(state.map);
  }else{
    state.gpsMarker.setLatLng([lat,lng]);
    state.accuracyCircle.setLatLng([lat,lng]).setRadius(Math.min(18,accuracy||8));
  }

  if(Number.isFinite(calculatedHeading))el('vehicleArrow').style.setProperty('--heading',`${calculatedHeading}deg`);
  el('gpsStatus').textContent=`GPS ${Math.round(accuracy||0)}m`;
  el('gpsStatus').className='status good';
  el('speed').textContent=Number.isFinite(speed)&&speed>=0?`${Math.round(speed*2.23694)} mph`:'0 mph';

  const nearest=nearestProgress([lat,lng]);
  updateGuidance(nearest.progress,nearest.distance);
  focusGps({force:state.mode!=='live'});
}

function gpsError(error){
  toast(error.message||'GPS permission failed.');
  el('gpsStatus').textContent='GPS error';
  el('gpsStatus').className='status bad';
  state.watchId=null;
  updateButtons();
}

function toggleGps(){
  if(state.watchId!==null){
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId=null;
    el('gpsStatus').textContent='GPS off';
    setMode('overview');
    if(state.routeLine)state.map.fitBounds(state.routeLine.getBounds(),{padding:[70,40],maxZoom:15});
    updateButtons();
    return;
  }
  if(!navigator.geolocation){toast('GPS is not supported.');return}
  state.follow=true;
  state.watchId=navigator.geolocation.watchPosition(onGps,gpsError,{enableHighAccuracy:true,maximumAge:1000,timeout:15000});
  toast('Starting live GPS…');
  updateButtons();
}

async function reroute(){
  if(!state.gps){toast('Start GPS first.');return}
  const button=el('rerouteBtn');button.disabled=true;
  try{
    const response=await fetch(`/driver/route/${encodeURIComponent(state.id)}/reroute`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({lat:state.gps.lat,lng:state.gps.lng,accuracyM:state.gps.accuracy})
    });
    const payload=await response.json();
    if(!response.ok)throw new Error(payload.error||'Reroute failed.');
    state.spoken.clear();
    drawRoute(payload.route,false);
    toast('Route recalculated from your GPS position.');
  }catch(error){toast(error.message)}
  finally{button.disabled=false}
}

async function toggleWake(){
  if(state.wakeLock){
    await state.wakeLock.release().catch(()=>{});
    state.wakeLock=null;toast('Screen wake lock off.');
  }else if('wakeLock'in navigator){
    state.wakeLock=await navigator.wakeLock.request('screen').catch(()=>null);
    toast(state.wakeLock?'Screen will stay on.':'Wake lock unavailable.');
  }else toast('Wake lock is not supported.');
  updateButtons();
}

function toggleFullscreen(){
  document.body.classList.toggle('fullscreen');
  setTimeout(()=>{
    state.map.invalidateSize(true);
    if(state.mode==='live')focusGps({force:true});
    else if(state.routeLine)state.map.fitBounds(state.routeLine.getBounds(),{padding:[70,40],maxZoom:15});
  },180);
  updateButtons();
}

function updateButtons(){
  el('gpsBtn').textContent=state.watchId===null?'📍':'📡';
  el('gpsBtn').classList.toggle('active',state.watchId!==null);
  el('voiceBtn').textContent=state.voice?'🔊':'🔇';
  el('voiceBtn').classList.toggle('active',state.voice);
  el('wakeBtn').classList.toggle('active',!!state.wakeLock);
  el('fullscreenBtn').textContent=document.body.classList.contains('fullscreen')?'↙':'⛶';
}

async function load(){
  state.id=routeId();
  if(!state.id)throw new Error('Route ID is missing.');
  state.map=L.map('map',{zoomControl:true,attributionControl:true,preferCanvas:true});
  state.tileLayer=L.tileLayer('/driver-v2/tiles/{z}/{x}/{y}.png',{
    maxZoom:20,
    minZoom:2,
    attribution:'© HERE',
    updateWhenIdle:false,
    updateWhenZooming:false,
    keepBuffer:4,
    noWrap:false
  });

  state.tileLayer.on('tileerror',(event)=>{
    console.warn('HERE map tile failed',event?.tile?.src||event);
    el('routeStatus').textContent='Map loading issue';
    el('routeStatus').className='status warn';
  });

  state.tileLayer.on('load',()=>{
    if(el('routeStatus').textContent==='Map loading issue'){
      el('routeStatus').textContent='Route ready';
      el('routeStatus').className='status good';
    }
  });

  state.tileLayer.addTo(state.map);

  const response=await fetch(`/api/driver-v2/route/${encodeURIComponent(state.id)}`,{cache:'no-store'});
  const payload=await response.json();
  if(!response.ok)throw new Error(payload.error||'Could not load route.');
  state.record=payload;
  drawRoute(payload.route||{},true);
  el('loading').classList.add('hidden');
  updateButtons();
}

el('gpsBtn').addEventListener('click',toggleGps);
el('centreBtn').addEventListener('click',()=>{state.follow=true;focusGps({force:true,zoom:18})});
el('rerouteBtn').addEventListener('click',reroute);
el('fullscreenBtn').addEventListener('click',toggleFullscreen);
el('wakeBtn').addEventListener('click',toggleWake);
el('voiceBtn').addEventListener('click',()=>{state.voice=!state.voice;updateButtons();toast(state.voice?'Voice guidance on.':'Voice guidance off.')});
el('reportBtn').addEventListener('click',()=>window.open(`/driver/route/${encodeURIComponent(state.id)}#driverReportForm`,'_blank'));

window.addEventListener('resize',()=>setTimeout(()=>{state.map?.invalidateSize(true);if(state.mode==='live')focusGps({force:true})},160));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.wakeLock===null&&el('wakeBtn').classList.contains('active'))toggleWake()});

load().catch(error=>{
  el('loading').textContent=error.message;
  toast(error.message);
});
