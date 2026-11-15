const { createTestDb } = require('./helpers/testDb');
const { database } = createTestDb();
jest.mock('@llm-observer/database', () => ({getDb:()=>database}));
jest.mock('../optimization/engine',()=>({runOptimizationEngine:jest.fn(async()=>({results:[{ruleId:'cache',title:'Review caching',description:'Repeated tokens',action:'Check cache settings'}]}))}));
jest.mock('../services/aiAnalyst',()=>({getLastResult:()=>({recommendations:[{title:'Review model',detail:'Compare costs before switching'}]})}));
import express from 'express';
import request from 'supertest';
import { tasksRouter } from '../routes/tasks.routes';
const app=express();app.use(express.json());app.use('/tasks',tasksRouter);
beforeEach(()=>database.exec('DELETE FROM task_inbox'));
afterAll(()=>database.close());
it('collects rule and AI tasks idempotently and keeps completed status',async()=>{
    expect((await request(app).post('/tasks/collect')).body.added).toBe(2);
    const task=(await request(app).get('/tasks')).body.data[0];
    expect((await request(app).patch('/tasks/'+task.id).send({status:'done'})).status).toBe(200);
    expect((await request(app).post('/tasks/collect')).body.added).toBe(0);
    expect((await request(app).get('/tasks')).body.data.find((t:any)=>t.id===task.id).status).toBe('done');
});
it('validates manual tasks and status changes',async()=>{
    expect((await request(app).post('/tasks').send({title:'',detail:''})).status).toBe(400);
    const task=await request(app).post('/tasks').send({title:'Review bill',detail:'Compare invoice'});
    expect(task.status).toBe(201);
    expect((await request(app).patch('/tasks/'+task.body.id).send({status:'execute_shell'})).status).toBe(400);
    expect((await request(app).patch('/tasks/missing').send({status:'done'})).status).toBe(404);
});
