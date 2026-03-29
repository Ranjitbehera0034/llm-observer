import { groupCursorEventsIntoSessions, CursorEvent } from '../../parsers/cursor';

describe('Cursor Parser > Session Grouping', () => {
    
    // Helper to make quick timestamped events
    const createEvent = (id: string, timeIso: string): CursorEvent => ({
        id,
        timestamp: new Date(timeIso).getTime(),
        type: 'generation'
    });

    it('returns empty array when given no events', () => {
        expect(groupCursorEventsIntoSessions([])).toEqual([]);
    });

    it('groups events taking a 4-minute break into a single session', () => {
        // 2:00 PM to 2:04 PM
        const e1 = createEvent('ev-1', '2026-03-29T14:00:00.000Z');
        const e2 = createEvent('ev-2', '2026-03-29T14:04:00.000Z');
        
        // 4 minute break... Next event is at 2:08
        const e3 = createEvent('ev-3', '2026-03-29T14:08:00.000Z');
        const e4 = createEvent('ev-4', '2026-03-29T14:12:00.000Z');

        const sessions = groupCursorEventsIntoSessions([e1, e2, e3, e4]);
        
        // Should be grouped into ONE session because max gap is 4 mins (240k ms), which is <= 5 mins (300k ms)
        expect(sessions).toHaveLength(1);
        expect(sessions[0]).toHaveLength(4);
        expect(sessions[0].map(e => e.id)).toEqual(['ev-1', 'ev-2', 'ev-3', 'ev-4']);
    });

    it('splits events taking a 6-minute break into separate sessions', () => {
        // 2:00 PM to 2:04 PM (Session A)
        const e1 = createEvent('A1', '2026-03-29T14:00:00.000Z');
        const e2 = createEvent('A2', '2026-03-29T14:04:00.000Z');
        
        // 6 minute break... Next event is at 2:10 (Session B)
        const e3 = createEvent('B1', '2026-03-29T14:10:00.000Z');
        const e4 = createEvent('B2', '2026-03-29T14:15:00.000Z');

        const sessions = groupCursorEventsIntoSessions([e1, e2, e3, e4]);
        
        // Gap between A2 (14:04) and B1 (14:10) is 6 minutes, which is > 5 minutes boundary.
        expect(sessions).toHaveLength(2);
        
        // Session A
        expect(sessions[0]).toHaveLength(2);
        expect(sessions[0].map(e => e.id)).toEqual(['A1', 'A2']);
        
        // Session B
        expect(sessions[1]).toHaveLength(2);
        expect(sessions[1].map(e => e.id)).toEqual(['B1', 'B2']);
    });

    it('sorts out-of-order events gracefully before grouping', () => {
        const e1 = createEvent('1', '2026-03-29T12:00:00.000Z');
        const e2 = createEvent('2', '2026-03-29T12:02:00.000Z');
        // e3 is slightly after e2
        const e3 = createEvent('3', '2026-03-29T12:02:01.000Z');
        const e4 = createEvent('4', '2026-03-29T12:10:00.000Z'); // gap 8 mins

        const shuffledOptions = [e4, e1, e3, e2];
        const sessions = groupCursorEventsIntoSessions(shuffledOptions);
        
        expect(sessions).toHaveLength(2);
        expect(sessions[0].map(e => e.id)).toEqual(['1', '2', '3']);
        expect(sessions[1].map(e => e.id)).toEqual(['4']);
    });
});
