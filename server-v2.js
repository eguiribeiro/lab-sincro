'use strict';
const http=require('http'),fs=require('fs'),crypto=require('crypto'),path=require('path');
const PORT=process.env.PORT||3000;
const EQUIP=[['3d9','Impressora 3D','09:00–10:00'],['3d10','Impressora 3D','10:00–11:00'],['laser9','Cortadora a laser','09:00–10:00'],['laser10','Cortadora a laser','10:00–11:00'],['scan9','Scanner 3D','09:00–10:00'],['scan10','Scanner 3D','10:00–11:00']];
let state={version:0,reservations:{},events:[]};const clients=new Set(),dedupe=new Map();const dataFile=path.join(__dirname,'reservations-v2.json');
try{if(fs.existsSync(dataFile))state=JSON.parse(fs.readFileSync(dataFile,'utf8'))}catch(e){console.error(e)}
const iso=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!isNaN(Date.parse(d))&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d&&d>='2020-01-01'&&d<='2100-12-31';
const key=(date,id)=>date+'|'+id;
const result=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
const snapshot=date=>({date,version:state.version,online:clients.size,slots:EQUIP.map(([id,equipment,when])=>({id,equipment,when,reservation:state.reservations[key(date,id)]||null})),events:state.events.slice(0,15)});
const broadcast=()=>{for(const c of clients)try{c.res.write('event: state\ndata: '+JSON.stringify(snapshot(c.date))+'\n\n')}catch{clients.delete(c)}};
function record(type,meta){state.version++;state.events.unshift({type,...meta,timestamp:new Date().toISOString()});state.events=state.events.slice(0,40);try{fs.writeFileSync(dataFile+'.tmp',JSON.stringify(state));fs.renameSync(dataFile+'.tmp',dataFile)}catch(e){console.error(e)}broadcast()}
function act(route,p){if(route==='/api/reset'){if(p.confirm!=='REINICIAR')return [400,{error:'Confirmacao invalida'}];state.reservations={};record('reset',{});return [200,{ok:true}]}
if(!iso(p.date)||!EQUIP.some(s=>s[0]===p.slotId))return [400,{error:'Data ou horario invalido'}];
const k=key(p.date,p.slotId),existing=state.reservations[k];
if(route==='/api/cancel'){if(!existing)return [404,{error:'Reserva nao encontrada'}];if(existing.clientId!==p.clientId)return [403,{error:'Esta reserva pertence a outro aparelho'}];delete state.reservations[k];record('cancel',{date:p.date,slotId:p.slotId,name:existing.name});return [200,{ok:true}]}
if(typeof p.name!=='string'||p.name.trim().length<2||p.name.length>90||typeof p.clientId!=='string'||p.clientId.length<2)return [400,{error:'Preencha nome e identificador'}];
if(p.requestId&&dedupe.has(p.requestId))return dedupe.get(p.requestId);
let response;if(existing)response=[409,{error:'Conflito: este horario ja esta reservado nesta data',winner:existing.name}];else{const reservation={id:crypto.randomUUID(),name:p.name.trim(),clientId:p.clientId,date:p.date,reservedAt:new Date().toISOString()};state.reservations[k]=reservation;record('reserve',{date:p.date,slotId:p.slotId,name:reservation.name});response=[201,{ok:true,reservation}]}
if(p.requestId){if(dedupe.size>400)dedupe.clear();dedupe.set(p.requestId,response)}return response}
function body(req){return new Promise((resolve,reject)=>{let t='';req.on('data',b=>{t+=b;if(t.length>8192){reject(Error('Limite excedido'));req.destroy()}});req.on('end',()=>{try{resolve(JSON.parse(t||'{}'))}catch{reject(Error('JSON invalido'))}});req.on('error',reject)})}
http.createServer(async(req,res)=>{let url;try{url=new URL(req.url,'http://localhost')}catch{return result(res,400,{error:'URL invalida'})}const route=url.pathname;
if(route==='/api/health')return result(res,200,{ok:true});
if(route==='/api/state'){const date=url.searchParams.get('date');return iso(date)?result(res,200,snapshot(date)):result(res,400,{error:'Data invalida'})}
if(route==='/api/events'){const date=url.searchParams.get('date');if(!iso(date))return result(res,400,{error:'Data invalida'});res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});const c={date,res};clients.add(c);res.write('retry: 1500\nevent: state\ndata: '+JSON.stringify(snapshot(date))+'\n\n');broadcast();const timer=setInterval(()=>res.write(': ping\n\n'),20000);req.on('close',()=>{clients.delete(c);clearInterval(timer);broadcast()});return}
if(req.method==='POST'&&['/api/reserve','/api/cancel','/api/reset'].includes(route)){try{const [status,payload]=act(route,await body(req));return result(res,status,payload)}catch(e){return result(res,400,{error:e.message})}}
if(req.method!=='GET')return result(res,405,{error:'Metodo nao permitido'});const base=path.resolve(__dirname,'public'),file=path.resolve(base,'.'+(route==='/'?'/index.html':route));if(!file.startsWith(base+path.sep))return result(res,403,{error:'Acesso negado'});fs.readFile(file,(e,b)=>{if(e)return result(res,404,{error:'Nao encontrado'});const ext=path.extname(file);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'application/javascript','.css':'text/css'}[ext]||'application/octet-stream')+'; charset=utf-8','Cache-Control':'no-store'});res.end(b)})}).listen(PORT,'0.0.0.0',()=>console.log('LabSincro v2 na porta '+PORT));
