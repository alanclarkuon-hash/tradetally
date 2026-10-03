const router=require('express').Router();
const multer=require('multer');
const service=require('../services/brokerSync/igUploads');
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:20,fields:0}}).any();
function error(res,e) {
  const safe=e.message?.startsWith('IG upload:')||e.message?.startsWith('IG statement:');
  res.status(400).json({success:false,message:safe?e.message.replace(/^IG (?:upload|statement): /,''):
    'The reports could not be reconciled. Check full history, account identities and matching transfer reports. No partial financial import was committed.'});
}
router.get('/accounts',async(req,res)=>{try{res.json({success:true,data:await service.accounts(req.user.id)});}catch(e){error(res,e);}});
router.post('/preview',(req,res,next)=>upload(req,res,e=>e?res.status(400).json({success:false,message:'Use CSV and PDF reports of 5 MB or less each, with one file per report.'}):next()),async(req,res)=>{
  try{res.json({success:true,data:await service.preview(req.user.id,req.files||[])});}catch(e){error(res,e);}
});
router.post('/apply',async(req,res)=>{try{
  if(typeof req.body?.token!=='string'||! /^[a-f0-9]{64}$/.test(req.body.token))throw Error('IG upload: Please preview your files first.');
  res.json({success:true,data:await service.apply(req.user.id,req.body.token)});
}catch(e){error(res,e);}});
module.exports=router;
