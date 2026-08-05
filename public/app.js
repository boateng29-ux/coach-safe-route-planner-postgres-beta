const $ = (id) => document.getElementById(id);
const state = { token: localStorage.getItem('coachSafeToken') || '', user:null, routes:[], vehicles:[], drivers:[], reports:[], incidents:[], health:null, calculatedRoute:null, maps:{} };

function toast(message){ const node=$('toast'); node.textContent=message; node.classList.add('show'); clearTimeout(toast.t); toast.t=setTimeout(()=>node.classList.remove('show'),2600); }
function escapeHtml(value=''){ return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;"); }
function authHeaders(extra={}){ return { ...extra, ...(state.token?{Authorization:`Bearer ${state.token}`}:{}) }; }
async function api(path, options={}){ const response=await fetch(path,{...options,headers:authHeaders(options.headers||{})}); const type=response.headers.get('content-type')||''; const body=type.includes('json')?await response.json():await response.text(); if(!response.ok){ if(response.status===401) logout(false); throw new Error(body?.error||body||`Request failed (${response.status})`); } return body; }
function formatDate(value){ if(!value)return '—'; return new Date(value).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}); }
function miles(route){ return route?.route?.summary?.lengthInMeters ? (route.route.summary.lengthInMeters/1609.344).toFixed(1)+' mi' : '—'; }
function duration(route){ const m=Math.round((route?.route?.summary?.travelTimeInSeconds||0)/60); return m?`${Math.floor(m/60)?Math.floor(m/60)+'h ':''}${m%60}m`:'—'; }
function driverUrl(id){ return `${location.origin}/driver-v3/route/${encodeURIComponent(id)}`; }
function dayIndex(length){
  const now=new Date();
  const start=new Date(now.getFullYear(),0,0);
  const day=Math.floor((now-start)/86400000);
  return day%length;
}

function applyDailyModuleImages(){
  const sets={
    vehicles:[
      'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=1800&q=82',
      'https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=1800&q=82',
      'https://images.unsplash.com/photo-1519003722824-194d4455a60c?auto=format&fit=crop&w=1800&q=82'
    ],
    drivers:[
      'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=1800&q=82',
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=1800&q=82',
      'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=1800&q=82'
    ],
    reports:[
      'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1800&q=82',
      'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?auto=format&fit=crop&w=1800&q=82',
      'https://images.unsplash.com/photo-1494522358652-f30e61a60313?auto=format&fit=crop&w=1800&q=82'
    ]
  };
  for(const [key,urls] of Object.entries(sets)){
    const node=document.querySelector(`.module-visual-${key}`);
    if(node) node.style.backgroundImage=`url("${urls[dayIndex(urls.length)]}")`;
  }
}

