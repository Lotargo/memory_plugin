import { projectRequest } from '../services/project_service.js';
export async function handleProjectCommand(args) {
  const usage = 'memory-cli projects list|inspect|preview|apply [--operation link|unlink|relink|migrate] [--dir <absolute path>] [--source <key>] [--target <key>] [--remote <url>] [--token <preview>] [--confirm]';
  const action = args[0];
  if (!['list','inspect','preview','apply'].includes(action)) throw new Error(usage);
  const input = { action }, flags = { '--operation':'operation', '--dir':'directory', '--source':'sourceKey', '--target':'targetKey', '--remote':'remote', '--token':'previewToken' };
  for (let i=1;i<args.length;i++) {
    if(args[i]==='--confirm') { if(input.confirm) throw new Error(usage); input.confirm=true; }
    else if(flags[args[i]] && args[i+1] && !args[i+1].startsWith('--')) { const key=flags[args[i]]; if(key in input) throw new Error(usage); input[key]=args[++i]; }
    else throw new Error(usage);
  }
  console.log(JSON.stringify(await projectRequest(input),null,2));
}
