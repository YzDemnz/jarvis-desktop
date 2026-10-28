import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {Document,Packer,Paragraph,TextRun,HeadingLevel} from 'docx';
import {safeContextText} from '../../src/fabric/ContinuityState';
const requestFile=process.argv[2],request=JSON.parse(fs.readFileSync(requestFile,'utf8'));
const sha=data=>createHash('sha256').update(data).digest('hex');
const MAX_BYTES=8*1024*1024,MAX_CHARS=60000;
export function docxText(data){
 let count=0,total=0;
 const parts=unzipSync(data,{filter:entry=>{count++;total+=entry.originalSize;if(count>512||entry.originalSize>4*1024*1024||total>24*1024*1024)throw Error('DOCX_EXPANSION_LIMIT');return /^word\/(document|footnotes|endnotes|header\d+|footer\d+)\.xml$/.test(entry.name);}});
 if(!parts['word/document.xml'])throw Error('DOCX_DOCUMENT_MISSING');
 const out=[];
 for(const name of Object.keys(parts).sort((a,b)=>a==='word/document.xml'?-1:b==='word/document.xml'?1:a.localeCompare(b))){
  const xml=strFromU8(parts[name]);if(/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw Error('DOCX_XML_INVALID');
  const ordered=new XMLParser({preserveOrder:true,ignoreAttributes:true,trimValues:false,parseTagValue:false,processEntities:true}).parse(xml);
  let current='';const visit=items=>{for(const item of items){for(const [tag,value]of Object.entries(item)){if(tag==='#text')current+=String(value);else if(tag==='w:tab')current+='\t';else if(tag==='w:br')current+='\n';else if(Array.isArray(value)){visit(value);if(tag==='w:p'){if(current.trim())out.push(current.trim());current='';}}}}};visit(ordered);
 }
 return out;
}
try{
 let result;
 if(request.kind==='read'){
  const file=request.source,stat=fs.statSync(file);if(!stat.isFile()||stat.size>MAX_BYTES)throw Error('DOCUMENT_SIZE_LIMIT_8MIB');
  const data=fs.readFileSync(file),ext=path.extname(file).toLowerCase(),lines=[],warnings=[];let pages;
  if(ext==='.docx')docxText(data).forEach(text=>lines.push({text}));
  else if(ext==='.pdf'){
   const pdf=await import('pdfjs-dist/legacy/build/pdf.mjs');pdf.GlobalWorkerOptions.workerSrc=pathToFileURL(path.join(import.meta.dirname,'pdf.worker.mjs')).href;
   const loading=pdf.getDocument({data:new Uint8Array(data),isEvalSupported:false,disableFontFace:true,useSystemFonts:true,useWorkerFetch:false,verbosity:0});
   const document=await loading.promise;pages=document.numPages;
   try{for(let p=1;p<=Math.min(pages,40);p++){const page=await document.getPage(p),content=await page.getTextContent();let text='';for(const item of content.items){if('str'in item){text+=item.str+(item.hasEOL?'\n':' ');}}text.split(/\n/).map(s=>s.trim()).filter(Boolean).forEach(text=>lines.push({text,page:p}));if(lines.reduce((n,l)=>n+l.text.length,0)>MAX_CHARS)break;}}finally{await loading.destroy();}
   if(pages>40)warnings.push('PDF_PAGE_LIMIT_40');if(!lines.length)throw Error('PDF_NO_EXTRACTABLE_TEXT_OCR_REQUIRED');
  }else if(['.txt','.md','.csv'].includes(ext)){
   const text=new TextDecoder(data[0]===255&&data[1]===254?'utf-16le':'utf-8',{fatal:true}).decode(data);if(text.includes('\0'))throw Error('DOCUMENT_BINARY_UNSUPPORTED');text.split(/\r?\n/).filter(s=>s.trim()).forEach(text=>lines.push({text:text.trim()}));
  }else throw Error('DOCUMENT_FORMAT_UNSUPPORTED');
  let chars=0,truncated=warnings.length>0;const bounded=[];for(const line of lines){if(chars+line.text.length>MAX_CHARS){truncated=true;break;}const safe=safeContextText(line.text);if(safe!==line.text&&!warnings.includes('CONTEXT_REDACTED'))warnings.push('CONTEXT_REDACTED');bounded.push({...line,text:safe});chars+=safe.length;}
  result={path:file,sha256:sha(data),bytes:data.length,format:ext.slice(1),lines:bounded,truncated,pages,warnings};
 }else if(request.kind==='word'){
  const content=request.content;if(!content||typeof content.title!=='string'||!Array.isArray(content.sections))throw Error('WORD_CONTENT_INVALID');
  const children=[new Paragraph({text:content.title,heading:HeadingLevel.TITLE,spacing:{after:260}})];
  for(const section of content.sections){if(section.heading)children.push(new Paragraph({text:section.heading,heading:HeadingLevel.HEADING_1,spacing:{before:220,after:120}}));for(const text of section.paragraphs){if(typeof text!=='string'||text.length>12000)throw Error('WORD_PARAGRAPH_INVALID');children.push(new Paragraph({children:[new TextRun(text)],spacing:{after:140,line:276}}));}}
  const doc=new Document({creator:'JARVIS',title:content.title,
   styles:{default:{document:{run:{font:'Calibri',size:22,color:'000000'},paragraph:{spacing:{after:140,line:276}}},title:{run:{font:'Calibri',size:36,bold:true,color:'000000'}},heading1:{run:{font:'Calibri',size:27,bold:true,color:'000000'}}}},
   sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1134,right:1134,bottom:1134,left:1134}}},children}]
  });
  const data=await Packer.toBuffer(doc);fs.writeFileSync(request.output,data,{flag:'wx'});
  const text=docxText(data).join('\n');const expected=[content.title,...content.sections.flatMap(s=>[s.heading??'',...s.paragraphs])].filter(Boolean);
  if(expected.some(t=>!text.includes(t)))throw Error('WORD_ROUNDTRIP_FAILED');result={path:request.output,bytes:data.length,sha256:sha(data),paragraphs:expected.length,verification:'OOXML_TEXT_ROUNDTRIP_VERIFIED_LAYOUT_UNREVIEWED'};
 }else throw Error('DOCUMENT_WORKER_KIND_INVALID');
 fs.writeFileSync(request.result,JSON.stringify({ok:true,result}));
}catch(error){fs.writeFileSync(request.result,JSON.stringify({ok:false,error:String(error)}));process.exitCode=1;}
