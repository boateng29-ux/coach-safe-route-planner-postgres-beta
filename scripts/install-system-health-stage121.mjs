import { promises as fs } from 'fs';
import path from 'path';

const serverPath = path.resolve('./server.js');
const backupPath = path.resolve(`./server.js.backup-before-system-health-1.2.1-${Date.now()}`);
let source = await fs.readFile(serverPath, 'utf8');

if (source.includes('COACH_SAFE_SYSTEM_HEALTH_STAGE121')) {
  console.log('Stage 1.2.1 already installed.');
  process.exit(0);
}
if (!source.includes('requireAuth')) throw new Error('Authentication middleware not found.');

await fs.copyFile(serverPath, backupPath);

const start = source.indexOf('/* COACH_SAFE_SYSTEM_HEALTH_STAGE12 */');
const endMarker = '/* COACH_SAFE_SYSTEM_HEALTH_STAGE12_END */';
const end = source.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error('Stage 1.2 diagnostics block not found.');
const endInclusive = end + endMarker.length;

const code = String.raw`
/* COACH_SAFE_SYSTEM_HEALTH_STAGE121 */
function diagnosticError(error, stage, operation, suggestion='') {
  return {
    stage,
    code:String(error?.code||error?.statusCode||''),
    message:String(error?.message||'Unknown diagnostic error.'),
    operation,
    suggestion
  };
}

async function diagnosticsTableExists(client, tableName) {
  const result=await client.query(
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1) AS present",
    [tableName]
  );
  return Boolean(result.rows[0]?.present);
}

async function diagnosticsColumns(client, tableName) {
  const result=await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
    [tableName]
  );
  return new Set(result.rows.map(row=>row.column_name));
}

async function diagnosticsCount(client, tableName, companyId, tests) {
  const started=Date.now();
  try {
    if (!(await diagnosticsTableExists(client,tableName))) {
      tests.push({name:tableName,ok:false,warning:true,ms:Date.now()-started,detail:'Optional table is not present'});
      return 0;
    }
    const columns=await diagnosticsColumns(client,tableName);
    if (!columns.has('companyId')) {
      tests.push({name:tableName,ok:false,warning:true,ms:Date.now()-started,detail:'Table has no companyId column'});
      return 0;
    }
    const result=await client.query(
      'SELECT COUNT(*)::int AS count FROM "'+tableName+'" WHERE "companyId"=$1',
      [companyId]
    );
    const count=Number(result.rows[0]?.count||0);
    tests.push({name:tableName,ok:true,ms:Date.now()-started,detail:count+' visible records'});
    return count;
  } catch(error) {
    tests.push({name:tableName,ok:false,ms:Date.now()-started,detail:error.message,code:error.code||''});
    return 0;
  }
}

app.get('/api/platform/diagnostics', requireAuth, async (req,res)=>{
  const started=Date.now();
  const companyId=String(req.user?.companyId||'');
  const findings=[];
  const apiTests=[];
  const errors=[];
  const counts={users:0,routes:0,vehicles:0,drivers:0,reports:0,journeyEvents:0};
  let client=null;
  let company=null;
  let databaseMs=null;
  let databaseConnected=false;
  let companyDistribution=[];

  try {
    const dbStarted=Date.now();
    try {
      client=await dbRequired().connect();
      await client.query('SELECT 1 AS healthy');
      databaseConnected=true;
      databaseMs=Date.now()-dbStarted;
    } catch(error) {
      errors.push(diagnosticError(error,'Database connection','dbRequired().connect(); SELECT 1','Verify DATABASE_URL and Render database connectivity.'));
    }

    if (!client || !databaseConnected) {
      return res.status(200).json({
        generatedAt:new Date().toISOString(),
        diagnosticVersion:'1.2.1',
        user:{id:req.user?.id,name:req.user?.name,email:req.user?.email,role:req.user?.role,companyId},
        company:null,counts,
        checks:{
          database:{ok:false,detail:errors[0]?.message||'Connection failed'},
          api:{ok:false,detail:'Database checks skipped'},
          company:{ok:false,detail:'Company lookup skipped'},
          operationalData:{ok:false,warning:true,detail:'Database unavailable'}
        },
        apiTests,performance:{databaseMs,totalMs:Date.now()-started},
        infrastructure:{database:'Connection failed',routingProvider:HAS_LIVE_TOMTOM_KEY?'TomTom connected':'Unavailable',nodeVersion:process.version,environment:process.env.NODE_ENV||'development',uptime:Math.round(process.uptime())+' seconds',memoryUsed:Math.round(process.memoryUsage().rss/1024/1024)+' MB'},
        endpointError:errors[0],
        findings:[{level:'error',title:'Database connection failed',detail:errors[0]?.message||'Connection failed',suggestion:'Check DATABASE_URL. Do not alter operational records.'}]
      });
    }

    try {
      if (!(await diagnosticsTableExists(client,'Company'))) throw Object.assign(new Error('Company table does not exist.'),{code:'TABLE_MISSING'});
      const columns=await diagnosticsColumns(client,'Company');
      const wanted=['id','slug','name','legalName','brandingName','logoUrl','countryCode','timezone','status','plan','onboardingComplete'].filter(c=>columns.has(c));
      const select=wanted.length?wanted.map(c=>'"'+c+'"').join(','):'*';
      const result=await client.query('SELECT '+select+' FROM "Company" WHERE id=$1 LIMIT 1',[companyId]);
      company=result.rows[0]||null;
      if(company){
        company.slug=company.slug||'';
        company.name=company.name||company.brandingName||'Unnamed company';
        company.status=String(company.status||'legacy').toLowerCase();
        company.plan=String(company.plan||'legacy').toLowerCase();
      }
    } catch(error) {
      errors.push(diagnosticError(error,'Company lookup','SELECT available Company columns WHERE id=$1','Compare User.companyId with Company.id before changing records.'));
    }

    const tables={users:'User',routes:'Route',vehicles:'Vehicle',drivers:'Driver',reports:'UnsuitableRoadReport',journeyEvents:'JourneyEvent'};
    for(const [key,table] of Object.entries(tables)) counts[key]=await diagnosticsCount(client,table,companyId,apiTests);

    const globalEnabled=String(process.env.ALLOW_PLATFORM_DIAGNOSTICS_GLOBAL||'').toLowerCase()==='true';
    const trusted=['super_admin','admin','owner'].includes(String(req.user?.role||'').toLowerCase());
    if(globalEnabled&&trusted&&await diagnosticsTableExists(client,'Company')){
      try {
        const companies=await client.query('SELECT id,name FROM "Company" ORDER BY name');
        for(const c of companies.rows){
          const row={id:c.id,name:c.name||'Unnamed company',users:0,routes:0,vehicles:0,drivers:0,reports:0};
          for(const [key,table] of Object.entries({users:'User',routes:'Route',vehicles:'Vehicle',drivers:'Driver',reports:'UnsuitableRoadReport'})){
            if(!(await diagnosticsTableExists(client,table)))continue;
            const cols=await diagnosticsColumns(client,table);
            if(!cols.has('companyId'))continue;
            const r=await client.query('SELECT COUNT(*)::int AS count FROM "'+table+'" WHERE "companyId"=$1',[c.id]);
            row[key]=Number(r.rows[0]?.count||0);
          }
          companyDistribution.push(row);
        }
      } catch(error) {
        errors.push(diagnosticError(error,'Company distribution','Read-only counts grouped by company','This support-only check is optional.'));
      }
    }

    const otherData=companyDistribution.filter(row=>row.id!==companyId&&(Number(row.routes)||Number(row.vehicles)||Number(row.drivers)||Number(row.reports)));
    const tenantMismatch={suspected:!counts.routes&&otherData.some(row=>Number(row.routes)>0),message:''};
    if(tenantMismatch.suspected){
      tenantMismatch.message='The signed-in company has zero routes while another company contains routes.';
      findings.push({level:'warning',title:'Possible company mismatch',detail:tenantMismatch.message,suggestion:'Back up the database and verify Company IDs before reconnecting records.'});
    }
    if(!company) findings.push({level:'error',title:'Company record unresolved',detail:'The token contains companyId '+companyId+', but no Company row matched.',suggestion:'Check User.companyId against Company.id. Existing operational records remain present.'});
    if(counts.routes) findings.push({level:'info',title:'Route data is present',detail:counts.routes+' routes are visible to the authenticated company ID.',suggestion:'If Saved Routes is empty, inspect the frontend status filter or route API rendering.'});

    const requiredFailure=apiTests.some(t=>!t.ok&&!t.warning);
    const memory=process.memoryUsage();
    const primaryError=errors.find(e=>e.stage==='Company lookup'||e.stage==='Database connection')||errors[0]||null;

    return res.status(200).json({
      generatedAt:new Date().toISOString(),
      diagnosticVersion:'1.2.1',
      user:{id:req.user?.id,name:req.user?.name,email:req.user?.email,role:req.user?.role,companyId},
      company,counts,tenantMismatch,
      checks:{
        database:{ok:databaseConnected,detail:databaseConnected?databaseMs+' ms':primaryError?.message||'Failed'},
        api:{ok:!requiredFailure,warning:apiTests.some(t=>!t.ok),detail:apiTests.filter(t=>t.ok).length+'/'+apiTests.length+' dataset checks passed'},
        company:{ok:!!company,warning:!company,detail:company?company.name:'No Company row matched user companyId'},
        operationalData:{ok:!!(counts.routes||counts.vehicles||counts.drivers||counts.reports),warning:!counts.routes,detail:counts.routes+' routes · '+counts.vehicles+' vehicles · '+counts.drivers+' drivers'}
      },
      apiTests,
      performance:{databaseMs,totalMs:Date.now()-started},
      infrastructure:{database:databaseConnected?'Connected':'Failed',routingProvider:HAS_LIVE_TOMTOM_KEY?'TomTom connected':'Unavailable',nodeVersion:process.version,environment:process.env.NODE_ENV||'development',uptime:Math.round(process.uptime())+' seconds',memoryUsed:Math.round(memory.rss/1024/1024)+' MB'},
      companyDistribution,
      endpointError:primaryError,
      errors,
      findings
    });
  } catch(error) {
    const endpointError=diagnosticError(error,'Unhandled diagnostics error','/api/platform/diagnostics','Inspect Render logs. No write query was attempted.');
    return res.status(200).json({
      generatedAt:new Date().toISOString(),diagnosticVersion:'1.2.1',
      user:{id:req.user?.id,name:req.user?.name,email:req.user?.email,role:req.user?.role,companyId},
      company,counts,
      checks:{
        database:{ok:databaseConnected,detail:databaseConnected?'Connected before endpoint error':endpointError.message},
        api:{ok:false,detail:endpointError.message},
        company:{ok:!!company,detail:company?.name||'Unresolved'},
        operationalData:{ok:!!counts.routes,warning:true,detail:counts.routes+' routes counted'}
      },
      apiTests,performance:{databaseMs,totalMs:Date.now()-started},
      infrastructure:{database:databaseConnected?'Connected':'Unknown',routingProvider:HAS_LIVE_TOMTOM_KEY?'TomTom connected':'Unknown',nodeVersion:process.version,environment:process.env.NODE_ENV||'development',uptime:Math.round(process.uptime())+' seconds',memoryUsed:Math.round(process.memoryUsage().rss/1024/1024)+' MB'},
      endpointError,errors:[endpointError],
      findings:[{level:'error',title:'Diagnostics endpoint error',detail:endpointError.message,suggestion:endpointError.suggestion}]
    });
  } finally { client?.release?.(); }
});
/* COACH_SAFE_SYSTEM_HEALTH_STAGE121_END */
`;

source=source.slice(0,start)+code+source.slice(endInclusive);
await fs.writeFile(serverPath,source,'utf8');
console.log('Stage 1.2.1 installed. Backup:',backupPath);
