import {build} from 'esbuild';
await build({entryPoints:['electron/bridge/stdio.ts'],outfile:'dist-bridge/jarvis-mcp.cjs',bundle:true,platform:'node',target:'node24',format:'cjs',sourcemap:false});
console.log('MCP_STDIO_BRIDGE_BUILT');
