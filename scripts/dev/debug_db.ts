import { initDb } from './packages/database/src/db.ts';
import path from 'path';

try {
    console.log('Initializing DB...');
    const db = initDb();
    console.log('DB Initialized.');
    
    const versionRow = db.prepare('SELECT name FROM _schema_version_v2 ORDER BY name DESC LIMIT 5').all();
    console.log('Applied versions:', versionRow);
    
    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_connections'").get();
    console.log('Table app_connections exists:', !!tableCheck);
} catch (err) {
    console.error('Diagnostic failed:', err);
}
