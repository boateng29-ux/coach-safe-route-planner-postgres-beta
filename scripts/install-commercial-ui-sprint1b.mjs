import { promises as fs } from 'fs';
import path from 'path';
const file=path.resolve('./server.js');
const backup=path.resolve(`./server.js.backup-before-commercial-ui-${Date.now()}`);
let source=await fs.readFile(file,'utf8');
if(source.includes('COACH_SAFE_COMMERCIAL_UI_SPRINT1B')){console.log('Already installed.');process.exit(0);}
if(!source.includes('COACH_SAFE_PLATFORM_FOUNDATION_SPRINT1A'))throw new Error('Install Sprint 1A first.');
await fs.copyFile(file,backup);
source += `\n\n/* COACH_SAFE_COMMERCIAL_UI_SPRINT1B */\n`;
await fs.writeFile(file,source,'utf8');
console.log('Sprint 1B marker installed. Backup:',backup);
