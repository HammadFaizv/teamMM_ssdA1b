import {spawn} from 'node:child_process';
const demo=process.argv.includes('--demo');
const children=[spawn(process.execPath,demo?['--env-file-if-exists=.env','demo/server.js']:['--env-file-if-exists=.env','src/server.js'],{cwd:new URL('../backend/',import.meta.url),stdio:'inherit'}),spawn(process.execPath,['--env-file-if-exists=.env','server.js'],{cwd:new URL('../frontend/',import.meta.url),stdio:'inherit'})];
let stopping=false;function stop(){if(stopping)return;stopping=true;children.forEach(child=>child.kill('SIGTERM'));}
for(const child of children){child.on('error',error=>{console.error(error.message);process.exitCode=1;stop();});child.on('exit',code=>{if(!stopping){process.exitCode=code||0;stop();}});}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
