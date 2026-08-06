import { promises as fs } from 'fs';
import path from 'path';
const file=path.resolve('./server.js');
const backup=path.resolve(`./server.js.backup-before-system-health-${Date.now()}`);
let source=await fs.readFile(file,'utf8');
if(source.includes('COACH_SAFE_SYSTEM_HEALTH_STAGE12')){console.log('Stage 1.2 already installed.');process.exit(0);}
if(!source.includes("app.get('/api/health'")) throw new Error('Health route not found.');
if(!source.includes('requireAuth')) throw new Error('Authentication middleware not found.');
await fs.copyFile(file,backup);
const marker="app.get('/api/health'";
const pos=source.indexOf(marker);
const code=String.raw`
/* COACH_SAFE_SYSTEM_HEALTH_STAGE12 */
app.get('/api/platform/diagnostics', requireAuth, async (req, res) => {
  const started=Date.now();
  const companyId=String(req.user?.companyId||'');
  const findings=[];
  const apiTests=[];
  let client;
  try {
    const dbStarted=Date.now();
    client=await dbRequired().connect();
    await client.query('SELECT 1');
    const databaseMs=Date.now()-dbStarted;
    const companyResult=await client.query('SELECT id,slug,name,"brandingName",status,plan,"onboardingComplete" FROM "Company" WHERE id=$1',[companyId]);
    const company=companyResult.rows[0]||null;
    const countSql={users:'SELECT COUNT(*)::int AS count FROM "User" WHERE "companyId"=$1',routes:'SELECT COUNT(*)::int AS count FROM "Route" WHERE "companyId"=$1',vehicles:'SELECT COUNT(*)::int AS count FROM "Vehicle" WHERE "companyId"=$1',drivers:'SELECT COUNT(*)::int AS count FROM "Driver" WHERE "companyId"=$1',reports:'SELECT COUNT(*)::int AS count FROM "UnsuitableRoadReport" WHERE "companyId"=$1',journeyEvents:'SELECT COUNT(*)::int AS count FROM "JourneyEvent" WHERE "companyId"=$1'};
    const counts={};
    for(const [name,sql] of Object.entries(countSql)){const t=Date.now();try{const result=await client.query(sql,[companyId]);counts[name]=Number(result.rows[0]?.count||0);apiTests.push({name,ok:true,ms:Date.now()-t,detail:counts[name]+' visible records'});}catch(error){counts[name]=0;apiTests.push({name,ok:false,ms:Date.now()-t,detail:error.message});}}
    let companyDistribution=[];
    const globalEnabled=String(process.env.ALLOW_PLATFORM_DIAGNOSTICS_GLOBAL||'').toLowerCase()==='true';
    if(globalEnabled && ['super_admin','admin','owner'].includes(String(req.user?.role||'').toLowerCase())){
      const distribution=await client.query('SELECT c.id,c.name,COUNT(DISTINCT u.id)::int AS users,COUNT(DISTINCT r.id)::int AS routes,COUNT(DISTINCT v.id)::int AS vehicles,COUNT(DISTINCT d.id)::int AS drivers,COUNT(DISTINCT rep.id)::int AS reports FROM "Company" c LEFT JOIN "User" u ON u."companyId"=c.id LEFT JOIN "Route" r ON r."companyId"=c.id LEFT JOIN "Vehicle" v ON v."companyId"=c.id LEFT JOIN "Driver" d ON d."companyId"=c.id LEFT JOIN "UnsuitableRoadReport" rep ON rep."companyId"=c.id GROUP BY c.id,c.name ORDER BY c.name');
      companyDistribution=distribution.rows;
    }
    const otherData=companyDistribution.filter(row=>row.id!==companyId && (Number(row.routes)||Number(row.vehicles)||Number(row.drivers)||Number(row.reports)));
    const tenantMismatch={suspected:!counts.routes && otherData.some(row=>Number(row.routes)>0),message:''};
    if(tenantMismatch.suspected){tenantMismatch.message='The signed-in company has zero routes, while another company contains route records. Existing data may be assigned to a different company ID.';findings.push({level:'warning',title:'Possible company/tenant mismatch',detail:tenantMismatch.message,suggestion:'Do not move data yet. Review the company distribution and reconnect the correct admin/company after taking a database backup.'});}
    if(!company) findings.push({level:'error',title:'Company record not found',detail:'The authenticated token contains a company ID that does not exist.',suggestion:'Sign out and verify the user/company relationship.'});
    if(!counts.routes) findings.push({level:'info',title:'No routes visible to this company',detail:'The current company-scoped route query returned zero records.',suggestion:'Create a route or enable protected global diagnostics to check for a tenant mismatch.'});
    if(!counts.vehicles) findings.push({level:'info',title:'No vehicles visible',detail:'The current company has no vehicle records.',suggestion:'Confirm the Fleet workspace or company assignment.'});
    if(!counts.drivers) findings.push({level:'info',title:'No drivers visible',detail:'The current company has no driver records.',suggestion:'Confirm the Drivers workspace or company assignment.'});
    const memory=process.memoryUsage();
    res.json({generatedAt:new Date().toISOString(),user:{id:req.user?.id,name:req.user?.name,email:req.user?.email,role:req.user?.role,companyId},company,counts,tenantMismatch,checks:{database:{ok:true},api:{ok:apiTests.every(t=>t.ok),warning:apiTests.some(t=>!t.ok)},company:{ok:!!company},operationalData:{ok:true,warning:!counts.routes&&!counts.vehicles&&!counts.drivers}},apiTests,performance:{databaseMs,totalMs:Date.now()-started},infrastructure:{database:'Connected',routingProvider:HAS_LIVE_TOMTOM_KEY?'TomTom connected':'Routing provider status unavailable',nodeVersion:process.version,environment:process.env.NODE_ENV||'development',uptime:Math.round(process.uptime())+' seconds',memoryUsed:Math.round(memory.rss/1024/1024)+' MB'},companyDistribution,findings});
  } catch(error){res.status(500).json({error:error.message||'Diagnostics failed.'});}
  finally{client?.release?.();}
});
/* COACH_SAFE_SYSTEM_HEALTH_STAGE12_END */

`;
source=source.slice(0,pos)+code+source.slice(pos);
await fs.writeFile(file,source,'utf8');
console.log('Stage 1.2 diagnostics installed. Backup:',backup);
