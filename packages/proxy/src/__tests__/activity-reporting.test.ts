const settings = new Map<string,string>();
jest.mock('@llm-observer/database',()=>({getSetting:(key:string)=>settings.get(key),updateSetting:(key:string,value:string)=>settings.set(key,value)}));
import { reportActivity,setActivityReporting,activityStatus } from '../services/activityReporting';
const original=global.fetch;
beforeEach(()=>{settings.clear();process.env.LICENSE_SERVER_URL='https://report.example.invalid';global.fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>({accepted:true,removed:true})}) as any;});
afterAll(()=>{global.fetch=original;delete process.env.LICENSE_SERVER_URL;});
it('sends nothing by default',async()=>{await reportActivity();expect(global.fetch).not.toHaveBeenCalled();});
it('sends only approved metadata and can forget it',async()=>{
    settings.set('private_prompt','Never send this');
    await setActivityReporting(true);
    const sent=JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(Object.keys(sent).sort()).toEqual(['consent','installation_id','token','version']);
    expect(activityStatus().last_sent).toBeTruthy();
    await setActivityReporting(false);
    expect((global.fetch as jest.Mock).mock.calls[1][1].method).toBe('DELETE');
    expect(settings.get('activity_installation_token')).toBe('');
});
it('stops sending even if remote deletion fails and permits a retry',async()=>{
    await setActivityReporting(true);
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    await setActivityReporting(false);
    expect(activityStatus()).toMatchObject({enabled:false,error:expect.stringContaining('deletion failed')});
    expect(settings.get('activity_installation_token')).toBeTruthy();
    const before=(global.fetch as jest.Mock).mock.calls.length;
    await reportActivity();expect((global.fetch as jest.Mock).mock.calls.length).toBe(before);
    await setActivityReporting(false);expect(settings.get('activity_installation_token')).toBe('');
});