async function loadNationalIncidents(){
  const container=$('nationalIncidents');
  if(!container)return;
  container.innerHTML='<p class="muted">Loading national road incident news…</p>';
  try{
    const data=await api('/api/national-road-incidents');
    state.incidents=Array.isArray(data)?data:(data.items||[]);
    container.innerHTML=state.incidents.length
      ? state.incidents.slice(0,8).map(item=>`<article class="incident-row"><span class="incident-severity ${escapeHtml(item.severity||'info')}">${escapeHtml(item.severity||'Info')}</span><div><strong>${escapeHtml(item.title||'Road incident')}</strong><span>${escapeHtml(item.description||'')} ${item.publishedAt?'· '+formatDate(item.publishedAt):''}</span></div>${item.url?`<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">Open</a>`:''}</article>`).join('')
      : '<p class="muted">No national incidents were returned. Use the National Highways link below for the official live view.</p>';
  }catch(error){
    container.innerHTML='<p class="muted">Live national incident headlines are temporarily unavailable. Use the official National Highways link below.</p>';
  }
}


async function login(email,password){ const data=await api('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})}); state.token=data.token; state.user=data.user; localStorage.setItem('coachSafeToken',state.token); document.body.classList.remove('locked'); await refreshAll(); }
function logout(show=true){ state.token='';state.user=null;localStorage.removeItem('coachSafeToken');document.body.classList.add('locked');if(show)toast('Signed out.'); }
async function restoreSession(){ if(!state.token)return; try{ const data=await api('/api/auth/me');state.user=data.user;document.body.classList.remove('locked');await refreshAll(); }catch{} }

function showView(name){ document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`${name}View`)); document.querySelectorAll('#sideNav [data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name)); const titles={dashboard:['Smart routes. Safe journeys.','A clear operational view of routes, fleet, drivers and road risk.'],routes:['Routes','Plan, approve and open coach-safe journeys.'],vehicles:['Vehicles','Manage vehicle profiles and coach dimensions.'],drivers:['Drivers','Maintain driver contact records.'],reports:['Road reports','Review and record unsuitable roads and safety concerns.'],settings:['Settings','Platform health and branding configuration.']}; $('pageTitle').textContent=titles[name][0];$('pageSubtitle').textContent=titles[name][1]; if(name==='routes') setTimeout(()=>state.maps.planner?.invalidateSize(),100); }

function initMaps(){ if(!state.maps.hero){ state.maps.hero=L.map('heroMap',{zoomControl:false,attributionControl:false}).setView([51.5072,-.1276],9); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(state.maps.hero); } if(!state.maps.planner){ state.maps.planner=L.map('plannerMap').setView([51.5072,-.1276],9); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(state.maps.planner); } }
function drawRoute(map,route){ if(!map||!route?.points?.length)return; if(map.__line)map.removeLayer(map.__line); map.__line=L.polyline(route.points,{weight:7,color:'#2979ff',opacity:.92}).addTo(map); map.fitBounds(map.__line.getBounds(),{padding:[30,30]}); }
function drawHeroRecent(){ const latest=state.routes[0]?.route; if(latest)drawRoute(state.maps.hero,latest); }

function renderCounts(){ $('routeCount').textContent=state.routes.length;$('vehicleCount').textContent=state.vehicles.length;$('driverCount').textContent=state.drivers.length;$('reportCount').textContent=state.reports.length;$('routeSub').textContent=state.routes.length?`${state.routes.filter(r=>r.status==='assigned').length} assigned`:'No saved routes'; }
function routeRow(route){ return `<article class="route-row"><div><strong>${escapeHtml(route.origin)} → ${escapeHtml(route.destination)}</strong><span>${formatDate(route.updatedAt||route.createdAt)}</span></div><div><span>Driver</span><strong>${escapeHtml(route.driver?.name||'Unassigned')}</strong></div><div><span>Vehicle</span><strong>${escapeHtml(route.vehicleRecord?.registration||route.vehicleRecord?.name||'Unassigned')}</strong></div><div><span>Journey</span><strong>${miles(route)} · ${duration(route)}</strong><span class="status">${escapeHtml(route.status)}</span></div><div class="route-actions"><button data-open-route="${escapeHtml(route.id)}">Open</button><button data-report-route="${escapeHtml(route.id)}">PDF</button><button data-delete-route="${escapeHtml(route.id)}">Delete</button></div></article>`; }
function renderRoutes(){ const html=state.routes.length?state.routes.map(routeRow).join(''):'<p class="muted">No saved routes yet.</p>';$('allRouteList').innerHTML=html;$('recentRouteList').innerHTML=state.routes.length?state.routes.slice(0,5).map(routeRow).join(''):'<p class="muted">No routes yet.</p>'; }
function renderVehicles(){ $('vehicleList').innerHTML=state.vehicles.length?state.vehicles.map(v=>`<article class="record-card"><strong>${escapeHtml(v.name||v.registration)}</strong><span>${escapeHtml(v.registration||'No registration')}</span><span>${escapeHtml(v.preset||v.coachType||'Coach')}</span><span>${v.heightM||'—'}m high · ${v.lengthM||'—'}m long · ${v.weightKg?Math.round(v.weightKg/1000)+'t':'—'}</span><button class="delete" data-delete-vehicle="${escapeHtml(v.id)}">Delete</button></article>`).join(''):'<p class="muted">No vehicles saved.</p>'; $('routeVehicle').innerHTML='<option value="">Select vehicle</option>'+state.vehicles.map(v=>`<option value="${escapeHtml(v.id)}">${escapeHtml(v.registration||v.name)}</option>`).join(''); }
function renderDrivers(){ $('driverList').innerHTML=state.drivers.length?state.drivers.map(d=>`<article class="record-card"><strong>${escapeHtml(d.name)}</strong><span>${escapeHtml(d.phone||'No phone')}</span><span>${escapeHtml(d.email||'No email')}</span><button class="delete" data-delete-driver="${escapeHtml(d.id)}">Delete</button></article>`).join(''):'<p class="muted">No drivers saved.</p>'; $('routeDriver').innerHTML='<option value="">Select driver</option>'+state.drivers.map(d=>`<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)}</option>`).join(''); }
function reportCard(r){ return `<article class="record-card"><strong>${escapeHtml(r.issueType)}</strong><span>${escapeHtml(r.roadName||'Location not supplied')}</span><span>${escapeHtml(r.notes||'No notes')}</span><span>${formatDate(r.createdAt)}</span><button class="delete" data-delete-report="${escapeHtml(r.id)}">Delete</button></article>`; }
function renderReports(){ $('reportList').innerHTML=state.reports.length?state.reports.map(reportCard).join(''):'<p class="muted">No road reports.</p>'; $('latestReports').innerHTML=state.reports.length?state.reports.slice(0,5).map(r=>`<div class="activity-row"><strong>${escapeHtml(r.issueType)}</strong><span>${escapeHtml(r.roadName||'Unknown location')} · ${formatDate(r.createdAt)}</span></div>`).join(''):'<p class="muted">No recent reports.</p>'; }
function renderHealth(){ const h=state.health||{};$('healthRouting').textContent=h.providerReady?'Online':'Unavailable';$('healthDatabase').textContent=h.databaseReady?'Connected':'Unavailable';$('healthTravelMode').textContent=h.travelMode||'—';$('healthCountry').textContent=h.defaultCountrySet||'—';$('systemDot').style.background=h.providerReady&&h.databaseReady?'#57d98d':'#ffb36b';$('systemText').textContent=h.providerReady&&h.databaseReady?'All systems operational':'Check configuration';$('settingsContent').innerHTML=`<div><span>Routing provider</span><strong>${h.providerReady?'Ready':'Unavailable'}</strong></div><div><span>Database</span><strong>${h.databaseReady?'Connected':'Unavailable'}</strong></div><div><span>Travel mode</span><strong>${escapeHtml(h.travelMode||'—')}</strong></div><div><span>Country set</span><strong>${escapeHtml(h.defaultCountrySet||'—')}</strong></div>`; }

async function refreshAll(){ initMaps(); applyDailyModuleImages(); const [health,routes,vehicles,drivers,reports]=await Promise.all([api('/api/health'),api('/api/routes'),api('/api/vehicles'),api('/api/drivers'),api('/api/reports')]);Object.assign(state,{health,routes,vehicles,drivers,reports});renderCounts();renderRoutes();renderVehicles();renderDrivers();renderReports();renderHealth();drawHeroRecent();loadNationalIncidents(); }

$('loginForm').addEventListener('submit',async e=>{e.preventDefault();$('loginMessage').textContent='Signing in…';try{await login($('loginEmail').value,$('loginPassword').value);$('loginMessage').textContent='';}catch(err){$('loginMessage').textContent=err.message;}});
$('logoutBtn').addEventListener('click',()=>logout());
$('refreshBtn').addEventListener('click',()=>refreshAll().then(()=>toast('Dashboard refreshed.')).catch(e=>toast(e.message)));
$('refreshIncidentsBtn').addEventListener('click',()=>loadNationalIncidents());
document.addEventListener('click',async e=>{ const view=e.target.closest('[data-view],[data-open-view]'); if(view){showView(view.dataset.view||view.dataset.openView);return;} const scroll=e.target.closest('[data-scroll-to]');if(scroll){document.getElementById(scroll.dataset.scrollTo)?.scrollIntoView({behavior:'smooth'});return;} const open=e.target.closest('[data-open-route]');if(open){window.open(driverUrl(open.dataset.openRoute),'_blank');return;} const pdf=e.target.closest('[data-report-route]');if(pdf){window.open(`/api/routes/${encodeURIComponent(pdf.dataset.reportRoute)}/report`,'_blank');return;} const deletions=[['deleteRoute','/api/routes/'],['deleteVehicle','/api/vehicles/'],['deleteDriver','/api/drivers/'],['deleteReport','/api/reports/']];for(const [key,path] of deletions){const btn=e.target.closest(`[data-${key.replace(/[A-Z]/g,m=>'-'+m.toLowerCase())}]`);if(btn){if(!confirm('Delete this record?'))return;try{await api(path+encodeURIComponent(btn.dataset[key]),{method:'DELETE'});await refreshAll();toast('Deleted.');}catch(err){toast(err.message);}return;}}});

$('routeForm').addEventListener('submit',async e=>{e.preventDefault();const selectedVehicle=state.vehicles.find(v=>v.id===$('routeVehicle').value)||{};const payload={start:$('routeStart').value,destination:$('routeDestination').value,stops:$('routeStops').value.split('\n').map(s=>s.trim()).filter(Boolean),vehicle:{preset:selectedVehicle.preset||selectedVehicle.coachType||'standard',heightM:selectedVehicle.heightM,widthM:selectedVehicle.widthM,lengthM:selectedVehicle.lengthM,weightKg:selectedVehicle.weightKg},options:{avoidFerries:$('avoidFerries').checked,avoidUnpaved:$('avoidUnpaved').checked,avoidTunnels:$('avoidTunnels').checked}};try{$('routeCalculationResult').textContent='Calculating coach-safe route…';state.calculatedRoute=await api('/api/route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});drawRoute(state.maps.planner,state.calculatedRoute);$('routeCalculationResult').innerHTML=`<strong>${(state.calculatedRoute.summary.lengthInMeters/1609.344).toFixed(1)} miles · ${Math.round(state.calculatedRoute.summary.travelTimeInSeconds/60)} minutes</strong><br>Risk: ${escapeHtml(state.calculatedRoute.risk?.level||'Review required')}`;$('saveRouteBtn').disabled=false;}catch(err){$('routeCalculationResult').textContent=err.message;}});
$('saveRouteBtn').addEventListener('click',async()=>{if(!state.calculatedRoute)return;try{await api('/api/routes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({route:state.calculatedRoute,driverId:$('routeDriver').value,vehicleDatabaseId:$('routeVehicle').value,status:$('routeStatusSelect').value,operatorNotes:$('routeNotes').value})});state.calculatedRoute=null;$('saveRouteBtn').disabled=true;await refreshAll();toast('Route saved.');}catch(err){toast(err.message);}});
$('vehicleForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/vehicles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('vehicleName').value,registration:$('vehicleRegistration').value,preset:$('vehiclePreset').value,heightM:Number($('vehicleHeight').value),widthM:Number($('vehicleWidth').value),lengthM:Number($('vehicleLength').value),weightKg:Number($('vehicleWeight').value)})});e.target.reset();await refreshAll();toast('Vehicle saved.');}catch(err){toast(err.message);}});
$('driverForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/drivers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('driverName').value,phone:$('driverPhone').value,email:$('driverEmail').value})});e.target.reset();await refreshAll();toast('Driver saved.');}catch(err){toast(err.message);}});
$('reportForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/reports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roadName:$('reportRoad').value,issueType:$('reportType').value,notes:$('reportNotes').value})});e.target.reset();await refreshAll();toast('Road report saved.');}catch(err){toast(err.message);}});

restoreSession();