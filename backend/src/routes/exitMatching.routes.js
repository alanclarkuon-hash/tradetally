const express=require('express');
const {authenticate}=require('../middleware/auth');
const service=require('../services/exitMatching');
const router=express.Router({mergeParams:true});
router.use(authenticate);
router.get('/',async(req,res,next)=>{try{res.json(await service.state(req.user.id,req.params.id));}catch(e){if(e.status)res.status(e.status).json({error:e.message});else next(e);}});
router.post('/',async(req,res,next)=>{try{res.json(await service.correct(req.user.id,req.params.id,req.body||{}));}catch(e){if(e.status)res.status(e.status).json({error:e.message});else next(e);}});
module.exports=router;
