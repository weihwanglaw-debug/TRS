import {useRef,useState} from 'react';
import {Link2,Loader2} from 'lucide-react';
import {apiSetEventIntegration} from '@/lib/api/eventsApi';
import {ActionFeedbackDialog,type ActionFeedbackVariant} from '@/components/ui/ActionFeedbackDialog';

export default function EventIntegrationReadiness({eventId,ready,closed,disabled=false,onChanged}:{eventId:string;ready:boolean;closed:boolean;disabled?:boolean;onChanged:(ready:boolean)=>void}){
 const [busy,setBusy]=useState(false),[feedback,setFeedback]=useState<{variant:ActionFeedbackVariant;title:string;description:string}>();
 const pending=useRef(false);
 async function save(){
  if(pending.current||disabled||!closed)return;
  pending.current=true;setBusy(true);
  try{
   const result=await apiSetEventIntegration(eventId,!ready);
   if(result.error){
    const reasons=Array.isArray(result.error.details)?result.error.details.filter((reason):reason is string=>typeof reason==='string'):[];
    setFeedback({variant:'error',title:'Event integration could not be updated',description:[result.error.message,...reasons.map(reason=>`• ${reason}`)].join('\n')});
   }else{
    onChanged(result.data.ready);
    setFeedback({variant:'success',title:result.data.ready?'Event ready for integration':'Event integration cancelled',description:result.data.ready?'Participant, program and fixture editing is locked.':'Participant, program and fixture editing is unlocked. Existing copies in other systems are not removed.'});
   }
  }catch{setFeedback({variant:'error',title:'Event integration could not be updated',description:'Please check your connection and try again.'});}
  finally{pending.current=false;setBusy(false);}
 }
 return <><button type="button" className="btn-outline flex items-center gap-2 px-5 py-2.5 text-sm font-medium disabled:opacity-50" disabled={disabled||busy||!closed} onClick={()=>void save()} title={!closed?'Close registration before using event integration.':undefined}>{busy?<Loader2 className="h-4 w-4 animate-spin"/>:<Link2 className="h-4 w-4"/>}{ready?'Cancel Event Integration':'Ready Event Integration'}</button><ActionFeedbackDialog open={!!feedback} onOpenChange={open=>{if(!open)setFeedback(undefined);}} variant={feedback?.variant||'info'} title={feedback?.title||''} description={feedback?.description}/></>;
}
