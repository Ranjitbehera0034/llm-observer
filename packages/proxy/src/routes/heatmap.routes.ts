import { Router } from 'express';
import { getDb } from '@llm-observer/database';

const router = Router();

router.get('/', (req, res) => {
    const { days = '30', mode = 'sessions' } = req.query;
    const db = getDb();
    
    const stmt = db.prepare(`
        SELECT
            CAST(strftime('%w', started_at) AS INTEGER) AS day_of_week,
            CAST(strftime('%H', started_at) AS INTEGER) AS hour,
            COUNT(*) AS session_count,
            SUM(estimated_cost_usd) AS total_cost
        FROM sessions
        WHERE started_at >= datetime('now', ?)
        GROUP BY day_of_week, hour
    `);
    
    const rows = stmt.all(`-${days} days`) as any[];
    
    let maxValue = 0;
    
    // Process and normalize
    const dataMap: Record<number, Record<number, any>> = {};
    for (const r of rows) {
        if (!dataMap[r.day_of_week]) dataMap[r.day_of_week] = {};
        const cost = typeof r.total_cost === 'number' ? r.total_cost : 0;
        const val = mode === 'cost' ? cost : r.session_count;
        if (val > maxValue) {
            maxValue = val; // Find peak
        }
        dataMap[r.day_of_week][r.hour] = {
            sessions: r.session_count,
            cost
        };
    }
    
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    const grid = [];
    let peak = { day: '', hour: 0, label: '', value: -1 };
    let quietest = { day: '', hour: 0, label: '', value: Number.MAX_SAFE_INTEGER };
    
    for (let day = 0; day < 7; day++) {
        const hours = [];
        for (let hour = 0; hour < 24; hour++) {
            const entry = dataMap[day]?.[hour] || { sessions: 0, cost: 0 };
            const value = mode === 'cost' ? entry.cost : entry.sessions;
            
            hours.push({
                hour,
                value,
                sessions: entry.sessions,
                cost: entry.cost
            });
            
            if (value > peak.value) {
                peak = { 
                    day: dayNames[day], 
                    hour, 
                    label: `${dayNames[day]} ${hour}:00`, 
                    value 
                };
            }
            if (value < quietest.value) {
                quietest = {
                    day: dayNames[day],
                    hour,
                    label: `${dayNames[day]} ${hour}:00`,
                    value
                };
            }
        }
        grid.push({
            day,
            day_name: dayNames[day],
            hours
        });
    }
    
    res.json({
        period_days: parseInt(days as string, 10),
        mode,
        grid,
        max_value: maxValue,
        peak: peak.value === -1 ? null : peak,
        quietest: quietest.value === Number.MAX_SAFE_INTEGER ? null : quietest
    });
});

export default router;
