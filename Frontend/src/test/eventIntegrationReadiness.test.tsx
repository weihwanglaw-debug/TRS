import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import EventIntegrationReadiness from '@/components/admin/EventIntegrationReadiness';
const service=vi.hoisted(()=>({apiSetEventIntegration:vi.fn()}));
vi.mock('@/lib/api/eventsApi',()=>service);
vi.mock('@/components/ui/ActionFeedbackDialog',()=>({ActionFeedbackDialog:({open,title,description}:{open:boolean;title:string;description:string})=>open?<div role="dialog"><h2>{title}</h2><p>{description}</p></div>:null}));
let root:Root,container:HTMLDivElement;
const changed=vi.fn();
beforeEach(()=>{container=document.createElement('div');document.body.append(container);root=createRoot(container);vi.resetAllMocks();});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
const button=()=>container.querySelector('button')!;
async function render(ready=false,closed=true){await act(async()=>{root.render(<EventIntegrationReadiness eventId="1" ready={ready} closed={closed} onChanged={changed}/>);});}

it('validates on click and shows individual failure reasons without an extra check step',async()=>{
 service.apiSetEventIntegration.mockResolvedValue({data:null,error:{message:'Resolve readiness issues.',details:['Resolve 1 pending registration(s).','Singles requires 4 entries.']}});
 await render();expect(button().textContent).toBe('Ready Event Integration');expect(button().disabled).toBe(false);expect(service.apiSetEventIntegration).not.toHaveBeenCalled();
 await act(async()=>button().click());
 expect(service.apiSetEventIntegration).toHaveBeenCalledWith('1',true);
 expect(container.querySelector('[role="dialog"]')?.textContent).toContain('pending registration');
 expect(container.textContent).toContain('Singles requires 4 entries.');expect(changed).not.toHaveBeenCalled();
 expect(container.textContent).not.toContain('Check Readiness');
});
it('marks an eligible closed event immediately and reports success',async()=>{
 service.apiSetEventIntegration.mockResolvedValue({data:{ready:true},error:null});await render();
 await act(async()=>button().click());expect(service.apiSetEventIntegration).toHaveBeenCalledOnce();expect(changed).toHaveBeenCalledWith(true);
 expect(container.textContent).toContain('Event ready for integration');expect(container.textContent).toContain('editing is locked.');
});
it('cancels integration immediately using the requested label',async()=>{
 service.apiSetEventIntegration.mockResolvedValue({data:{ready:false},error:null});await render(true);
 expect(button().textContent).toBe('Cancel Event Integration');await act(async()=>button().click());
 expect(service.apiSetEventIntegration).toHaveBeenCalledWith('1',false);expect(changed).toHaveBeenCalledWith(false);
 expect(container.textContent).toContain('Existing copies in other systems are not removed.');
});
it('disables either integration action unless registration is closed',async()=>{
 await render(false,false);expect(button().disabled).toBe(true);await act(async()=>button().click());
 await render(true,false);expect(button().disabled).toBe(true);await act(async()=>button().click());
 expect(service.apiSetEventIntegration).not.toHaveBeenCalled();
});
it('shows a connection failure and allows another attempt',async()=>{
 service.apiSetEventIntegration.mockRejectedValue(new Error('offline'));await render();await act(async()=>button().click());
 expect(container.textContent).toContain('Please check your connection and try again.');expect(button().disabled).toBe(false);expect(changed).not.toHaveBeenCalled();
});
