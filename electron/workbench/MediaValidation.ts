/** Piper emits PCM16 WAV. Decode the actual samples before admitting an artifact. */
export function pcmWavEvidence(data:Buffer){
  if(data.length<44||data.toString('ascii',0,4)!=='RIFF'||data.toString('ascii',8,12)!=='WAVE')throw Error('AUDIO_WAV_INVALID');
  let sampleRate=0,channels=0,bits=0,format=0,pcm:Buffer|null=null;
  for(let at=12;at+8<=data.length;){const name=data.toString('ascii',at,at+4),size=data.readUInt32LE(at+4),start=at+8,end=start+size;if(end>data.length)throw Error('AUDIO_WAV_TRUNCATED');
    if(name==='fmt '){if(size<16)throw Error('AUDIO_FMT_INVALID');format=data.readUInt16LE(start);channels=data.readUInt16LE(start+2);sampleRate=data.readUInt32LE(start+4);bits=data.readUInt16LE(start+14);}
    if(name==='data')pcm=data.subarray(start,end);at=end+(size%2);
  }
  if(format!==1||bits!==16||channels<1||channels>2||sampleRate<8000||sampleRate>96000||!pcm||pcm.length<1000||pcm.length%(channels*2))throw Error('AUDIO_PCM_UNSUPPORTED');
  let peak=0,sum=0;const samples=pcm.length/2;for(let at=0;at<pcm.length;at+=2){const value=pcm.readInt16LE(at);peak=Math.max(peak,Math.abs(value));sum+=value*value;}const rms=Math.sqrt(sum/samples);
  if(peak<16||rms<2)throw Error('AUDIO_SILENT');return {sampleRate,channels,samples,peak,rms,duration:samples/channels/sampleRate};
}
