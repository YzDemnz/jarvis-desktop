import sys, wave
from pathlib import Path
from piper import PiperVoice
model,config,source,output=sys.argv[1:]
text=Path(source).read_text(encoding='utf8')
if not text.strip() or len(text)>2500: raise ValueError('AUDIO_INPUT_INVALID')
voice=PiperVoice.load(model,config_path=config,use_cuda=False)
with wave.open(output,'wb') as stream: voice.synthesize_wav(text,stream)
print('NEURAL_AUDIO_CREATED')
