'use strict';
const VERSION=/^(\d+)\.(\d+)\.(\d+)$/;
const version=value=>VERSION.test(value||'')?value:null;
const compare=(a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);return y[0]-x[0]||y[1]-x[1]||y[2]-x[2];};
const artifactNames=new Set(['MN-Trono-Windows-x64','MN-Trono-Site-com-Desktop','MN-Trono-Site-Leve','Windows-app-validation']);
function planReleaseRetention(releases){
  const stable=releases.filter(r=>!r.draft&&!r.prerelease&&version(String(r.tag_name||'').replace(/^v/,''))).sort((a,b)=>compare(a.tag_name.replace(/^v/,''),b.tag_name.replace(/^v/,'')));
  const keep=stable.slice(0,2).map(r=>r.tag_name),remove=[];
  for(const r of stable.slice(2)){const expected='MN-Trono-'+r.tag_name.replace(/^v/,'')+'-Windows.exe';for(const a of r.assets||[])if(a.name===expected||a.name===expected+'.blockmap')remove.push({id:a.id,tag:r.tag_name,name:a.name,size:a.size||0});}
  return {keep,remove,reclaimBytes:remove.reduce((sum,a)=>sum+a.size,0)};
}
function planArtifactRetention(artifacts,versionsBySha,{protectedRunIds=[]}={}){
  const candidates=artifacts.filter(a=>artifactNames.has(a.name)&&version(versionsBySha[a.workflow_run?.head_sha])),keptVersions=[...new Set(candidates.map(a=>versionsBySha[a.workflow_run.head_sha]))].sort(compare).slice(0,2),remove=[],groups=new Map();
  for(const a of candidates){const v=versionsBySha[a.workflow_run.head_sha];if(!keptVersions.includes(v)||a.name==='MN-Trono-Site-com-Desktop'){remove.push(a);continue;}const key=v+':'+a.name;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(a);}
  for(const rows of groups.values()){
    rows.sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));const keep=rows.find(a=>protectedRunIds.includes(a.workflow_run?.id))||rows[0];remove.push(...rows.filter(a=>a.id!==keep.id));
  }
  return {keep:keptVersions,remove:remove.map(a=>({id:a.id,name:a.name,size:a.size_in_bytes||0})),reclaimBytes:remove.reduce((sum,a)=>sum+(a.size_in_bytes||0),0)};
}
async function cleanArtifacts({github,context,core,protectedRunIds=[]}){
  const repo=context.repo,artifacts=await github.paginate(github.rest.actions.listArtifactsForRepo,{...repo,per_page:100}),versionsBySha={};
  for(const sha of new Set(artifacts.filter(a=>artifactNames.has(a.name)).map(a=>a.workflow_run?.head_sha).filter(Boolean))){
    try{const {data}=await github.rest.repos.getContent({...repo,path:'desktop/app/package.json',ref:sha});if(data.content)versionsBySha[sha]=JSON.parse(Buffer.from(data.content,'base64').toString()).version;}
    catch(error){if(error.status!==404)throw error;}
  }
  const plan=planArtifactRetention(artifacts,versionsBySha,{protectedRunIds});
  for(const a of plan.remove)await github.rest.actions.deleteArtifact({...repo,artifact_id:a.id});
  core.notice(`Retenção: ${plan.keep.join(', ')}; removidos ${plan.remove.length} artefatos antigos/repetidos; liberados ${(plan.reclaimBytes/1024/1024).toFixed(1)} MiB.`);
  return {keep:plan.keep,removed:plan.remove.length,reclaimedBytes:plan.reclaimBytes};
}
module.exports={planReleaseRetention,planArtifactRetention,cleanArtifacts};
