import {startModelControlLoop} from '../../mcp-server/ml/model_manager.js';
startModelControlLoop(50);process.send?.({ready:true});
const keepAlive=setInterval(()=>{},1000);
process.on('disconnect',()=>{clearInterval(keepAlive);process.exit(0);});
