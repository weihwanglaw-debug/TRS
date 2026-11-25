import {afterEach,expect,it,vi} from 'vitest';
import {apiSetEventIntegration} from '@/lib/api/eventsApi';

afterEach(()=>vi.restoreAllMocks());

it('preserves specific integration validation reasons for the feedback dialog',async()=>{
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({code:'EVENT_INTEGRATION_NOT_READY',message:'Resolve the listed issues.',errors:['Resolve pending registrations.','Not enough entries.',null]}),{status:400}));
 const result=await apiSetEventIntegration('1',true);
 expect(result.data).toBeNull();expect(result.error?.details).toEqual(['Resolve pending registrations.','Not enough entries.']);
 expect(result.error?.code).toBe('EVENT_INTEGRATION_NOT_READY');
});
