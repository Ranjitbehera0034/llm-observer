import { useEffect, useState } from 'react';
import { FolderOpen, Settings, MoreVertical } from 'lucide-react';
import { BudgetMeter } from '../components/BudgetMeter';
import { API_BASE_URL } from '../config';

interface ProjectData {
    id: string;
    name: string;
    daily_budget: number;
    total_spend_today: number;
    total_requests_today: number;
}

export default function Projects() {
    const [projects, setProjects] = useState<ProjectData[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch(`${API_BASE_URL}/api/projects`)
            .then(res => res.json())
            .then(resData => {
                setProjects(resData.data);
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to fetch projects:', err);
                setLoading(false);
            });
    }, []);

    if (loading) {
        return (
            <div className="p-8 max-w-7xl mx-auto">
                <div className="animate-pulse h-10 w-48 bg-surfaceHighlight rounded mb-8"></div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="animate-pulse h-48 bg-surfaceHighlight rounded-xl w-full"></div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto p-8 animate-fade-in">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-white flex items-center gap-2">
                        <FolderOpen className="w-8 h-8 text-primary" />
                        Projects
                    </h1>
                    <p className="text-textMuted mt-2">Manage API keys and budget thresholds per project.</p>
                </div>
                <button className="px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg font-medium transition-colors">
                    + New Project
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {projects.map((project) => (
                    <div key={project.id} className="card hover:border-border transition-colors group">
                        <div className="flex justify-between items-start mb-6">
                            <div>
                                <h3 className="text-lg font-bold text-white mb-1 group-hover:text-primary transition-colors">
                                    {project.name}
                                </h3>
                                <p className="text-xs text-textMuted font-mono bg-surfaceHighlight px-2 py-1 rounded inline-block">
                                    ID: {project.id}
                                </p>
                            </div>
                            <button className="text-textMuted hover:text-white p-1 rounded hover:bg-surfaceHighlight transition-colors">
                                <MoreVertical className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="space-y-6">
                            <BudgetMeter spent={project.total_spend_today} budget={project.daily_budget} />

                            <div className="flex justify-between items-center pt-4 border-t border-border border-dashed">
                                <div className="text-sm">
                                    <p className="text-textMuted">Requests Today</p>
                                    <p className="font-semibold text-white mt-0.5">{project.total_requests_today.toLocaleString()}</p>
                                </div>
                                <button className="text-textMuted hover:text-white flex items-center gap-1.5 text-sm font-medium transition-colors">
                                    <Settings className="w-4 h-4" /> Manage
                                </button>
                            </div>
                        </div>
                    </div>
                ))}

                {/* Empty State visual CTA */}
                {projects.length === 0 && (
                    <div className="col-span-full py-20 flex flex-col items-center justify-center border-2 border-dashed border-border rounded-xl">
                        <FolderOpen className="w-12 h-12 text-textMuted mb-4 opacity-50" />
                        <h3 className="text-lg font-medium text-white mb-2">No Projects Found</h3>
                        <p className="text-sm text-textMuted max-w-sm text-center">
                            You need at least one active project to track API costs. Create a default project to get started.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
