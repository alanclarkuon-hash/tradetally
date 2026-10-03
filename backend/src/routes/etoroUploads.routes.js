const router=require('express').Router(),multer=require('multer');
const service=require('../services/brokerSync/etoroUploads');
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1,fields:1}}).single('statement');
function error(res,e){res.status(400).json({success:false,message:e.message?.startsWith('eToro upload: ')?e.message.slice(14):'The statement could not be checked. Upload the original eToro XLSX export. No partial financial update was committed.'});}
router.get('/accounts',async(req,res)=>{try{res.json({success:true,data:await service.accounts(req.user.id)});}catch(e){error(res,e);}});
router.post('/preview',(req,res,next)=>upload(req,res,e=>e?res.status(400).json({success:false,message:'Upload one XLSX statement of 10 MB or less.'}):next()),async(req,res)=>{try{res.json({success:true,data:await service.preview(req.user.id,req.body.accountId,req.file)});}catch(e){error(res,e);}});
router.post('/apply',async(req,res)=>{try{if(typeof req.body?.token!=='string'||! /^[a-f0-9]{64}$/.test(req.body.token))throw Error('eToro upload: Preview the statement first.');res.json({success:true,data:await service.apply(req.user.id,req.body.token)});}catch(e){error(res,e);}});
module.exports=router;
